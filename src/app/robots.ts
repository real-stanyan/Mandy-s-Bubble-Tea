import type { MetadataRoute } from "next";
import { BUSINESS } from "@/lib/constants";

/**
 * /robots.txt was a 404. Crawlers cope with that, but it also meant nothing
 * pointed them at a sitemap and nothing kept them out of the private half of
 * the site.
 *
 * The disallow list is not a security control — those routes are gated
 * server-side. It exists so search results never send a stranger to a page
 * that can only show them a sign-in wall, and so crawl budget goes to the
 * menu instead of to /checkout.
 */
export default function robots(): MetadataRoute.Robots {
  const base = `https://${BUSINESS.domain}`;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/checkout", "/order-confirmation", "/staff", "/admin", "/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
