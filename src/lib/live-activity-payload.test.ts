import { describe, it, expect } from "vitest"
import {
  buildLiveActivityPayload,
  liveActivityHeaders,
  shouldSendGpsPush,
  gpsThrottleCutoffIso,
  isValidActivityToken,
  statusPushWithStaleDate,
  LIVE_ACTIVITY_TOPIC,
  GPS_STALE_SECONDS,
  END_DISMISSAL_SECONDS,
  GPS_PUSH_MIN_INTERVAL_MS,
} from "./live-activity-payload"

const NOW = 1_780_000_000 // unix seconds

describe("buildLiveActivityPayload", () => {
  it("update: timestamp + event + content-state, no stale/dismissal dates", () => {
    const payload = buildLiveActivityPayload({
      event: "update",
      contentState: { status: "ready", updatedAt: NOW },
      nowSeconds: NOW,
    })
    expect(payload).toEqual({
      aps: {
        timestamp: NOW,
        event: "update",
        "content-state": { status: "ready", updatedAt: NOW },
      },
    })
  })

  it("GPS heartbeat: withStaleDate adds stale-date = now + 90", () => {
    const payload = buildLiveActivityPayload({
      event: "update",
      contentState: {
        status: "picked_up",
        driverName: "Kai",
        driverLat: -27.967,
        driverLng: 153.414,
        updatedAt: NOW,
      },
      nowSeconds: NOW,
      withStaleDate: true,
    })
    expect(payload.aps["stale-date"]).toBe(NOW + GPS_STALE_SECONDS)
    expect(payload.aps["dismissal-date"]).toBeUndefined()
    expect(payload.aps["content-state"]).toEqual({
      status: "picked_up",
      driverName: "Kai",
      driverLat: -27.967,
      driverLng: 153.414,
      updatedAt: NOW,
    })
  })

  it("end: adds dismissal-date = now (immediate dismissal)", () => {
    const payload = buildLiveActivityPayload({
      event: "end",
      contentState: { status: "delivered", updatedAt: NOW },
      nowSeconds: NOW,
    })
    expect(payload.aps.event).toBe("end")
    expect(payload.aps["dismissal-date"]).toBe(NOW + END_DISMISSAL_SECONDS)
    expect(END_DISMISSAL_SECONDS).toBe(0)
    expect(payload.aps["stale-date"]).toBeUndefined()
  })
})

describe("liveActivityHeaders", () => {
  it("status transition: priority 10 on the app bundle liveactivity topic", () => {
    expect(liveActivityHeaders(10)).toEqual({
      "apns-topic": "com.mandysbubbletea.app.push-type.liveactivity",
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    })
  })

  it("GPS heartbeat: priority 5", () => {
    expect(liveActivityHeaders(5)["apns-priority"]).toBe("5")
  })

  it("topic is the app bundle, never the wallet passTypeId", () => {
    expect(LIVE_ACTIVITY_TOPIC).not.toMatch(/^pass\./)
  })
})

describe("shouldSendGpsPush — 25s throttle", () => {
  const now = new Date("2026-07-06T03:00:00.000Z")

  it("sends when never sent before", () => {
    expect(shouldSendGpsPush(null, now)).toBe(true)
  })

  it("skips when the last forward is younger than 25s", () => {
    const tenSecondsAgo = new Date(now.getTime() - 10_000).toISOString()
    expect(shouldSendGpsPush(tenSecondsAgo, now)).toBe(false)
  })

  it("sends again at exactly 25s", () => {
    const exactly = new Date(now.getTime() - GPS_PUSH_MIN_INTERVAL_MS).toISOString()
    expect(shouldSendGpsPush(exactly, now)).toBe(true)
  })

  it("sends when the last forward is older than 25s", () => {
    const thirtySecondsAgo = new Date(now.getTime() - 30_000).toISOString()
    expect(shouldSendGpsPush(thirtySecondsAgo, now)).toBe(true)
  })

  it("treats an unparsable timestamp as never-sent", () => {
    expect(shouldSendGpsPush("not-a-date", now)).toBe(true)
  })

  it("gpsThrottleCutoffIso is exactly now - 25s (the WHERE-guard bound)", () => {
    expect(gpsThrottleCutoffIso(now)).toBe("2026-07-06T02:59:35.000Z")
  })
})

describe("statusPushWithStaleDate — contract revision 2026-07-06", () => {
  it("picked_up carries stale-date (degrades to PAUSED if GPS never starts)", () => {
    expect(statusPushWithStaleDate("la_picked_up")).toBe(true)
  })

  it("no other status transition carries stale-date", () => {
    for (const kind of [
      "la_preparing",
      "la_ready",
      "la_completed",
      "la_canceled",
      "la_accepted",
      "la_delivered",
    ]) {
      expect(statusPushWithStaleDate(kind)).toBe(false)
    }
  })

  it("composes: picked_up status payload gets stale-date = now + 90", () => {
    const payload = buildLiveActivityPayload({
      event: "update",
      contentState: { status: "picked_up", driverName: "Kai", updatedAt: NOW },
      nowSeconds: NOW,
      withStaleDate: statusPushWithStaleDate("la_picked_up"),
    })
    expect(payload.aps["stale-date"]).toBe(NOW + GPS_STALE_SECONDS)
  })
})

describe("isValidActivityToken", () => {
  it("accepts a typical 160-char hex ActivityKit token", () => {
    expect(isValidActivityToken("ab01".repeat(40))).toBe(true)
  })

  it("accepts uppercase hex", () => {
    expect(isValidActivityToken("AB01CD23EF456789")).toBe(true)
  })

  it("rejects non-hex, too-short, oversized and non-string values", () => {
    expect(isValidActivityToken("not-hex-at-all!!")).toBe(false)
    expect(isValidActivityToken("abcd")).toBe(false)
    expect(isValidActivityToken("a".repeat(513))).toBe(false)
    expect(isValidActivityToken(42)).toBe(false)
    expect(isValidActivityToken(null)).toBe(false)
    expect(isValidActivityToken(undefined)).toBe(false)
  })
})
