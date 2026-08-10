import { getMenu } from "@/lib/catalog";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import {
  callDeepSeek,
  type DeepSeekMessage,
  type ToolCall,
} from "@/lib/chat/deepseek";
import {
  validateProposal,
  type DrinkProposal,
  type ValidationResult,
} from "@/lib/chat/validate-proposal";
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

const DEEPSEEK_UNREACHABLE_MESSAGE = "抱歉，助手暂时连不上。这几款你可能会喜欢：";
/** Fixed on purpose — see degraded()'s doc comment on why this never
 *  carries model-authored text. */
const NO_CONFIDENT_MATCH_MESSAGE = "我没太确定你想要哪一款，这几个也许合适：";

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

/** Prefer x-vercel-forwarded-for: per Vercel's docs it's the header that
 *  survives if a proxy is ever put in front of the deployment, and it's
 *  identical to x-forwarded-for in the common case. x-forwarded-for itself
 *  is not spoofable on Vercel today (Vercel overwrites it rather than
 *  forwarding a client-supplied value) but is kept as a fallback for local
 *  dev and any non-Vercel host; x-real-ip is a last resort. */
function clientIp(request: Request): string {
  const vercelFwd = request.headers.get("x-vercel-forwarded-for");
  if (vercelFwd) return vercelFwd.split(",")[0]?.trim() || "unknown";
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
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
 *  them with BigInt() before touching the cart.
 *
 *  `reply` here is always a fixed, server-authored string — never text the
 *  model produced. Every degrade path is triggered by something going
 *  wrong with the model's output (unreachable, or two rejected proposals
 *  in a row), so any prose it did manage to emit belongs to a failed
 *  attempt and must not be shown to the customer as if it were an answer. */
function degraded(reply: string, suggestions: ReturnType<typeof fallbackMatch>) {
  return json({ reply, proposal: null, action: null, degraded: true, suggestions });
}

/** The system prompt tells the model never to state a price, but that's a
 *  request, not an enforcement — nothing stops its own sentence from
 *  quoting a number that then contradicts the real price printed on the
 *  card. Strip anything dollar-shaped out of every model-authored reply
 *  before it reaches the client; the card stays the single source of
 *  truth. */
function scrubPrices(text: string): string {
  return text
    .replace(/\$\s?\d+(?:\.\d{1,2})?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** hashIp() deliberately THROWS when CHAT_RATE_LIMIT_SALT is unset or
 *  empty — a missing salt would make the hash publicly computable, turning
 *  the limiter into a targeted-lockout tool. But checkChatRateLimit() is
 *  fail-open (a dead Supabase counter must not take the chatbox down), and
 *  a thrown salt error deserves the exact same treatment: the request
 *  proceeds unlimited rather than 500ing on every single chat request. So
 *  the hash step is wrapped here rather than left to throw uncaught.
 *
 *  Logged so a misconfigured deploy shows up to anyone scanning logs — the
 *  logged error is hashIp's own message ("CHAT_RATE_LIMIT_SALT is not
 *  set"), never the salt or the raw IP. */
async function rateLimitVerdict(request: Request): Promise<RateLimitVerdict> {
  let ipHash: string;
  try {
    ipHash = hashIp(clientIp(request));
  } catch (err) {
    console.error(
      "[chat] rate limit hash failed (missing/empty CHAT_RATE_LIMIT_SALT?); serving this request unmetered:",
      err instanceof Error ? err.message : String(err),
    );
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

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result: Awaited<ReturnType<typeof callDeepSeek>>;
    try {
      result = await callDeepSeek(messages);
    } catch (err) {
      // Never log err.message here: DeepSeekError's message can embed the
      // raw upstream response body (see deepseek.ts), which must not land
      // in a log line. The error's name/type is enough for a human
      // scanning logs to notice something is wrong.
      console.error(
        "[chat] DeepSeek call failed; degrading to keyword suggestions:",
        err instanceof Error ? err.name : "unknown error",
      );
      return degraded(DEEPSEEK_UNREACHABLE_MESSAGE, fallbackMatch(menu, lastUserText));
    }

    if (findToolCall(result.toolCalls, "go_checkout")) {
      return json({
        reply: scrubPrices(result.content || "好的，带你去结账。"),
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
        reply: scrubPrices(result.content),
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

    // `parsed` is a cast, not a validation — valid JSON can still be the
    // literal `null`, or an object missing `modifiers` entirely, and
    // validateProposal() indexes straight into it (`for (const ... of
    // proposal.modifiers)`, `proposal.quantity`, ...). The customer's own
    // wording steers what the model puts in the tool call, so a malformed
    // shape is reachable, not hypothetical. Treat a thrown validation the
    // same as a normal rejection: feed a generic error back and let the
    // retry loop handle it, rather than letting the exception escape and
    // 500 the request.
    let validated: ValidationResult;
    try {
      validated = validateProposal(menu, parsed);
    } catch (err) {
      console.error(
        "[chat] propose_drink arguments had an unexpected shape; treating as a rejected proposal:",
        err instanceof Error ? err.message : String(err),
      );
      validated = {
        ok: false,
        errors: [
          "propose_drink arguments were malformed: itemId, variationId, quantity, and reason must all be present, and modifiers must be an array of { modifierId, count }.",
        ],
      };
    }

    if (validated.ok) {
      const v = validated.value;
      return json({
        reply: scrubPrices(result.content || v.reason),
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

  return degraded(NO_CONFIDENT_MATCH_MESSAGE, fallbackMatch(menu, lastUserText));
}
