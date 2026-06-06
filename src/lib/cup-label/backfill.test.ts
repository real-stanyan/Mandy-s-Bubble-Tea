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
});
