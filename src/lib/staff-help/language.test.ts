import { describe, it, expect } from "vitest";
import { detectLanguage, languageDirective, SPEECH_LOCALE } from "./language";

describe("detecting the staff member's language", () => {
  it("reads Chinese and English", () => {
    expect(detectLanguage(["有客人说刷卡一直失败"])).toBe("zh");
    expect(detectLanguage(["the card reader keeps declining"])).toBe("en");
  });

  it("takes the last message, because switching is deliberate", () => {
    expect(detectLanguage(["cards keep declining", "打印机也不出纸了"])).toBe("zh");
    expect(detectLanguage(["打印机坏了", "actually the printer is fine now"])).toBe("en");
  });

  it("treats a mixed sentence as Chinese", () => {
    // Staff write "OL846 打不出来" constantly. The Latin part is an order
    // number, not a language choice.
    expect(detectLanguage(["OL846 打不出来"])).toBe("zh");
  });

  it("returns null when there is nothing to go on, rather than guessing", () => {
    // A default here would flip the recogniser's language mid-conversation on
    // a message like "OL846", and the next thing spoken would transcribe to
    // nothing.
    expect(detectLanguage(["OL846"])).toBeNull();
    expect(detectLanguage([""])).toBeNull();
    expect(detectLanguage([])).toBeNull();
    expect(detectLanguage(["123", "!!"])).toBeNull();
  });

  it("skips back past an uninformative last message", () => {
    expect(detectLanguage(["刷卡失败", "OL846"])).toBe("zh");
  });
});

describe("the directive handed to the model", () => {
  it("names the language plainly in each direction", () => {
    expect(languageDirective("zh")).toMatch(/Chinese/);
    expect(languageDirective("en")).toMatch(/English/);
  });

  it("says nothing when nothing was detected", () => {
    // An empty directive leaves the prompt's own "reply in their language"
    // instruction in charge, which is the right fallback.
    expect(languageDirective(null)).toBe("");
  });
});

describe("speech locales", () => {
  it("covers both languages with tags the browser accepts", () => {
    expect(SPEECH_LOCALE.zh).toBe("zh-CN");
    expect(SPEECH_LOCALE.en).toBe("en-AU");
  });
});
