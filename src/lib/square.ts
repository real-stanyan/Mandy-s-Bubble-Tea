import "server-only";
import { SquareClient, SquareEnvironment } from "square";

// Server-only Square SDK client. Never import this from a Client Component.
// Reads credentials from environment variables; throws on startup if missing
// so we fail fast instead of surfacing a cryptic 401 later.

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  throw new Error(
    "SQUARE_ACCESS_TOKEN is not set. Copy .env.example to .env.local and fill in sandbox credentials.",
  );
}

const envName = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "sandbox";
const environment =
  envName === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

export const squareClient = new SquareClient({
  token,
  environment,
});

export const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID ?? "";
