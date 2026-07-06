import { describe, it, expect, vi, beforeEach } from "vitest"

const mockOrdersGet = vi.fn()
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: (...a: unknown[]) => mockOrdersGet(...a) } },
}))

const mockGetToken = vi.fn()
const mockSendStatusPush = vi.fn()
vi.mock("@/lib/live-activity", () => ({
  getLiveActivityToken: (...a: unknown[]) => mockGetToken(...a),
  sendLiveActivityStatusPush: (...a: unknown[]) => mockSendStatusPush(...a),
}))

import {
  pickFulfillmentTransition,
  handleLiveActivityFulfillment,
  type FulfillmentUpdatedEvent,
} from "./live-activity-webhook"

const pickupOrder = {
  order: {
    id: "O1",
    metadata: {},
    fulfillments: [{ uid: "F1", type: "PICKUP" }],
  },
}

const deliveryOrder = {
  order: {
    id: "O1",
    metadata: { fulfillment_type: "DELIVERY" },
    fulfillments: [{ uid: "F1", type: "DELIVERY" }],
  },
}

function fulfillmentEvent(newStates: string[], orderId = "O1") {
  return {
    data: {
      object: {
        order_fulfillment_updated: {
          order_id: orderId,
          fulfillment_update: newStates.map((s) => ({
            old_state: "PROPOSED",
            new_state: s,
          })),
        },
      },
    },
  }
}

describe("pickFulfillmentTransition", () => {
  it("extracts order id + every new_state", () => {
    expect(pickFulfillmentTransition(fulfillmentEvent(["PREPARED", "COMPLETED"])))
      .toEqual({ orderId: "O1", newStates: ["PREPARED", "COMPLETED"] })
  })

  it("returns null for events without a fulfillment payload", () => {
    expect(pickFulfillmentTransition({})).toBeNull()
    expect(pickFulfillmentTransition({ data: { object: {} } })).toBeNull()
  })

  it("returns null when the payload has no transitions", () => {
    expect(pickFulfillmentTransition(fulfillmentEvent([]))).toBeNull()
  })

  it("drops updates with a missing new_state", () => {
    const event: FulfillmentUpdatedEvent = {
      data: {
        object: {
          order_fulfillment_updated: {
            order_id: "O1",
            fulfillment_update: [{}],
          },
        },
      },
    }
    expect(pickFulfillmentTransition(event)).toBeNull()
  })
})

describe("handleLiveActivityFulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetToken.mockResolvedValue("beef".repeat(40))
    mockSendStatusPush.mockResolvedValue(undefined)
  })

  it("skips entirely (no Square fetch) when the order has no LA token", async () => {
    mockGetToken.mockResolvedValue(null)
    await handleLiveActivityFulfillment("O1", ["PREPARED"])
    expect(mockOrdersGet).not.toHaveBeenCalled()
    expect(mockSendStatusPush).not.toHaveBeenCalled()
  })

  it("pickup PREPARED → la_ready 'ready' (update)", async () => {
    mockOrdersGet.mockResolvedValue(pickupOrder)
    await handleLiveActivityFulfillment("O1", ["PREPARED"])
    expect(mockSendStatusPush).toHaveBeenCalledTimes(1)
    expect(mockSendStatusPush).toHaveBeenCalledWith({
      orderId: "O1",
      kind: "la_ready",
      status: "ready",
      event: "update",
    })
  })

  it("delivery PREPARED sends NOTHING — the driver status route owns la_picked_up", async () => {
    mockOrdersGet.mockResolvedValue(deliveryOrder)
    await handleLiveActivityFulfillment("O1", ["PREPARED"])
    expect(mockSendStatusPush).not.toHaveBeenCalled()
  })

  it("COMPLETED on a pickup order → la_completed 'completed' (end)", async () => {
    mockOrdersGet.mockResolvedValue(pickupOrder)
    await handleLiveActivityFulfillment("O1", ["COMPLETED"])
    expect(mockSendStatusPush).toHaveBeenCalledWith({
      orderId: "O1",
      kind: "la_completed",
      status: "completed",
      event: "end",
    })
  })

  it("COMPLETED on a delivery order → la_delivered 'delivered' (end, shared slot with the driver route)", async () => {
    mockOrdersGet.mockResolvedValue(deliveryOrder)
    await handleLiveActivityFulfillment("O1", ["COMPLETED"])
    expect(mockSendStatusPush).toHaveBeenCalledWith({
      orderId: "O1",
      kind: "la_delivered",
      status: "delivered",
      event: "end",
    })
  })

  it("detects delivery from metadata.fulfillment_type even when the fulfillment type is PICKUP", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "O1",
        metadata: { fulfillment_type: "DELIVERY" },
        fulfillments: [{ uid: "F1", type: "PICKUP" }],
      },
    })
    await handleLiveActivityFulfillment("O1", ["COMPLETED"])
    expect(mockSendStatusPush).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "la_delivered" }),
    )
  })

  it.each(["CANCELED", "FAILED"])(
    "%s → la_canceled 'canceled' (end) for pickup orders",
    async (state) => {
      mockOrdersGet.mockResolvedValue(pickupOrder)
      await handleLiveActivityFulfillment("O1", [state])
      expect(mockSendStatusPush).toHaveBeenCalledWith({
        orderId: "O1",
        kind: "la_canceled",
        status: "canceled",
        event: "end",
      })
    },
  )

  it("CANCELED → la_canceled for delivery orders too (covers driver 'rejected')", async () => {
    mockOrdersGet.mockResolvedValue(deliveryOrder)
    await handleLiveActivityFulfillment("O1", ["CANCELED"])
    expect(mockSendStatusPush).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "la_canceled", event: "end" }),
    )
  })

  it("cancel wins when an event carries both PREPARED and CANCELED", async () => {
    mockOrdersGet.mockResolvedValue(pickupOrder)
    await handleLiveActivityFulfillment("O1", ["PREPARED", "CANCELED"])
    expect(mockSendStatusPush).toHaveBeenCalledTimes(1)
    expect(mockSendStatusPush).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "la_canceled" }),
    )
  })

  it("ignores transitions outside the LA vocabulary (e.g. RESERVED)", async () => {
    await handleLiveActivityFulfillment("O1", ["RESERVED"])
    expect(mockGetToken).not.toHaveBeenCalled()
    expect(mockSendStatusPush).not.toHaveBeenCalled()
  })

  it("swallows Square errors — never throws into the webhook", async () => {
    mockOrdersGet.mockRejectedValue(new Error("square down"))
    await expect(
      handleLiveActivityFulfillment("O1", ["PREPARED"]),
    ).resolves.toBeUndefined()
    expect(mockSendStatusPush).not.toHaveBeenCalled()
  })
})
