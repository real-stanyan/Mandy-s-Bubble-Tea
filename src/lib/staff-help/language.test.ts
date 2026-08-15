import { describe, it, expect } from "vitest";
import { detectLanguage, languageDirective, SPEECH_LOCALE, LANGUAGE_LABEL } from "./language";

describe("detecting the staff member's language", () => {
  it("reads Chinese, English and Korean", () => {
    expect(detectLanguage(["有客人说刷卡一直失败"])).toBe("zh");
    expect(detectLanguage(["the card reader keeps declining"])).toBe("en");
    expect(detectLanguage(["카드가 계속 안 돼요"])).toBe("ko");
  });

  it("calls Korean with hanja Korean, not Chinese", () => {
    // Hangul is checked first for exactly this: the Han characters are the
    // loanwords, the Hangul is the sentence.
    expect(detectLanguage(["注文 번호 확인해 주세요"])).toBe("ko");
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
  it("covers every language with tags the browser accepts", () => {
    expect(SPEECH_LOCALE.zh).toBe("zh-CN");
    expect(SPEECH_LOCALE.en).toBe("en-AU");
    expect(SPEECH_LOCALE.ko).toBe("ko-KR");
  });

  it("labels every language the recogniser can be set to", () => {
    // The mic toggle is built from LANGUAGE_LABEL and the voice picker from
    // SPEECH_LOCALE. If they drift, a language becomes either unreachable or
    // unspeakable, and neither shows up as a type error.
    expect(Object.keys(LANGUAGE_LABEL).sort()).toEqual(Object.keys(SPEECH_LOCALE).sort());
  });

  it("names each language in its own script", () => {
    expect(LANGUAGE_LABEL.zh).toBe("中文");
    expect(LANGUAGE_LABEL.ko).toBe("한국어");
  });
});
