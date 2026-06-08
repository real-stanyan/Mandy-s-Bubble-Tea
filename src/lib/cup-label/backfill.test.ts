import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression: OL826 (2026-06-06). The payment route claimed print_jobs and
// scheduled its cup-label enqueue post-response; Vercel froze the lambda
// before it ran, then the webhook saw a print_jobs conflict and skipped its
// own enqueue — zero cup_label_jobs rows, zero labels printed. The webhook
// conflict branch now backfills via this helper.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("./enqueue", () => ({
  enqueueCupLabelJobs: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { enqueueCupLabelJobs } from "./enqueue";
import { backfillCupLabelJobsIfMissing } from "./backfill";

const ORDER = { id: "ord_ol826" } as never;

function mockSb({
  cupJobCount,
  stickerNumber,
}: {
  cupJobCount: number;
  stickerNumber: string | null;
}) {
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: (table: string) => {
      if (table === "cup_label_jobs") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ count: cupJobCount, error: null }),
          }),
        };
      }
      // print_jobs
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: stickerNumber ? { sticker_number: stickerNumber } : null,
                error: null,
              }),
          }),
        }),
      };
    },
  });
}

describe("backfillCupLabelJobsIfMissing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues with the print_jobs sticker number when no cup_label_jobs exist", async () => {
    mockSb({ cupJobCount: 0, stickerNumber: "OL826" });
    const ran = await backfillCupLabelJobsIfMissing({ order: ORDER, mode: "web" });
    expect(ran).toBe(true);
    expect(enqueueCupLabelJobs).toHaveBeenCalledWith({
      order: ORDER,
      stickerNumber: "OL826",
      mode: "web",
    });
  });

  it("does nothing when cup_label_jobs rows already exist", async () => {
    mockSb({ cupJobCount: 2, stickerNumber: "OL826" });
    const ran = await backfillCupLabelJobsIfMissing({ order: ORDER, mode: "web" });
    expect(ran).toBe(false);
    expect(enqueueCupLabelJobs).not.toHaveBeenCalled();
  });

  it("does nothing when the order has no print_jobs claim", async () => {
    mockSb({ cupJobCount: 0, stickerNumber: null });
    const ran = await backfillCupLabelJobsIfMissing({ order: ORDER, mode: "web" });
    expect(ran).toBe(false);
    expect(enqueueCupLabelJobs).not.toHaveBeenCalled();
  });

  it("does nothing when the order has no id", async () => {
    mockSb({ cupJobCount: 0, stickerNumber: "OL826" });
    const ran = await backfillCupLabelJobsIfMissing({
      order: {} as never,
      mode: "pos",
    });
    expect(ran).toBe(false);
    expect(enqueueCupLabelJobs).not.toHaveBeenCalled();
  });

  // Regression: OL "photo → tarot" (2026-06-08). The printer fires on
  // cup_label_jobs INSERT only; the payment route's authoritative enqueue
  // is deferred via after() and lands as an UPDATE-on-conflict. When the
  // webhook backfilled web-mode DEFAULTS (tarot) immediately, that default
  // INSERT printed before the customer's photo UPDATE could land — and the
  // UPDATE never reprints. The grace delay makes the count check wait until
  // the deferred payment enqueue has had time to win the INSERT.
  describe("graceMs (delayed re-check)", () => {
    it("waits graceMs before checking, so rows that land during the grace window suppress the backfill", async () => {
      vi.useFakeTimers();
      try {
        let count = 0;
        (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
          from: (table: string) => {
            if (table === "cup_label_jobs") {
              return {
                select: () => ({
                  // read `count` at call time (post-grace)
                  eq: () => Promise.resolve({ count, error: null }),
                }),
              };
            }
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { sticker_number: "OL900" },
                      error: null,
                    }),
                }),
              }),
            };
          },
        });

        const p = backfillCupLabelJobsIfMissing({
          order: ORDER,
          mode: "web",
          graceMs: 8000,
        });
        // Still inside the grace window — nothing checked or enqueued yet.
        await vi.advanceTimersByTimeAsync(0);
        expect(enqueueCupLabelJobs).not.toHaveBeenCalled();

        // Payment route's after() enqueue lands the real rows mid-grace.
        count = 3;
        await vi.advanceTimersByTimeAsync(8000);

        const ran = await p;
        expect(ran).toBe(false);
        expect(enqueueCupLabelJobs).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("still backfills after graceMs when the order is genuinely label-less", async () => {
      vi.useFakeTimers();
      try {
        mockSb({ cupJobCount: 0, stickerNumber: "OL901" });
        const p = backfillCupLabelJobsIfMissing({
          order: ORDER,
          mode: "web",
          graceMs: 8000,
        });
        await vi.advanceTimersByTimeAsync(8000);
        const ran = await p;
        expect(ran).toBe(true);
        expect(enqueueCupLabelJobs).toHaveBeenCalledWith({
          order: ORDER,
          stickerNumber: "OL901",
          mode: "web",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
