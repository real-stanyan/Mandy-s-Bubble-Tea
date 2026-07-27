"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  hasAppDownloadGrant,
  useAppDownloadStatus,
} from "@/hooks/use-app-download-status";

// Single source of truth for "will the app-download campaign popup show?".
//
// Three components need the same answer: the popup itself, and the two other
// home-page popups that must yield to it so a visitor never gets two at once
// (LoyaltyPopup for signed-out visitors, OrderModePopup for signed-in ones).
// Duplicating the predicate is how they drift apart, so it lives here.

// Namespaced with the house `mbt:` prefix (cf. WelcomeDiscountBanner). Set on
// dismiss OR successful claim so the popup never nags a visitor twice.
export const APP_DOWNLOAD_DISMISS_KEY = "mbt:app-download:dismissed";

export type AppDownloadPopupEligibility =
  /** Still deciding — auth or the grant check hasn't landed. Yield, don't show. */
  | "pending"
  /** The campaign popup should show. */
  | "eligible"
  /** Dismissed on this device, or this phone already holds/spent a grant. */
  | "ineligible";

export function useAppDownloadPopupEligibility(): AppDownloadPopupEligibility {
  const { profile, loading } = useAuth();
  const status = useAppDownloadStatus(!!profile);
  // localStorage is unreadable during SSR and the first paint, so this starts
  // null and resolves in an effect. It is read once per mount — dismissing the
  // popup does not un-yield the others until the next load, which is the
  // behaviour LoyaltyPopup already had.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(APP_DOWNLOAD_DISMISS_KEY) === "1");
    } catch {
      // Private mode / storage blocked — treat as not dismissed. Worst case the
      // visitor sees the popup again next load.
      setDismissed(false);
    }
  }, []);

  if (loading || dismissed === null) return "pending";
  if (dismissed) return "ineligible";
  // The grant check only exists for signed-in visitors; signed-out ones can't
  // be resolved to a phone, so they stay eligible.
  if (profile) {
    if (status.loading) return "pending";
    if (hasAppDownloadGrant(status)) return "ineligible";
  }
  return "eligible";
}
