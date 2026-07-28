"use client";

// Whether the app-download campaign popup shows, and — by the same token —
// whether the other two home-page popups must stand aside for it.
//
// It always shows. Every visitor, every load, signed in or out, dismissed
// before or not. That is a deliberate campaign decision, not an oversight:
// the offer is the point of the campaign, and a visitor who closed it once
// should still be able to claim on a later visit. Entering a number that
// already holds a grant is handled honestly at submit time — the claim route
// reports `alreadyClaimed` / `redeemed` and the popup says so — rather than by
// hiding the popup and leaving the visitor with no explanation.
//
// The cost, stated plainly: LoyaltyPopup and OrderModePopup never show while
// this is true, because two stacked modals on the home page is worse than
// either one alone. Ending the campaign (or making this conditional again) is
// what brings them back.

export type AppDownloadPopupEligibility = "pending" | "eligible" | "ineligible";

export function useAppDownloadPopupEligibility(): AppDownloadPopupEligibility {
  return "eligible";
}
