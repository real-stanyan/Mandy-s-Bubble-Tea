-- Pickup Live Activity goes three-state: Received → Preparing → Ready
-- (contract revision 2026-07-06 after on-device acceptance). The webhook
-- now pushes status="preparing" when a pickup fulfillment transitions to
-- RESERVED, deduped via claimOrderPushSlot(orderId, 'la_preparing').
--
-- Widen the order_push_notifications kind check with 'la_preparing'
-- (same drop + recreate pattern as 2026-07-06-live-activity-push.sql).
alter table order_push_notifications
  drop constraint if exists order_push_notifications_kind_check;
alter table order_push_notifications
  add constraint order_push_notifications_kind_check
  check (kind in (
    'ready',
    'new_delivery',
    'la_preparing',
    'la_ready',
    'la_completed',
    'la_canceled',
    'la_accepted',
    'la_picked_up',
    'la_delivered'
  ));
