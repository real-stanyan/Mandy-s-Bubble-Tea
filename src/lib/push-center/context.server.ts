import "server-only";
import { countPendingCups } from "@/lib/kitchen-load-server";
import { kitchenLoadFor, type KitchenLoad } from "@/lib/kitchen-load";

// Push Center — the two outside facts a send can depend on: today's weather
// and how busy the bench is. Both are context for the person deciding, not
// gates; the page shows them next to the button.

export type Forecast = {
  date: string;
  maxC: number | null;
  rainMm: number | null;
  rainChancePct: number | null;
};

export type Kitchen = KitchenLoad & { measuredAt: string };

// Southport, same grid point the sales analysis used (Open-Meteo, free, no key).
const FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=-27.97&longitude=153.41" +
  "&daily=temperature_2m_max,precipitation_sum,precipitation_probability_max" +
  "&timezone=Australia%2FBrisbane&forecast_days=1";
const FORECAST_TTL_MS = 10 * 60 * 1000;

let forecastCache: { value: Forecast; at: number } | null = null;

export async function getForecast(): Promise<Forecast | null> {
  if (forecastCache && Date.now() - forecastCache.at < FORECAST_TTL_MS) return forecastCache.value;
  try {
    const res = await fetch(FORECAST_URL, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: Array<number | null>;
        precipitation_sum?: Array<number | null>;
        precipitation_probability_max?: Array<number | null>;
      };
    };
    const d = j.daily;
    if (!d?.time?.[0]) return null;
    const value: Forecast = {
      date: d.time[0],
      maxC: d.temperature_2m_max?.[0] ?? null,
      rainMm: d.precipitation_sum?.[0] ?? null,
      rainChancePct: d.precipitation_probability_max?.[0] ?? null,
    };
    forecastCache = { value, at: Date.now() };
    return value;
  } catch (err) {
    console.error("[push-center] forecast failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function getKitchen(): Promise<Kitchen | null> {
  const cups = await countPendingCups();
  if (cups === null) return null;
  return { ...kitchenLoadFor(cups), measuredAt: new Date().toISOString() };
}
