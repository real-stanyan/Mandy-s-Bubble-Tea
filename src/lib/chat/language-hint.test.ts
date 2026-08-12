import { describe, it, expect } from "vitest";
import { scriptHint, violatesScriptHint } from "@/lib/chat/language-hint";

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

describe("violatesScriptHint", () => {
  const latin = scriptHint(["what do you recommend?"]);

  it("catches the production failure: English asked, Chinese answered", () => {
    expect(violatesScriptHint(latin, "想喝偏甜的还是清爽果茶？")).toBe(true);
  });

  it("passes a reply in the customer's own script", () => {
    expect(violatesScriptHint(latin, "Sweet or fresh? I'd go with the Brown Sugar.")).toBe(false);
  });

  it("never fires without a hint, so a CJK customer is untouchable", () => {
    // scriptHint() returns null for them, and this must then be inert no
    // matter what the reply says — otherwise the retry loop would fight a
    // Chinese customer's own language.
    expect(violatesScriptHint(null, "想喝偏甜的还是清爽果茶？")).toBe(false);
    expect(violatesScriptHint(scriptHint(["有什么推荐"]), "喝奶茶吧")).toBe(false);
  });

  it("catches a drink name left in the customer's script but the sentence not", () => {
    // The realistic partial failure: an English reply that slips one
    // Chinese clause in. A whole-reply check would miss a per-sentence rule.
    expect(violatesScriptHint(latin, "Sure! 想喝点什么？")).toBe(true);
  });

  it("tolerates an empty reply", () => {
    expect(violatesScriptHint(latin, "")).toBe(false);
  });
});
