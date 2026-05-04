export interface RefundDeps {
  getOrderTotalCents(squareOrderId: string): Promise<number | null>;
  getCumulativeRefundCents(squareOrderId: string): Promise<number>;
  voidPrizeRoll(squareOrderId: string): Promise<{ updated: number }>;
}

export interface RefundResult {
  voided: boolean;
}

export async function handleRefundedOrder(
  squareOrderId: string,
  deps: RefundDeps,
): Promise<RefundResult> {
  const total = await deps.getOrderTotalCents(squareOrderId);
  if (total == null || total <= 0) return { voided: false };
  const refunded = await deps.getCumulativeRefundCents(squareOrderId);
  if (refunded < total) return { voided: false };
  const result = await deps.voidPrizeRoll(squareOrderId);
  return { voided: result.updated > 0 };
}
