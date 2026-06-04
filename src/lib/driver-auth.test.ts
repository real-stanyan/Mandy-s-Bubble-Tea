import { describe, it, expect, beforeEach } from "vitest"
import { isAuthedDriver } from "./driver-auth"

function req(bearer?: string): Request {
  return new Request("http://localhost/api/driver/orders", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}

describe("isAuthedDriver roles", () => {
  beforeEach(() => {
    process.env.STAFF_DELIVERY_TOKEN = "driver-secret"
    process.env.ADMIN_DELIVERY_TOKEN = "admin-secret"
  })

  it("resolves the staff token to the driver role", () => {
    expect(isAuthedDriver(req("driver-secret"))).toEqual({
      ok: true,
      reason: "ok",
      role: "driver",
    })
  })

  it("resolves the admin token to the admin role", () => {
    expect(isAuthedDriver(req("admin-secret"))).toEqual({
      ok: true,
      reason: "ok",
      role: "admin",
    })
  })

  it("rejects a wrong token", () => {
    const res = isAuthedDriver(req("nope"))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe("unauthorized")
  })

  it("rejects a same-length wrong token", () => {
    const res = isAuthedDriver(req("driver-secreT"))
    expect(res.ok).toBe(false)
  })

  it("rejects the admin code when ADMIN_DELIVERY_TOKEN is unset", () => {
    delete process.env.ADMIN_DELIVERY_TOKEN
    const res = isAuthedDriver(req("admin-secret"))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe("unauthorized")
  })

  it("reports unconfigured when STAFF_DELIVERY_TOKEN is unset", () => {
    delete process.env.STAFF_DELIVERY_TOKEN
    const res = isAuthedDriver(req("driver-secret"))
    expect(res.ok).toBe(false)
    expect(res.reason).toBe("unconfigured")
  })

  it("rejects a missing Authorization header", () => {
    expect(isAuthedDriver(req()).ok).toBe(false)
  })
})
