# 0011 — Scheduled pickup holds the cup label, because that's the only ticket left

Date: 2026-08-17
Status: accepted

## Context

PR #274 shipped scheduled pickup: the customer picks a collection time and the
shop holds the ticket until pickup-time minus a five-minute make lead, so the
ice isn't melting before anyone arrives. The hold was implemented as
`print_due_at` / `pickup_at` on `print_jobs` — the ZD411 receipt-sticker queue —
and the printer-client's `print_jobs` consumer learned to skip rows that aren't
due yet.

Issue #275 then asked Stan to update the store Mac mini so its printer-client
would honour the new column. Probing the machine over the Tailscale SSH path
showed the premise was wrong:

- One printing daemon runs at the store: `com.mandysbubbletea.printer-client-cup-label`,
  consuming `cup_label_jobs` and writing ZPL straight to the ZD410 over USB.
- The `print_jobs` consumer's launchd job is `…printer-client.plist.disabled`.
  The last `print_jobs` row printed **2026-05-22** — the day the ZD410 cup-label
  pipeline went live. ~19k rows have accumulated `pending` since, `claimed_by`
  null on every one.
- `cup_label_jobs` had no due column and no gating at all.

So the feature was a no-op at the shop, and would have stayed one after any
amount of client updating: the label staff actually make drinks from carries the
drink name, ice, sugar and toppings, and it printed the moment the order landed.
Confirmed with Stan 2026-08-17: the ZD411 is deliberately retired, cup labels are
the only ticket.

## Decision

**Scheduled-pickup timing lives on `cup_label_jobs`, and the cup-label consumer
is the thing that waits.** Concretely:

1. `print_due_at` / `pickup_at` added to `cup_label_jobs` with the same
   semantics as on `print_jobs` — NULL means due now, so every ASAP order and
   every pre-existing row is unaffected.
2. Every pending-row query in the cup-label pipeline carries the due predicate:
   replay, poll, the stale sweep, the heartbeat's `pending_count`, and the
   pending-age alert. A held row is not backlog and must not page the owner.
3. The Realtime INSERT handler drops a not-yet-due row on the floor. The INSERT
   fires at checkout; the 15s poll is what surfaces the row once it's due.
4. Both enqueue sides derive the pair from one helper, `printTimingFor` in
   `src/lib/pickup-schedule.ts`, reading the order's own pickup fulfillment.
   The receipt path now calls it too, so the two queues cannot drift.
5. The label prints `PU 5:45pm` in the top band for a scheduled order — the
   counter's question about a cup waiting on the bench is "when do they come for
   it". ASAP labels render dot-for-dot as before.

The `print_jobs` columns and gating stay where they are. They are correct code
on a dormant queue; removing them belongs with the rest of the ZD411 retirement
(#283), not here.

## Consequences

- Scheduled pickup works at the shop for the first time, and the mechanism is
  now attached to the pipeline someone would notice breaking.
- The pending-age alert measures from `max(created_at, print_due_at)`. A held
  row that goes on to jam still alerts, but dated from when it became printable.
- A held order's labels all share one due time, so a multi-cup order still
  surfaces as one batch.
- The cup-label poll cadence (15s) is now load-bearing rather than a fallback:
  it is the only path that surfaces a held row. Worst case a due label prints
  15s late, which is inside the five-minute lead.
- Hold windows stay short by construction — the pills top out at 30 minutes and
  the lead is 5 — so a held row can never outlive the 2h stale window while
  the machine is up.
