import "server-only";
import { getAuthedUser } from "@/lib/auth";
import { getActiveProgram, findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus } from "@/lib/flash-promo";
import { getAppDownloadDiscountStatus } from "@/lib/app-download-discount";
import type { CustomerPromoState } from "@/lib/chat/promotions";

/**
 * Who is asking, and what they're entitled to — read from the same helpers
 * /api/me uses, so Mandy quotes the same numbers the customer sees on their
 * own account page.
 *
 * Returns null for a stranger, and null on any failure: a chat must still
 * answer when the loyalty lookup is down, just in general terms instead of
 * personal ones. Never throws.
 */
export async function readCustomerPromoState(
  request: Request,
): Promise<CustomerPromoState | null> {
  try {
    const user = await getAuthedUser(request);
    if (!user) return null;

    const [program, welcome, ig, flash, appDownload] = await Promise.all([
      getActiveProgram().catch(() => ({ starsPerReward: 9 })),
      getWelcomeDiscountStatus(user.userId).catch(() => null),
      getIgFollowDiscountStatus(user.userId).catch(() => null),
      getFlashPromoStatus(user.userId).catch(() => null),
      getAppDownloadDiscountStatus(user.userId).catch(() => null),
    ]);

    const account = user.phone
      ? await findLoyaltyAccountByPhone(user.phone).catch(() => null)
      : null;

    return {
      starBalance: account?.balance ?? 0,
      starsPerReward: program.starsPerReward || 9,
      lifetimePoints: account?.lifetimePoints ?? 0,
      welcomeAvailable: welcome?.available === true,
      igFollowAvailable: ig?.available === true,
      igFollowPercentage: ig?.percentage ?? 0,
      flashAvailable: flash?.available === true,
      flashPercentage: flash?.percentage ?? 0,
      appDownloadAvailable: appDownload?.available === true,
      appDownloadPercentage: appDownload?.percentage ?? 0,
    };
  } catch {
    return null;
  }
}
