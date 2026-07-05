import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { APP_CONFIG } from "@/lib/app-config-values";

describe("GET /api/app-config", () => {
  it("returns ok + per-platform config + killSwitch", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      ios: {
        minBuild: APP_CONFIG.ios.minBuild,
        latestBuild: APP_CONFIG.ios.latestBuild,
        storeUrl: APP_CONFIG.ios.storeUrl,
      },
      android: null,
      killSwitch: false,
    });
    // Shape the app's gate depends on.
    expect(typeof json.ios.minBuild).toBe("number");
    expect(json.ios.storeUrl).toMatch(/^https:\/\/apps\.apple\.com\//);
  });

  it("is CDN-cacheable (s-maxage=300 + SWR), not force-dynamic", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=86400",
    );
  });
});
