import type { PrizePool, PrizePoolEntry, PrizeType } from "./types";

const VALID_TYPES: ReadonlyArray<PrizeType> = [
  "thank_you",
  "digital",
  "physical",
];

export function parsePrizePool(input: unknown): PrizePool {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(raw)) {
    throw new Error("prize_pool must be an array");
  }
  const seen = new Set<string>();
  const out: PrizePoolEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("prize_pool entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.tier_id !== "string" || e.tier_id.length === 0) {
      throw new Error("prize_pool entry missing tier_id");
    }
    if (typeof e.weight !== "number" || !Number.isFinite(e.weight)) {
      throw new Error(`prize_pool entry ${e.tier_id} missing numeric weight`);
    }
    if (e.weight < 0) {
      throw new Error(
        `prize_pool entry ${e.tier_id} has negative weight ${e.weight}`,
      );
    }
    if (typeof e.type !== "string" || !VALID_TYPES.includes(e.type as PrizeType)) {
      throw new Error(
        `prize_pool entry ${e.tier_id} has invalid type ${String(e.type)}`,
      );
    }
    if (seen.has(e.tier_id)) {
      throw new Error(`prize_pool has duplicate tier_id ${e.tier_id}`);
    }
    seen.add(e.tier_id);
    out.push(entry as PrizePoolEntry);
  }
  return out;
}

export function totalWeight(pool: PrizePool): number {
  return pool.reduce((sum, e) => sum + e.weight, 0);
}

export function validatePrizePool(pool: PrizePool): void {
  if (totalWeight(pool) <= 0) {
    throw new Error("prize_pool total weight must be > 0");
  }
  for (const entry of pool) {
    if (entry.type === "physical") {
      const payload = entry.payload as { label?: string };
      if (!payload || typeof payload.label !== "string" || payload.label.length === 0) {
        throw new Error(
          `prize_pool entry ${entry.tier_id} (physical) missing payload.label`,
        );
      }
    }
    if (entry.type === "digital") {
      const payload = entry.payload as { kind?: string };
      if (payload?.kind === "discount") {
        const p = payload as { amount_cents?: number };
        if (typeof p.amount_cents !== "number" || p.amount_cents <= 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (discount) missing payload.amount_cents`,
          );
        }
      } else if (payload?.kind === "free_modifier") {
        const p = payload as { modifier_id?: string };
        if (typeof p.modifier_id !== "string" || p.modifier_id.length === 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (free_modifier) missing payload.modifier_id`,
          );
        }
      } else if (payload?.kind === "free_drink") {
        const p = payload as { max_cents?: number };
        if (typeof p.max_cents !== "number" || p.max_cents <= 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (free_drink) missing payload.max_cents`,
          );
        }
      } else {
        throw new Error(
          `prize_pool entry ${entry.tier_id} has unknown digital kind ${String(payload?.kind)}`,
        );
      }
    }
  }
}
