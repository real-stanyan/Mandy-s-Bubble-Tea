import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getEffectiveOrderingStatus,
  __resetPosBackupCacheForTests,
} from "./store-status-server";

const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

// Brisbane is fixed UTC+10 (no DST). Build Date objects from explicit
// `+10:00` ISO strings so the test stays clear about wall-clock intent
// regardless of the host clock.
function brisbane(ymd: string, hh: number, mm: number): Date {
  const hhStr = String(hh).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return new Date(`${ymd}T${hhStr}:${mmStr}:00+10:00`);
}

describe("getEffectiveOrderingStatus", () => {
  beforeEach(() => {
    __resetPosBackupCacheForTests();
    mockMaybeSingle.mockReset();
  });

  it("pos_backup_mode=true: 22:14 BNE → open with 'until 10:30pm'", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect(await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 14)))
      .toEqual({ open: true, nextLabel: "until 10:30pm" });
  });

  it("pos_backup_mode=true: 22:15 BNE → still open (backup mode kills cutoff)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(true);
  });

  it("pos_backup_mode=true: 22:29 BNE → open", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 29))).open).toBe(true);
  });

  it("pos_backup_mode=true: 22:30 BNE → closed", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    const status = await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 30));
    expect(status.open).toBe(false);
    expect(status.nextLabel.startsWith("Opens")).toBe(true);
  });

  it("pos_backup_mode=false: 22:14 BNE → open with 'until 10:15pm'", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: false }, error: null });
    expect(await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 14)))
      .toEqual({ open: true, nextLabel: "until 10:15pm" });
  });

  it("pos_backup_mode=false: 22:15 BNE → closed (cutoff hits)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: false }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });

  it("pos_backup_mode=true: 10:29 BNE → still closed (open-time unchanged)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 10, 29))).open).toBe(false);
  });

  it("setting row missing → falls back to default (false / with_cutoff)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });

  it("supabase fetch throws → falls back to default (defensive)", async () => {
    mockMaybeSingle.mockRejectedValue(new Error("network down"));
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });
});
