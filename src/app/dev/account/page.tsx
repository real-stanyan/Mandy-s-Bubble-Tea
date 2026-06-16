"use client";

import { notFound } from "next/navigation";
import { AccountView } from "@/components/account/AccountView";

/**
 * Dev-only preview of the signed-in Account view with mock data (404s in
 * production). Lets the mobile/desktop layouts be reviewed without a real
 * auth session. Context-reading leaf cards (Wallet / Welcome / IG / Activity)
 * render in their logged-out/empty state here — the layout is what we verify.
 */
export default function AccountPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <AccountView
      displayName="Mandy Zhang"
      phone="0404 978 238"
      phoneE164="+61404978238"
      squareCustomerId="DEVPREVIEWCUSTOMER"
      tier="gold"
      balance={6}
      currentStars={6}
      goal={9}
      lifetime={42}
      rewardsAvailable={1}
      freeToppingsRemaining={null}
      activeOrders={[]}
      pastOrders={[]}
      ordersError={null}
      onViewOrders={() => {}}
      onViewPromotions={() => {}}
      onSignOut={() => {}}
    />
  );
}
