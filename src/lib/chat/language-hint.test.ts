import { describe, it, expect } from "vitest";
import { scriptHint } from "@/lib/chat/language-hint";

describe("scriptHint", () => {
  it("pins Latin script for a customer writing English", () => {
    expect(scriptHint(["App for android"])).toMatch(/Latin alphabet/);
  });

  it("stays silent for a customer writing Chinese", () => {
    expect(scriptHint(["你们有安卓 App 吗？"])).toBeNull();
  });

  it("stays silent for Japanese and Korean", () => {
    expect(scriptHint(["アプリはありますか"])).toBeNull();
    expect(scriptHint(["안드로이드 앱 있나요?"])).toBeNull();
  });

  it("stays silent once ANY message used a CJK script, not just the last", () => {
    // The failure this guards: a customer opens in Chinese, then types a
    // drink name in Latin letters. Reading only the newest message would
    // pin them to English mid-conversation.
    expect(scriptHint(["有什么推荐", "Brown Sugar Milk Tea"])).toBeNull();
  });

  it("stays silent when there is no real word to judge", () => {
    // An order number or a bare acknowledgement is not evidence of a
    // language, and guessing from it is how a wrong pin would ship.
    expect(scriptHint(["12345"])).toBeNull();
    expect(scriptHint([""])).toBeNull();
    expect(scriptHint([])).toBeNull();
    expect(scriptHint(["👍"])).toBeNull();
  });

  it("fires for Latin-script languages that are not English", () => {
    // The hint claims script, never language — it must not need to know
    // which language this is to be correct about the alphabet.
    expect(scriptHint(["Habt ihr eine App?"])).toMatch(/Latin alphabet/);
    expect(scriptHint(["Apakah ada aplikasi Android?"])).toMatch(/Latin alphabet/);
  });

  it("names no language, so it cannot prime one", () => {
    const hint = scriptHint(["hello there"])!;
    expect(hint).not.toMatch(/Chinese|English|Japanese|Korean/);
  });
});
