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

const { spawnCalls, spawnArgs } = vi.hoisted(() => ({
  spawnCalls: [] as string[],
  spawnArgs: [] as string[][],
}));

// Fake child_process.spawn that records the command sequence and drives
// each fake process to a clean exit so the awaited helpers resolve.
vi.mock("node:child_process", () => ({
  spawn: vi.fn((cmd: string, args?: string[]) => {
    spawnCalls.push(cmd);
    spawnArgs.push(args ?? []);
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

const { playOnlineOrderAlert, startBluetoothKeepalive } = await import(
  "./online-order-alert"
);

beforeEach(() => {
  spawnCalls.length = 0;
  spawnArgs.length = 0;
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

// 2026-05-29: the soundbar plays both music and the order cue over
// Bluetooth. macOS/the soundbar idle-disconnects the A2DP link when no
// audio streams between orders, so a cue landing on a cold link is
// silent. A periodic INAUDIBLE play keeps the link warm. It must NOT
// touch the output device — switching the default away from the BT
// soundbar is itself what drops the link (observed same day).
describe("startBluetoothKeepalive", () => {
  it("plays an inaudible (-v 0) keepalive on its interval", async () => {
    vi.useFakeTimers();
    const timer = startBluetoothKeepalive(1000);
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(spawnCalls).toContain("afplay");
      const idx = spawnCalls.indexOf("afplay");
      expect(spawnArgs[idx].slice(0, 2)).toEqual(["-v", "0"]);
    } finally {
      clearInterval(timer);
      vi.useRealTimers();
    }
  });

  it("never switches the output device (switching away drops the BT link)", async () => {
    vi.useFakeTimers();
    const timer = startBluetoothKeepalive(1000);
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(spawnCalls).not.toContain("SwitchAudioSource");
    } finally {
      clearInterval(timer);
      vi.useRealTimers();
    }
  });
});
