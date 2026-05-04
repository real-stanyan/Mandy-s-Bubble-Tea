import { randomInt } from "node:crypto";
import type { PrizePool, PrizePoolEntry } from "./types";

export type RandomFn = () => number;

export function makeSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function defaultRandom(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

export function rollWeighted(
  pool: PrizePool,
  rng: RandomFn = defaultRandom,
): PrizePoolEntry {
  if (pool.length === 0) {
    throw new Error("rollWeighted: pool is empty");
  }
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) {
    throw new Error("rollWeighted: total weight is 0");
  }
  const target = rng() * total;
  let cumulative = 0;
  for (const entry of pool) {
    cumulative += entry.weight;
    if (target < cumulative) {
      return entry;
    }
  }
  return pool[pool.length - 1]!;
}
