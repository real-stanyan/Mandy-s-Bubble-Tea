import "server-only";

export class DeepSeekError extends Error {
  /** Set only when the failure came from a non-2xx upstream response —
   *  undefined for a timeout, a network failure, or a missing API key
   *  (none of which ever produced a response to have a status). Lets a
   *  caller's log line tell a 401 (rotated key) apart from a 402 (empty
   *  balance) apart from a timeout without ever reading `.message`, which
   *  can embed the raw upstream response body for the non-2xx case (see
   *  the `!res.ok` branch below) and must never land in a log line. */
  readonly status?: number;

  constructor(message: string, opts: { status?: number } = {}) {
    super(message);
    // Without this, every DeepSeekError logs its name as the base class's
    // "Error" — a timeout, a rotated-key 401, and an empty-balance 402 all
    // looked identical to anyone scanning production logs.
    this.name = "DeepSeekError";
    this.status = opts.status;
  }
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type DeepSeekMessage = {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

export type ToolCall = { id: string; name: string; argumentsJson: string };
export type DeepSeekReply = { content: string; toolCalls: ToolCall[] };

/** Verified against api-docs.deepseek.com on 2026-08-10: the only two models
 *  on sale are deepseek-v4-pro and deepseek-v4-flash (deepseek-chat no longer
 *  exists). Default is flash — Stan found pro noticeably slow for a chat
 *  bubble (2026-08-10), and latency loses customers faster than reasoning
 *  wins them. Set DEEPSEEK_MODEL=deepseek-v4-pro to switch back without a
 *  deploy if flash's tool-calling proves too sloppy. */
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The only two things the model is allowed to do.
 *
 * propose_drink returns ids and nothing else — no names, no prices. Those
 * get filled in server-side from the catalog, so a hallucinated price has
 * no path to the customer's screen.
 */
export const CHAT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "propose_drink",
      description:
        "Propose one drink for the customer to confirm. Call it once per distinct drink — several calls in one reply build a multi-drink order. Use only ids that appear in the menu you were given. Do not state prices in your message text; the app fills those in.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "itemId from the menu" },
          variationId: { type: "string", description: "variationId (size) belonging to that item" },
          modifiers: {
            type: "array",
            description: "Every modifier to apply, including required lists such as SUGAR and ICE.",
            items: {
              type: "object",
              properties: {
                modifierId: { type: "string" },
                count: { type: "integer", minimum: 1 },
              },
              required: ["modifierId", "count"],
              additionalProperties: false,
            },
          },
          quantity: { type: "integer", minimum: 1, maximum: 20 },
          reason: {
            type: "string",
            description: "One short sentence for the customer explaining the pick. Match the customer's language.",
          },
        },
        required: ["itemId", "variationId", "modifiers", "quantity", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_promotion",
      description:
        "Show the customer a card for one of the LIVE PROMOTIONS listed in your instructions. Use this whenever they ask what's on, whether they can redeem a free drink, how the stars work, or about any discount. Explain it in your own words too — the card is the summary, your sentence is the answer.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "The bracketed key of one promotion from LIVE PROMOTIONS, e.g. loyalty or weekly-specials. Never invent a key.",
          },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "file_complaint",
      description:
        "File a customer complaint for the store manager. ONLY when the customer has actually reported something going wrong — a wrong or bad drink, a delivery problem, rude service. Asking whether they can redeem a free drink, what promotions are on, or how the stars work is NOT a complaint: answer it with show_promotion instead. Filing a complaint about nothing wastes the manager's time and tells the customer something is broken when it isn't. Your accompanying message must tell them the manager has been notified and will contact them within 24 hours, in the customer's language. Never promise refunds or compensation.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "One or two sentences describing the complaint, in the customer's own words as far as possible.",
          },
          orderNumber: {
            type: "string",
            description: "The order number, only if the customer gave one.",
          },
          contact: {
            type: "string",
            description:
              "Phone or email for the manager to reach them, only if the customer gave one.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_my_order",
      description:
        "Look up the customer's own most recent order and how far along it is. Call this whenever they ask about an order they have already placed — where it is, whether anyone has picked it up, how much longer, or why it is taking a while. Do not answer those from memory: call this first. It takes no arguments and can only ever return the order of the person you are talking to.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "go_checkout",
      description:
        "Send the customer to checkout. Call this only when they have asked to pay or check out.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

/**
 * One round-trip to DeepSeek's OpenAI-compatible endpoint.
 *
 * Plain fetch instead of the openai SDK: it's one dependency fewer, and
 * stubbing global fetch in vitest is cleaner than mocking a client class.
 *
 * Times out at 15s. Sydney-to-DeepSeek latency is real, and a request still
 * open after 15 seconds has already lost the customer — the caller degrades
 * to keyword matching instead.
 */
export async function callDeepSeek(
  messages: DeepSeekMessage[],
  opts: { timeoutMs?: number } = {},
): Promise<DeepSeekReply> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY is not configured");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, tools: CHAT_TOOLS, temperature: 0.3 }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new DeepSeekError(
      err instanceof Error && err.name === "AbortError"
        ? "DeepSeek request timed out"
        : `DeepSeek request failed: ${String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new DeepSeekError(`DeepSeek responded ${res.status}: ${await res.text()}`, {
      status: res.status,
    });
  }

  const body = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = body.choices?.[0]?.message;

  return {
    content: message?.content ?? "",
    toolCalls: (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      argumentsJson: tc.function.arguments,
    })),
  };
}
