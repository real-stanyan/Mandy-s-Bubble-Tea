import { getMenu } from "@/lib/catalog";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import {
  callDeepSeek,
  DeepSeekError,
  type DeepSeekMessage,
  type ToolCall,
} from "@/lib/chat/deepseek";
import {
  validateProposal,
  type DrinkProposal,
  type ValidationResult,
} from "@/lib/chat/validate-proposal";
import { fallbackMatch } from "@/lib/chat/fallback-match";
import { toApiProposal } from "@/lib/chat/proposal-to-cart";
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

/** Two variants each, because fallbackMatch() can legitimately come back
 *  empty — always for a non-menu query, and (before Finding 1's fix) for
 *  every single Chinese query regardless of intent. A message that ends in
 *  a colon promising a list must never be shown next to an empty list; the
 *  no-suggestions variant points at the menu instead of promising
 *  something that isn't there. */
const DEEPSEEK_UNREACHABLE_WITH_SUGGESTIONS = "抱歉，助手暂时连不上。这几款你可能会喜欢：";
const DEEPSEEK_UNREACHABLE_NO_SUGGESTIONS = "抱歉，助手暂时连不上，先去菜单看看想喝点什么吧。";
/** Fixed on purpose — see degraded()'s doc comment on why these never
 *  carry model-authored text. */
const NO_CONFIDENT_MATCH_WITH_SUGGESTIONS = "我没太确定你想要哪一款，这几个也许合适：";
const NO_CONFIDENT_MATCH_NO_SUGGESTIONS = "我没太确定你想要哪一款，去菜单挑一挑，也许有你喜欢的。";
/** Fixed on purpose, same reasoning as above. Last resort when a model
 *  reply is empty after scrubPrices() strips it (the model said nothing
 *  but a price) and there's no non-empty fallback text to use instead. */
const EMPTY_REPLY_FALLBACK = "抱歉，我刚才没说清楚——能再说一次吗？";

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
 *  attempt and must not be shown to the customer as if it were an answer.
 *
 *  Picks between the "here are some suggestions" and "no suggestions"
 *  copy based on whether fallbackMatch() actually found anything — see the
 *  two message constants above. */
function degraded(
  withSuggestions: string,
  noSuggestions: string,
  suggestions: ReturnType<typeof fallbackMatch>,
) {
  const reply = suggestions.length > 0 ? withSuggestions : noSuggestions;
  return json({ reply, proposal: null, action: null, suggestions });
}

/** Matches anything price-shaped so it can be stripped out of a
 *  model-authored reply before it reaches the client. This is defence in
 *  depth, not a security control: the authoritative price is always the
 *  catalog-derived one already printed on the proposal card. The system
 *  prompt tells the model never to state a price, but that's a request,
 *  not an enforcement, so this exists for the case where the model's own
 *  sentence quotes a number that then contradicts the card.
 *
 *  Covers, in order: an ASCII or full-width dollar sign followed by an
 *  amount (allowing any gap of spaces after the sign, and thousands
 *  separators — the whole "$1,299" is consumed as one match so no orphaned
 *  ",299" is left behind); "AUD 9.99" / "AUD9.99"; the colloquial Chinese
 *  "N块M" pattern ("7块5" = seven kuai five) — checked before the plain
 *  trailing-unit case below so "7块5" isn't half-eaten as "7块" + a
 *  dangling "5"; and the trailing-unit forms "9.99元", "9.99块", "9.99
 *  dollars".
 *
 *  Deliberately does NOT catch prices spelled out in Chinese numerals
 *  (e.g. "九块九") — recognizing those needs a numeral parser, not a
 *  regex, and that's out of scope for a defence-in-depth scrub. */
const PRICE_PATTERN =
  /[$＄]\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|AUD\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+块\d+(?:毛)?|\d+(?:\.\d{1,2})?\s*(?:dollars?|元|块)/gi;

export function scrubPrices(text: string): string {
  return text
    .replace(PRICE_PATTERN, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Distinguish DeepSeek failure causes for the log line without ever
 *  logging `err.message` when it might carry the raw upstream response
 *  body — callDeepSeek() embeds `await res.text()` into the thrown
 *  error's message for a non-2xx response (see deepseek.ts), and that can
 *  contain key-adjacent detail from the provider's error payload.
 *  DeepSeekError.status is set exactly when that happened, so logging the
 *  status instead of the message still tells a 401 apart from a 402 apart
 *  from a timeout — the three cases used to all log as the bare string
 *  "Error" (or, after just fixing DeepSeekError's name, a uniform
 *  "DeepSeekError" with no further detail). When status is unset, the
 *  failure happened before any upstream response existed (timeout, DNS,
 *  missing API key), so the message never had a body to embed and is
 *  safe to log as-is. */
function describeDeepSeekFailure(err: unknown): string {
  if (err instanceof DeepSeekError) {
    return err.status !== undefined
      ? `DeepSeekError (upstream status ${err.status})`
      : `DeepSeekError: ${err.message}`;
  }
  return err instanceof Error ? err.name : "unknown error";
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
      // describeDeepSeekFailure() picks what's safe to log — see its own
      // doc comment for why this is not just err.message.
      console.error(
        "[chat] DeepSeek call failed; degrading to keyword suggestions:",
        describeDeepSeekFailure(err),
      );
      return degraded(
        DEEPSEEK_UNREACHABLE_WITH_SUGGESTIONS,
        DEEPSEEK_UNREACHABLE_NO_SUGGESTIONS,
        fallbackMatch(menu, lastUserText),
      );
    }

    if (findToolCall(result.toolCalls, "go_checkout")) {
      // Scrub FIRST, then fall back — scrubPrices() can turn a
      // price-only reply into "", and the fallback has to fire on that
      // empty result, not get shadowed by the pre-scrub `||` this used to
      // be written with (which chose the model's text before scrubbing
      // ever got a chance to empty it).
      return json({
        reply: scrubPrices(result.content) || "好的，带你去结账。",
        proposal: null,
        action: "checkout",
        suggestions: [],
      });
    }

    const call = findToolCall(result.toolCalls, "propose_drink");
    if (!call) {
      // Plain conversational turn — a question, a greeting, a refusal.
      // Same scrub-first-then-fallback shape as above; this site had no
      // fallback at all before, so a price-only reply reached the
      // customer as a silently blank bubble.
      return json({
        reply: scrubPrices(result.content) || EMPTY_REPLY_FALLBACK,
        proposal: null,
        action: null,
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
      // Scrub-first-then-fallback again, with a two-step fallback chain:
      // the model's own text, then its (also scrubbed — it can quote a
      // price too) one-line reason for the pick, then the fixed string.
      return json({
        reply: scrubPrices(result.content) || scrubPrices(v.reason) || EMPTY_REPLY_FALLBACK,
        proposal: toApiProposal(v),
        action: null,
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
    NO_CONFIDENT_MATCH_WITH_SUGGESTIONS,
    NO_CONFIDENT_MATCH_NO_SUGGESTIONS,
    fallbackMatch(menu, lastUserText),
  );
}
