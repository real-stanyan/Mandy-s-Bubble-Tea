import "server-only";

export class DeepSeekError extends Error {}

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

/** Verified against api-docs.deepseek.com on 2026-08-10: the tool-calls guide
 *  demonstrates deepseek-v4-pro. The only other model on sale is
 *  deepseek-v4-flash. deepseek-chat no longer exists. */
const DEFAULT_MODEL = "deepseek-v4-pro";
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
        "Propose one drink for the customer to confirm. Use only ids that appear in the menu you were given. Do not state prices in your message text; the app fills those in.",
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
    throw new DeepSeekError(`DeepSeek responded ${res.status}: ${await res.text()}`);
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
