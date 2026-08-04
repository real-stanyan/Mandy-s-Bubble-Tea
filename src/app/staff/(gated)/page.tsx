import { STOCK_LIST, isOrderDay } from "@/lib/staff/stocklist";
import { StockCheckForm } from "./stock-check-form";

export const dynamic = "force-dynamic";

export default function StaffStockCheckPage() {
  // Resolved on the server so the Tuesday banner follows shop time rather
  // than whatever timezone the staff member's phone is set to.
  return <StockCheckForm categories={STOCK_LIST} isOrderDay={isOrderDay()} />;
}
