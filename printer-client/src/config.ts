// printer-client/src/config.ts
import "dotenv/config";

function require(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  supabaseUrl: require("SUPABASE_URL"),
  supabaseServiceRoleKey: require("SUPABASE_SERVICE_ROLE_KEY"),
  printerName: process.env.PRINTER_NAME ?? "Zebra_ZD411",
  deviceId: process.env.DEVICE_ID ?? "mac-mini-unknown",
  adminAlertEndpoint: process.env.ADMIN_ALERT_ENDPOINT,
  printerAlertToken: process.env.PRINTER_ALERT_TOKEN,
  localUiPort: Number(process.env.LOCAL_UI_PORT ?? "3001"),
};
