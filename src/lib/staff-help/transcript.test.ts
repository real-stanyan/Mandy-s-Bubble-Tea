import { describe, it, expect } from "vitest";
import { chooseTranscript } from "./transcript";

describe("choosing what to send from a speech session", () => {
  it("sends the interim text when the browser never marked anything final", () => {
    // The bug seen in the shop on 15 August, on iOS Safari: this sentence was
    // showing correctly in the live transcript and was silently discarded.
    expect(chooseTranscript("", "现在店里正常吗")).toBe("现在店里正常吗");
  });

  it("prefers the final text, which is the browser's settled reading", () => {
    expect(chooseTranscript("cards keep declining", "cards keep")).toBe("cards keep declining");
  });

  it("sends nothing when nothing was heard", () => {
    // A mic opened by accident behind the counter must not send an empty
    // message and burn a model call on it.
    expect(chooseTranscript("", "")).toBe("");
    expect(chooseTranscript("   ", "  ")).toBe("");
  });

  it("trims, so whitespace is not mistaken for speech", () => {
    expect(chooseTranscript("  ", "카드가 계속 안 돼요 ")).toBe("카드가 계속 안 돼요");
  });
});
