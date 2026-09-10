# 0012 — Push Center: audiences from a state table, one ledger row per device, a person presses send

Date: 2026-09-10
Status: accepted

## Context

Every marketing push so far has been a one-off script (`scripts/broadcast-*.ts`)
or the two-campaign `/admin/loyalty-push` panel. The 2026-09-10 analysis of
32,639 Square orders (`~/mandy/operations/snapshots/2026-09-10/`) found four
audiences worth a message — the 9/7 specials push lifted online orders 35%
that day, the 8/4 "1–2 stars short" nudge had 36% redeem inside two weeks,
half of all second orders happen inside ten days of the first, regulars come
back every nine days — and three things the current setup cannot do:

1. **Audiences need order history.** "One order, 5–14 days ago" or "quiet for
   1.5× their own usual gap" is a question about every customer's orders.
   Paging 30k Square orders inside a request is neither fast nor polite.
2. **Sends leave no ledger.** The 8/24 specials push has no recorded send
   time; its effect had to be inferred from a commit timestamp. And as #384
   says, an accepted ticket is not a delivery — nothing stored the receipts.
3. **Stan wants to press the button.** The analysis proposed a fully
   automatic scheduler; the decision (2026-09-10) is that the data does the
   counting and the owner decides when. Hot-day and quiet-kitchen sends are
   judgement calls, and a wrong automatic push costs opt-outs that never
   come back.

## Decision

- **`push_customer_state`, one row per Square customer**, folded from
  COMPLETED (or paid) orders: first/last order, count, the newest 30 orders
  (for the personal median gap and idempotent re-scans), top items, evening
  share. A cron (`/api/cron/push-state-refresh`, every 30 min) moves a
  cursor forward with a 10-minute settle lag; `scripts/push-state-backfill.ts`
  does the first fill. Audiences are built from this table plus a live star
  scan, never from Square orders directly.
- **`/staff/push` behind the owner passcode** is the only way to send. Ten
  campaigns live in `src/lib/push-center/campaigns.ts` as pure predicates +
  templates; the page shows the funnel (matched → has app → cooldown → weekly
  cap → bought today → holdout → devices) and three rendered samples before
  a confirm. The weekly-specials copy is drafted from the shelf config and
  live Square prices and fingerprinted; a price that moves between preview
  and send refuses the send.
- **Guardrails live in the audience builder**, not in the UI: per-campaign
  cooldown, ≤2 marketing pushes per person per 7 days with ≥48 h between,
  skip buyers of the last 24 h, optional stable 10% holdout, preview→send
  drift refusal, quiet hours (10:30–20:30 Brisbane) as a warning that needs
  an explicit tick.
- **`push_runs` + `push_run_recipients`**: one row per device per send with
  the Expo ticket id and, ten seconds later (or on demand), the receipt —
  success included. Cooldown and the cap read this ledger by `user_id`; the
  legacy `loyalty_push_recipients` (phone-keyed) is honoured for the two
  loyalty campaigns.

## Consequences

- Sending is manual by design. If that ever changes, the scheduler is a cron
  route that calls `buildAudience` + `sendRun` with the same guardrails; the
  page does not have to move.
- The state table is at most 30 minutes behind the till, and only as deep as
  the backfill window (120 days). A customer's `order_count` is "orders in
  the window", which is what every rule here wants.
- The old `/admin/loyalty-push` page and the broadcast scripts keep working
  but are superseded; their sends do not appear in `push_runs`.
- Order-ready and Live Activity pushes are untouched by this ADR; the
  per-token ledger #384 asks for on that path is a separate change.
