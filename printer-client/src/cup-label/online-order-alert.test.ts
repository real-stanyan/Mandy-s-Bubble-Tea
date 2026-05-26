// printer-client/src/cup-label/online-order-alert.test.ts
//
// Regression for the "online orders went silent" bug (2026-05-26):
// commit 0be1ffa4 moved the OL audible cue from the retired ZD411
// receipt client to this cup-label client but dropped the
// ensureAudioOutput() call. With the Soundbar paired over AirPlay the
// default output drifts on reconnect/reboot and afplay plays into a
// dead device. The alert path must re-assert the output device on every
// play, BEFORE shelling out to afplay.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as string[] }));

// Fake child_process.spawn that records the command sequence and drives
// each fake process to a clean exit so the awaited helpers resolve.
vi.mock("node:child_process", () => ({
  spawn: vi.fn((cmd: string) => {
    spawnCalls.push(cmd);
    const proc = {
      stdout: {
        on: (ev: string, cb: (chunk: Buffer) => void) => {
          // SwitchAudioSource -c prints the current device; echo back the
          // configured target so ensureAudioOutput sees "already correct"
          // and resolves after a single check (no -s call needed).
          if (cmd === "SwitchAudioSource" && ev === "data") {
            cb(Buffer.from("Test Soundbar"));
          }
        },
      },
      stderr: { on: () => {} },
      on: (ev: string, cb: (code: number) => void) => {
        if (ev === "exit") cb(0);
        return proc;
      },
      unref: () => proc,
    };
    return proc;
  }),
}));

vi.mock("../config", () => ({
  config: { audioOutputDevice: "Test Soundbar" },
}));

const { playOnlineOrderAlert } = await import("./online-order-alert");

beforeEach(() => {
  spawnCalls.length = 0;
});

describe("playOnlineOrderAlert", () => {
  it("enforces the output device before playing the sound", async () => {
    await playOnlineOrderAlert();

    // The regression: SwitchAudioSource (ensureAudioOutput) must run, and
    // it must run before afplay — otherwise the sound plays into whatever
    // device macOS drifted to.
    expect(spawnCalls).toContain("SwitchAudioSource");
    expect(spawnCalls).toContain("afplay");
    const switchIdx = spawnCalls.indexOf("SwitchAudioSource");
    const afplayIdx = spawnCalls.indexOf("afplay");
    expect(switchIdx).toBeLessThan(afplayIdx);
  });

  it("still plays the afplay cue", async () => {
    await playOnlineOrderAlert();
    expect(spawnCalls.filter((c) => c === "afplay")).toHaveLength(1);
  });
});
