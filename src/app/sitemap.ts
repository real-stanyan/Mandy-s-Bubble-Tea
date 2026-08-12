import type { MetadataRoute } from "next";
import { BUSINESS } from "@/lib/constants";

/**
 * Only the pages a stranger should land on from search. Account, orders and
 * checkout are deliberately absent: they are personal, they need a session,
 * and a search result that dead-ends at a sign-in wall is worse than no
 * result. /robots.ts blocks those same paths.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${BUSINESS.domain}`;
  const now = new Date();
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/menu`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/our-story`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    // Both are URLs the app stores point at, so they have to be reachable and
    // indexable rather than pages only a footer link finds.
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    {
      url: `${base}/delete-account`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
