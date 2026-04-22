-- Heartbeat stale-alerting.
--   stale_alert_sent_at: set when the cron notices the device is
--     stale and fires a push. Cleared on every successful heartbeat
--     so the next outage will re-alert.

alter table printer_heartbeats
  add column if not exists stale_alert_sent_at timestamptz;
