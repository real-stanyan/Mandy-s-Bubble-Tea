import { getMenu } from "@/lib/catalog";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import {
  callDeepSeek,
  type DeepSeekMessage,
  type ToolCall,
} from "@/lib/chat/deepseek";
import { validateProposal, type DrinkProposal } from "@/lib/chat/validate-proposal";
import { fallbackMatch } from "@/lib/chat/fallback-match";
import {
  checkChatRateLimit,
  hashIp,
  CHAT_HOURLY_LIMIT,
  type RateLimitVerdict,
} from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";

const MAX_HISTORY = 20;
const MAX_CHARS = 500;
/** One retry, not two. Each round is a full Sydney-to-DeepSeek round-trip;
 *  past the second the customer is better served by the menu link. */
const MAX_ATTEMPTS = 2;

type IncomingMessage = { role: "user" | "assistant"; content: string };

function parseBody(raw: unknown): IncomingMessage[] | null {
  if (!raw || typeof raw !== "object") return null;
  const messages = (raw as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (messages.length > MAX_HISTORY) return null;

  const out: IncomingMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.length === 0) return null;
    if (content.length > MAX_CHARS) return null;
    out.push({ role, content });
  }
  return out;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "unknown";
}

function findToolCall(calls: ToolCall[], name: string): ToolCall | undefined {
  return calls.find((c) => c.name === name);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Everything the client needs, with BigInt amounts flattened to decimal
 *  strings — BigInt cannot be JSON-serialized, and the client re-hydrates
 *  them with BigInt() before touching the cart. */
function degraded(reply: string, suggestions: ReturnType<typeof fallbackMatch>) {
  return json({ reply, proposal: null, action: null, degraded: true, suggestions });
}

/** hashIp() deliberately THROWS when CHAT_RATE_LIMIT_SALT is unset or
 *  empty — a missing salt would make the hash publicly computable, turning
 *  the limiter into a targeted-lockout tool. But checkChatRateLimit() is
 *  fail-open (a dead Supabase counter must not take the chatbox down), and
 *  a thrown salt error deserves the exact same treatment: the request
 *  proceeds unlimited rather than 500ing on every single chat request. So
 *  the hash step is wrapped here rather than left to throw uncaught. */
async function rateLimitVerdict(request: Request): Promise<RateLimitVerdict> {
  let ipHash: string;
  try {
    ipHash = hashIp(clientIp(request));
  } catch {
    return { allowed: true, remaining: CHAT_HOURLY_LIMIT };
  }
  return checkChatRateLimit(ipHash);
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const history = parseBody(raw);
  if (!history) return json({ error: "invalid messages" }, 400);

  const verdict = await rateLimitVerdict(request);
  if (!verdict.allowed) {
    return json({ error: "rate limited" }, 429);
  }

  const menu = await getMenu();
  const lastUserText = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

  const messages: DeepSeekMessage[] = [
    { role: "system", content: buildSystemPrompt(menu) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let lastReply = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<typeof callDeepSeek>>;
    try {
      result = await callDeepSeek(messages);
    } catch {
      return degraded(
        "抱歉，助手暂时连不上。这几款你可能会喜欢：",
        fallbackMatch(menu, lastUserText),
      );
    }

    lastReply = result.content;

    if (findToolCall(result.toolCalls, "go_checkout")) {
      return json({
        reply: result.content || "好的，带你去结账。",
        proposal: null,
        action: "checkout",
        degraded: false,
        suggestions: [],
      });
    }

    const call = findToolCall(result.toolCalls, "propose_drink");
    if (!call) {
      // Plain conversational turn — a question, a greeting, a refusal.
      return json({
        reply: result.content,
        proposal: null,
        action: null,
        degraded: false,
        suggestions: [],
      });
    }

    let parsed: DrinkProposal;
    try {
      parsed = JSON.parse(call.argumentsJson) as DrinkProposal;
    } catch {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          { id: call.id, type: "function", function: { name: call.name, arguments: call.argumentsJson } },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: "Your tool arguments were not valid JSON. Emit valid JSON.",
      });
      continue;
    }

    const validated = validateProposal(menu, parsed);
    if (validated.ok) {
      const v = validated.value;
      return json({
        reply: result.content || v.reason,
        proposal: {
          itemId: v.line.itemId,
          itemName: v.line.itemName,
          imageUrl: v.line.itemImageUrl,
          categorySlug: v.categorySlug,
          variationId: v.line.variationId,
          variationName: v.line.variationName,
          variationPriceCents: v.line.variationPriceCents.toString(),
          modifiers: v.line.modifiers.map((m) => ({
            id: m.id,
            name: m.name,
            priceCents: m.priceCents.toString(),
          })),
          quantity: v.quantity,
          unitPriceCents: v.unitPriceCents.toString(),
          totalCents: v.totalCents.toString(),
          reason: v.reason,
        },
        action: null,
        degraded: false,
        suggestions: [],
      });
    }

    // Hand the failures back verbatim. A bare "try again" produces a reroll;
    // the specific errors produce a correction.
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: call.id, type: "function", function: { name: call.name, arguments: call.argumentsJson } },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: `That proposal was rejected:\n- ${validated.errors.join("\n- ")}\nFix every point and call propose_drink again with ids copied from the menu.`,
    });
  }

  return degraded(
    lastReply || "我没太确定你想要哪一款，这几个也许合适：",
    fallbackMatch(menu, lastUserText),
  );
}
