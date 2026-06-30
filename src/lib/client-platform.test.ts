import { describe, it, expect } from "vitest";
import { clientPlatformFrom } from "./client-platform";

describe("clientPlatformFrom", () => {
  it("honors an explicit X-Client-Platform header over the UA", () => {
    // Even a browser UA is overridden when the app declares itself.
    expect(clientPlatformFrom("app", "Mozilla/5.0 (iPhone)")).toBe("app");
    expect(clientPlatformFrom("web", "okhttp/4.12.0")).toBe("web");
    expect(clientPlatformFrom("APP", "")).toBe("app");
  });

  it("classifies real browsers as web", () => {
    const browsers = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    ];
    for (const ua of browsers) expect(clientPlatformFrom(null, ua)).toBe("web");
  });

  it("classifies the native app as app", () => {
    const appUas = [
      "Mandy's/1.1.3 CFNetwork/1410.0.3 Darwin/22.4.0", // iOS RN fetch
      "okhttp/4.12.0", // Android RN networking
      "Mandysbubbleteaapp/12 CFNetwork/1496.0.7 Darwin/23.5.0",
      "Expo/2.30.0 CFNetwork/1410.0.3 Darwin/22.4.0", // Expo Go dev client
    ];
    for (const ua of appUas) expect(clientPlatformFrom(null, ua)).toBe("app");
  });

  it("defaults to web when nothing is identifiable", () => {
    expect(clientPlatformFrom(null, null)).toBe("web");
    expect(clientPlatformFrom("", "")).toBe("web");
    expect(clientPlatformFrom(undefined, "curl/8.4.0")).toBe("web");
    expect(clientPlatformFrom("garbage", "PostmanRuntime/7.36")).toBe("web");
  });
});
