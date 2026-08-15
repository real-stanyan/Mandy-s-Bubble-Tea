import { describe, it, expect } from "vitest";
import { shouldStopListening, SILENCE_MS, MAX_LISTEN_MS } from "./listening";

const t0 = 1_000_000;

describe("deciding when a spoken report has finished", () => {
  it("keeps listening through a pause for thought", () => {
    // The bug this replaces: the recogniser closed on the first breath and
    // sent half a sentence. Two seconds mid-sentence is somebody thinking.
    expect(shouldStopListening(t0 + 2000, t0, t0 + 1800)).toBe(false);
  });

  it("stops once the pause is long enough to be an ending", () => {
    expect(shouldStopListening(t0 + SILENCE_MS, t0, t0)).toBe(true);
  });

  it("closes a microphone that was opened by accident", () => {
    // Nothing heard at all: lastHeardAt is the start, so the silence rule
    // still fires rather than leaving it open on the counter.
    expect(shouldStopListening(t0 + SILENCE_MS + 1, t0, t0)).toBe(true);
  });

  it("closes eventually even in a room that never falls silent", () => {
    // A busy shop can keep the recogniser hearing something forever. Someone
    // still has to be able to walk away from it.
    const neverSilent = t0 + MAX_LISTEN_MS;
    expect(shouldStopListening(neverSilent, t0, neverSilent - 100)).toBe(true);
  });

  it("gives long enough to say something real, and not longer", () => {
    // Guards both ends: a second would clip people, five minutes would be a
    // hot mic behind a counter.
    expect(SILENCE_MS).toBeGreaterThanOrEqual(2000);
    expect(SILENCE_MS).toBeLessThanOrEqual(4000);
    expect(MAX_LISTEN_MS).toBeLessThanOrEqual(60_000);
  });
});
