import { applyThresholds, isOrderDay } from "@/lib/staff/stocklist";
import { readLastCount } from "@/lib/staff/stock-history-store";
import { readThresholds } from "@/lib/staff/threshold-store";
import { StockCheckForm } from "./stock-check-form";

export const dynamic = "force-dynamic";

export default async function StaffStockCheckPage() {
  // Read on the server so the previous count follows the shop, not the device
  // it was typed on: whoever opens the sheet sees the same "was N", whether
  // that is the till, a phone, or someone covering a shift.
  const [previous, overrides] = await Promise.all([readLastCount(), readThresholds()]);
  // Resolved on the server so the Tuesday banner follows shop time rather
  // than whatever timezone the staff member's phone is set to.
  return (
    <StockCheckForm
      categories={applyThresholds(overrides)}
      isOrderDay={isOrderDay()}
      previous={previous}
    />
  );
}
