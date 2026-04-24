// printer-client/src/supabase.ts
import WS from "ws";
import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

// realtime-js >=2.103 expects globalThis.WebSocket and no longer falls
// back to `ws`. Node <22 has no global WebSocket, so the realtime client
// silently never opens a connection (phx_join appears to time out).
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket: unknown }).WebSocket = WS;
}

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);
