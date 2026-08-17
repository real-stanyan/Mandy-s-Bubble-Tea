import { getMenu } from "@/lib/catalog";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { scriptHint, violatesScriptHint, SCRIPT_RETRY_NOTE } from "@/lib/chat/language-hint";
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
import { getDeliveryPause } from "@/lib/store-status-server";
import {
  getLivePromotions,
  fetchPromoCampaigns,
  nearRewardNudge,
  type Promotion,
} from "@/lib/chat/promotions";
import { readCustomerPromoState } from "@/lib/chat/customer-state";
import { lookupOrderStatusForChat } from "@/lib/chat/order-status";
import { guardComplaint } from "@/lib/chat/complaint-guard";
import {
  recordChatTurns,
  normalizeConversationId,
  fallbackConversationId,
} from "@/lib/chat/log";
import { fileChatComplaint, type ComplaintFiling } from "@/lib/chat/complaint";
import { sendBulkInquiry, type BulkInquiry } from "@/lib/chat/bulk-inquiry";
import { isActiveMysteryCode } from "@/lib/mystery-box";
import { clientPlatformFrom } from "@/lib/client-platform";
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

/** Fixed server-authored strings, two languages. The model matches the
 *  customer's language natively; these strings appear exactly when the
 *  model's output can't be used, so they pick a language by a cheap
 *  heuristic instead: CJK characters in the customer's last message →
 *  Chinese, anything else → English (the store is in Queensland — English
 *  is the safe default for every other language).
 *
 *  Two variants of each degrade string, because fallbackMatch() can
 *  legitimately come back empty — a message that ends in a colon promising
 *  a list must never be shown next to an empty list. All fixed on purpose:
 *  see degraded()'s doc comment on why these never carry model text. */
const STRINGS = {
  zh: {
    unreachableWithSuggestions: "抱歉，助手暂时连不上。这几款你可能会喜欢：",
    unreachableNoSuggestions: "抱歉，助手暂时连不上，先去菜单看看想喝点什么吧。",
    noMatchWithSuggestions: "我没太确定你想要哪一款，这几个也许合适：",
    noMatchNoSuggestions: "我没太确定你想要哪一款，去菜单挑一挑，也许有你喜欢的。",
    emptyReplyFallback: "抱歉，我刚才没说清楚——能再说一次吗？",
    checkoutFallback: "好的，这就带你去结账。",
    complaintAck: "已经记下了，我马上通知店长，他会在 24 小时内联系你处理。",
    bulkInquiryAck: "大单信息已经发给店里了，会尽快联系你确认饮品、时间和价格。",
    bulkInquiryFailed: "抱歉，刚才没能把信息发给店里——麻烦直接打门店电话 0404 978 238，说一下杯数和时间就行。",
    mysteryBoxOffer: "给你变一个今日盲盒——点开看看是什么！",
    mysteryBoxSignIn: "盲盒要登录才能开（奖品得放进你的 Rewards 里）——登录后再来找我说「给我惊喜」！",
  },
  en: {
    unreachableWithSuggestions: "Sorry, the assistant is unreachable right now. You might like one of these:",
    unreachableNoSuggestions: "Sorry, the assistant is unreachable right now — have a browse of the menu instead.",
    noMatchWithSuggestions: "I'm not quite sure which drink you meant — maybe one of these:",
    noMatchNoSuggestions: "I'm not quite sure which drink you meant — the menu might have just the thing.",
    emptyReplyFallback: "Sorry, I didn't put that well — could you say it again?",
    checkoutFallback: "Sure — taking you to checkout.",
    complaintAck: "I've noted it down and notified the store manager — they'll contact you within 24 hours.",
    bulkInquiryAck: "Your bulk order details are with the store — they'll be in touch soon to confirm drinks, timing and price.",
    bulkInquiryFailed: "Sorry — that didn't reach the store just now. Please ring 0404 978 238 with your cup count and timing instead.",
    mysteryBoxOffer: "Here's today's mystery box — tap it and see what's inside!",
    mysteryBoxSignIn: "The mystery box needs you signed in (the prize goes into your Rewards) — sign in and ask me for a surprise again!",
  },
} as const;

function stringsFor(lastUserText: string): (typeof STRINGS)["zh"] | (typeof STRINGS)["en"] {
  // Han without kana -> Chinese. Kana present -> Japanese, which gets the
  // English strings (a Japanese variant would be guesswork; English is
  // the store lingua franca and the model own replies still come back
  // in Japanese).
  const hasKana = /[぀-ヿ]/.test(lastUserText);
  const hasHan = /[㐀-鿿]/.test(lastUserText);
  return hasHan && !hasKana ? STRINGS.zh : STRINGS.en;
}

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

/** 'web' | 'app' — where the conversation happened, for the Admin view.
 *  Anything unrecognised is dropped rather than stored, so a client can't
 *  scribble arbitrary text into the column. */
function parseSurface(raw: unknown): string | null {
  return raw === "web" || raw === "app" ? raw : null;
}

function findToolCall(calls: ToolCall[], name: string): ToolCall | undefined {
  return calls.find((c) => c.name === name);
}

function allToolCalls(calls: ToolCall[], name: string): ToolCall[] {
  return calls.filter((c) => c.name === name);
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
  // Returns the BODY, not a Response: the caller hands it to answer() so a
  // degraded exchange lands in the transcript like any other. A chat that
  // went wrong is the one worth reading back.
  return { reply, proposal: null, proposals: [] as unknown[], action: null, suggestions };
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
/** hashIp() throws when the salt is missing (see rateLimitVerdict below);
 *  for complaint bookkeeping a null hash is fine — the row just carries no
 *  IP fingerprint. */
function safeIpHash(request: Request): string | null {
  try {
    return hashIp(clientIp(request));
  } catch {
    return null;
  }
}

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

  // Fetched with the menu: a paused shop must not have Mandy cheerfully
  // taking delivery orders /api/orders will refuse. The customer's own
  // promo state comes from the same helpers /api/me uses, so Mandy quotes
  // the numbers they already see on their account page — and can answer
  // "我可以免费换了吗" with their actual star count instead of guessing.
  // One round of parallel work, not two. The campaign lookups don't depend
  // on who is asking, so they belong in this batch rather than in a second
  // await after it — the model call is expensive enough without adding a
  // serialized Supabase hop in front of it.
  const [menu, deliveryPause, customer, campaigns] = await Promise.all([
    getMenu(),
    getDeliveryPause(),
    readCustomerPromoState(request),
    fetchPromoCampaigns(),
  ]);
  const promotions = await getLivePromotions(customer, campaigns);
  const lastUserText = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const t = stringsFor(lastUserText);

  // Transcript for the Admin log. Written on the way out of every
  // customer-visible path (including degrades — a conversation that went
  // wrong is the one worth reading), and never awaited: logging must not
  // add latency to a reply, and must never be why a chat fails.
  const ipHash = safeIpHash(request);
  const conversationId =
    normalizeConversationId((raw as { conversationId?: unknown }).conversationId) ??
    fallbackConversationId(ipHash, new Date());
  const surface = parseSurface((raw as { surface?: unknown }).surface);
  // Which client is asking, for the store digest's pickup-window wording.
  // Header/User-Agent, never the body: the app has always sent
  // x-client-platform (and its UA is classifiable anyway), so this needs no
  // app release — see client-platform.ts.
  const clientPlatform = clientPlatformFrom(
    request.headers.get("x-client-platform"),
    request.headers.get("user-agent"),
  );
  const userTurnIndex = history.length - 1;

  function answer(body: {
    reply: string;
    proposal: unknown;
    proposals: unknown[];
    action: string | null;
    suggestions: unknown[];
    /** Server-authored promotion cards; the model only picks which key. */
    promotions?: Promotion[];
    /** True when the reply should carry a sign-in card — set by the
     *  order-status path when the asker turned out to be signed out. */
    signIn?: boolean;
    /** True when the reply should render the mystery box card. */
    mysteryBox?: boolean;
    /** The validated secret code the box was unlocked with — the client
     *  sends it back on open. */
    mysteryBoxCode?: string;
  }): Response {
    void recordChatTurns([
      {
        conversationId,
        turnIndex: userTurnIndex,
        role: "user",
        content: lastUserText,
        surface,
        ipHash,
      },
      {
        conversationId,
        turnIndex: userTurnIndex + 1,
        role: "assistant",
        content: body.reply,
        surface,
        ipHash,
        proposalCount: body.proposals.length,
        action: body.action,
      },
    ]);
    return json(body);
  }

  const script = scriptHint(
    history.filter((m) => m.role === "user").map((m) => m.content),
  );

  const messages: DeepSeekMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(
        menu,
        deliveryPause,
        promotions,
        nearRewardNudge(customer),
        script,
        clientPlatform,
      ),
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // check_order_status bookkeeping. The report is cached so a model that
  // repeats the call cannot hit Square twice in one request; the budget is
  // raised by exactly one the first time, because a status turn legitimately
  // needs an extra round-trip (call → tool result → composed answer) and
  // must not eat the validation loop's only retry.
  let orderStatusReport: string | null = null;
  // Sticky across attempts: once the lookup says "signed out", every later
  // answer in this request carries the sign-in card, no matter which loop
  // branch finally replies.
  let offerSignIn = false;
  // One budget bump per request for an invalid mystery code, mirroring the
  // order-status round.
  let mysteryBudgetSpent = false;
  let maxAttempts = MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      return answer(degraded(
        t.unreachableWithSuggestions,
        t.unreachableNoSuggestions,
        fallbackMatch(menu, lastUserText),
      ));
    }

    // Answered in a script this customer has never used? Ask again rather
    // than send it. The prompt already carries the hint and still misses
    // roughly 1 turn in 10 on production for an open-ended question, and no
    // amount of further rewording fixes a sampling tail — this is the gate
    // that does not depend on the model cooperating.
    //
    // Restricted to turns with no tool calls, which is where every observed
    // failure lives: it keeps a retry from re-running a validated drink
    // proposal, and leaves the attempt budget to the validation loop below
    // for the turns that actually need it. On the final attempt the reply is
    // sent as-is — a customer reading the wrong language beats a customer
    // reading nothing.
    if (
      result.toolCalls.length === 0 &&
      violatesScriptHint(script, result.content) &&
      attempt < maxAttempts
    ) {
      messages[0] = {
        role: "system",
        content: `${messages[0].content}\n${SCRIPT_RETRY_NOTE}`,
      };
      continue;
    }

    // A complaint outranks everything else the model did this turn — the
    // customer who says "wrong order, and also get me a taro tea" still
    // deserves the complaint filed first; drinks can be re-proposed next
    // turn if the model dropped them.
    const complaintCall = findToolCall(result.toolCalls, "file_complaint");
    if (complaintCall) {
      // Did anything actually go wrong? A customer asking "我可以免费换了吗"
      // got an apology, a filed complaint and a request for their order
      // number (2026-08-12) — they were asking about their loyalty reward.
      // Feed the refusal back and let the model answer properly instead.
      const allCustomerText = history
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      const verdict = guardComplaint(allCustomerText);
      if (!verdict.allow) {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: complaintCall.id,
              type: "function",
              function: { name: complaintCall.name, arguments: complaintCall.argumentsJson },
            },
          ],
        });
        messages.push({
          role: "tool",
          tool_call_id: complaintCall.id,
          content: verdict.reason,
        });
        continue;
      }

      let filing: ComplaintFiling = { summary: "" };
      try {
        filing = JSON.parse(complaintCall.argumentsJson) as ComplaintFiling;
      } catch {
        // Model text still acknowledges; the filing falls back to the raw
        // customer message so the complaint is never dropped on a JSON slip.
      }
      if (!filing || typeof filing.summary !== "string" || !filing.summary.trim()) {
        filing = { ...filing, summary: lastUserText };
      }
      const { stored, emailed } = await fileChatComplaint(
        filing,
        safeIpHash(request),
      );
      if (!stored && !emailed) {
        console.error("[chat] complaint neither stored nor emailed — customer promise withheld");
        return answer({
          reply: t.emptyReplyFallback,
          proposal: null,
          proposals: [],
          action: null,
          suggestions: [],
        });
      }
      return answer({
        reply: scrubPrices(result.content) || t.complaintAck,
        proposal: null,
        proposals: [],
        action: null,
        suggestions: [],
      });
    }

    // Mystery box — unlocked by an Instagram secret code, and the SERVER
    // judges the code (the model was told to pass anything password-shaped
    // through). Valid → terminal offer like a promotion card: the client
    // renders a CLOSED box carrying the code; the prize doesn't exist until
    // the tap (the open endpoint re-validates and draws). Invalid → the
    // verdict goes back as a tool message so the model can sell the
    // treasure hunt in the customer's language. Signed-out gets the
    // sign-in card with FIXED copy, because the model's own sentence may
    // already be promising a box we're not rendering.
    const mysteryCall = findToolCall(result.toolCalls, "offer_mystery_box");
    if (mysteryCall) {
      if (!customer) {
        return answer({
          reply: t.mysteryBoxSignIn,
          proposal: null,
          proposals: [],
          action: null,
          suggestions: [],
          signIn: true,
        });
      }
      let code = "";
      try {
        const parsed = JSON.parse(mysteryCall.argumentsJson) as { code?: unknown };
        if (typeof parsed.code === "string") code = parsed.code;
      } catch {
        // malformed → treated as an invalid code below
      }
      if (code && (await isActiveMysteryCode(code))) {
        return answer({
          reply: scrubPrices(result.content) || t.mysteryBoxOffer,
          proposal: null,
          proposals: [],
          action: null,
          suggestions: [],
          mysteryBox: true,
          mysteryBoxCode: code,
        });
      }
      // Wrong code: one extra round so the model can answer properly —
      // same budget treatment as an order-status lookup.
      if (!mysteryBudgetSpent) {
        mysteryBudgetSpent = true;
        maxAttempts += 1;
      }
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: mysteryCall.id,
            type: "function",
            function: { name: mysteryCall.name, arguments: mysteryCall.argumentsJson },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: mysteryCall.id,
        content:
          "That code is not valid right now. Tell the customer (in their language) it didn't match the current code, and that the live code is posted on our Instagram (instagram.com/mandysbubbletea) — follow the account and check the latest posts. Do not reveal or guess any code, and do not offer a box without one.",
      });
      continue;
    }

    // Bulk inquiry — the handoff to Rick for orders self-serve can't take
    // (future pickup, or 50+ cups). Terminal like a complaint: the model's
    // own sentence acknowledges; the fixed ack covers an empty one. When
    // the email did NOT go out, the customer gets the honest failure copy
    // with the store phone — never a callback promise nobody will make.
    const bulkCall = findToolCall(result.toolCalls, "record_bulk_inquiry");
    if (bulkCall) {
      let inquiry: BulkInquiry | null = null;
      try {
        inquiry = JSON.parse(bulkCall.argumentsJson) as BulkInquiry;
      } catch {
        // Malformed arguments — fall through to the failure copy below.
      }
      const { emailed } = inquiry
        ? await sendBulkInquiry(inquiry)
        : { emailed: false };
      if (!emailed) {
        console.error("[chat] bulk inquiry not emailed — handing out the store phone");
        return answer({
          reply: t.bulkInquiryFailed,
          proposal: null,
          proposals: [],
          action: null,
          suggestions: [],
        });
      }
      return answer({
        reply: scrubPrices(result.content) || t.bulkInquiryAck,
        proposal: null,
        proposals: [],
        action: null,
        suggestions: [],
      });
    }

    // Order status. The model may only relay what the lookup reports — it
    // has no other window onto the counter, and before this tool existed it
    // answered "It shows it's ready" by inventing an order that was waiting
    // (2026-08-16). Same feedback shape as the complaint guard: echo the
    // call, hand back the report as a tool message, let the model compose
    // the customer-facing sentence from it on the next round.
    const orderStatusCall = findToolCall(result.toolCalls, "check_order_status");
    if (orderStatusCall) {
      if (orderStatusReport === null) {
        const lookup = await lookupOrderStatusForChat(request);
        orderStatusReport = lookup.report;
        offerSignIn = lookup.signedOut;
        maxAttempts += 1;
      }
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: orderStatusCall.id,
            type: "function",
            function: {
              name: orderStatusCall.name,
              arguments: orderStatusCall.argumentsJson,
            },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: orderStatusCall.id,
        content: orderStatusReport,
      });
      continue;
    }

    // Promotion cards. The model picks a key; the card's words and numbers
    // are the server's, from the same helpers the account page renders —
    // a model-authored discount is a promise checkout won't keep. An
    // unknown key yields no card rather than an invented one.
    const promoCalls = allToolCalls(result.toolCalls, "show_promotion");
    if (promoCalls.length > 0) {
      const keys = new Set<string>();
      for (const call of promoCalls) {
        try {
          const { key } = JSON.parse(call.argumentsJson) as { key?: unknown };
          if (typeof key === "string") keys.add(key);
        } catch {
          // Ignore a malformed pick; the reply text still answers.
        }
      }
      const cards = promotions.filter((p) => keys.has(p.key));
      if (cards.length > 0) {
        return answer({
          reply: scrubPrices(result.content) || cards[0].detail,
          proposal: null,
          proposals: [],
          action: null,
          suggestions: [],
          promotions: cards,
        });
      }
      // Named nothing real — fall through so the turn is answered as plain
      // text rather than silently dropping the model's sentence.
    }

    if (findToolCall(result.toolCalls, "go_checkout")) {
      // Scrub FIRST, then fall back — scrubPrices() can turn a
      // price-only reply into "", and the fallback has to fire on that
      // empty result, not get shadowed by the pre-scrub `||` this used to
      // be written with (which chose the model's text before scrubbing
      // ever got a chance to empty it).
      return answer({
        reply: scrubPrices(result.content) || t.checkoutFallback,
        proposal: null,
        proposals: [],
        action: "checkout",
        suggestions: [],
      });
    }

    const calls = allToolCalls(result.toolCalls, "propose_drink");
    if (calls.length === 0) {
      // Plain conversational turn — a question, a greeting, a refusal.
      // Same scrub-first-then-fallback shape as above; this site had no
      // fallback at all before, so a price-only reply reached the
      // customer as a silently blank bubble.
      //
      // This is also where the order-status round lands one attempt later,
      // so the sign-in card rides here: words from the model, button from
      // the server.
      return answer({
        reply: scrubPrices(result.content) || t.emptyReplyFallback,
        proposal: null,
        proposals: [],
        action: null,
        suggestions: [],
        signIn: offerSignIn || undefined,
      });
    }

    // Validate every propose_drink call in this reply — a multi-drink
    // order arrives as several tool calls in one turn. Each call gets a
    // verdict; the turn succeeds only if every call validated, so a card
    // can never silently omit a drink the model told the customer about.
    const verdicts: { call: ToolCall; validated: ValidationResult }[] = [];
    for (const call of calls) {
      let parsed: DrinkProposal | null = null;
      try {
        parsed = JSON.parse(call.argumentsJson) as DrinkProposal;
      } catch {
        verdicts.push({
          call,
          validated: { ok: false, errors: ["Your tool arguments were not valid JSON. Emit valid JSON."] },
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
        validated = validateProposal(menu, parsed, lastUserText);
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
      verdicts.push({ call, validated });
    }

    const failed = verdicts.filter((v) => !v.validated.ok);
    if (failed.length === 0) {
      const values = verdicts.map((v) =>
        (v.validated as Extract<ValidationResult, { ok: true }>).value,
      );
      const proposals = values.map(toApiProposal);
      // Scrub-first-then-fallback again, with a two-step fallback chain:
      // the model's own text, then its (also scrubbed — it can quote a
      // price too) one-line reason for the first pick, then the fixed
      // string.
      return answer({
        reply:
          scrubPrices(result.content) ||
          scrubPrices(values[0].reason) ||
          t.emptyReplyFallback,
        // Kept for one release so a client rendered from the previous
        // deploy keeps working mid-session: old JS reads `proposal`, new
        // JS reads `proposals`. Remove after this ships.
        proposal: proposals[0] ?? null,
        proposals,
        action: null,
        suggestions: [],
      });
    }

    // Hand the failures back verbatim. A bare "try again" produces a
    // reroll; the specific errors produce a correction. The OpenAI tool
    // protocol wants the assistant turn echoed with ALL of its tool calls
    // and then one tool message per call id — including the ones that
    // passed, or the reply is malformed and the retry never happens.
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: verdicts.map(({ call }) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    });
    for (const { call, validated } of verdicts) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: validated.ok
          ? "This proposal is valid — repeat it unchanged alongside the fixes."
          : `That proposal was rejected:\n- ${validated.errors.join("\n- ")}\nFix every point and call propose_drink again with ids copied from the menu.`,
      });
    }
  }

  return answer({
    ...degraded(
      t.noMatchWithSuggestions,
      t.noMatchNoSuggestions,
      fallbackMatch(menu, lastUserText),
    ),
    signIn: offerSignIn || undefined,
  });
}
