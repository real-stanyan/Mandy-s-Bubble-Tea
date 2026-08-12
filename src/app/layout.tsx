import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono, Shantell_Sans } from "next/font/google";
import { BUSINESS } from "@/lib/constants";
import { OPEN_MIN, CLOSE_MIN } from "@/lib/store-status";

/** Minutes-of-day to the "HH:MM" schema.org wants. */
function toIsoTime(minsOfDay: number): string {
  const h = Math.floor(minsOfDay / 60);
  const m = minsOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
import Script from "next/script";
import "./globals.css";
import { CartDrawerGate } from "@/components/cart/CartDrawerGate";
import { ChatGate } from "@/components/chat/ChatGate";
import { SiteHeaderGate } from "@/components/layout/SiteHeaderGate";
import { SiteFooterGate } from "@/components/layout/SiteFooterGate";
import { SiteTabBarGate } from "@/components/layout/SiteTabBarGate";
import { PublicHolidayBanner } from "@/components/layout/PublicHolidayBanner";
import { AuthProvider } from "@/components/auth/AuthProvider";

const GA_ID = "G-KXVRP14YZF";

// Variable Fraunces, with the SOFT/WONK optical axes along for the ride —
// the .serif-display headline treatment (globals.css) dials them in. The
// static 500/600 instances flattened those axes out entirely; the variable
// font still serves font-medium/semibold through its weight axis.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

// Shantell Sans — the marker-pen voice from the shop's own posters, promoted
// to the site's ONE typeface at Stan's call (2026-08-10, "全站换", concern
// about checkout digits raised and accepted). Variable weight covers every
// font-medium/semibold the old Inter served; the BNCE/INFM axes let
// .serif-display push headlines toward the hand-drawn end while body text
// stays on the calmer default. JetBrains Mono stays for the data voice
// (member ids, eyebrows) — handwriting a QR id helps nobody.
const shantell = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-shantell",
  display: "swap",
  axes: ["BNCE", "INFM"],
});

const inter = Inter({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["700"],
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Mandy's Bubble Tea",
    template: "%s | Mandy's Bubble Tea",
  },
  description:
    "Fresh bubble tea in Southport QLD — order online for pickup at 34 Davenport St, Southport.",
  // metadataBase resolves the relative og:image below to an absolute URL —
  // scrapers ignore relative ones, which is why the card stayed blank.
  metadataBase: new URL(`https://${BUSINESS.domain}`),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Mandy's Bubble Tea",
    locale: "en_AU",
    // Without this a shared link rendered as a grey box in WhatsApp,
    // Messenger and iMessage — the places a drink shop actually gets
    // passed around. Built by scripts/render-og-image.ts.
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "Mandy's Bubble Tea — fresh bubble tea in Southport",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 1, not 5: iOS Safari auto-zooms the page when focusing any input and
  // KEEPS that zoom until the customer pinches out — half the chat drawer
  // (send button included) sat off-screen after one tap on the input
  // (Stan's screenshots, 2026-08-10). maximumScale: 1 kills the auto-zoom;
  // iOS still allows deliberate pinch-zoom regardless of this value
  // (accessibility behavior since iOS 10), so zoom-to-read keeps working.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#8D5524",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "Mandy's Bubble Tea",
  description:
    "Fresh bubble tea in Southport QLD — milky teas, fruity teas, fresh brews, frozen drinks and more.",
  url: "https://mandybubbletea.com",
  telephone: "+61404978238",
  address: {
    "@type": "PostalAddress",
    streetAddress: "34 Davenport St",
    addressLocality: "Southport",
    addressRegion: "QLD",
    postalCode: "4215",
    addressCountry: "AU",
  },
  servesCuisine: "Bubble Tea",
  currenciesAccepted: "AUD",
  // "bubble tea near me open now" is how a local shop gets found, and this
  // was the one thing the Restaurant schema didn't say. Derived from the
  // same OPEN_MIN/CLOSE_MIN the site and the chat assistant read, so the
  // hours Google shows can't drift from the hours the door keeps.
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      opens: toIsoTime(OPEN_MIN),
      closes: toIsoTime(CLOSE_MIN),
    },
  ],
  image: `https://${BUSINESS.domain}/og.jpg`,
  priceRange: "$$",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} ${shantell.variable} h-full antialiased`}
      // The Evening Mode head script stamps data-theme before hydration, so
      // the server HTML and client DOM legitimately differ on this one
      // attribute — the standard theming-script suppression.
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Evening Mode init — parser-blocking on purpose so the theme lands
            before first paint (no cream flash at night). Auto: 18:00–06:00
            device time. Override: ?theme=evening | ?theme=day (persisted) |
            ?theme=auto (back to the clock). Tokens live in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var q=new URLSearchParams(location.search).get('theme');" +
              "if(q==='evening'||q==='day'||q==='auto'){localStorage.setItem('mbt-theme',q);}" +
              "var s=localStorage.getItem('mbt-theme');var h=new Date().getHours();" +
              "var auto=h>=18||h<6;var ev=s==='evening'||((!s||s==='auto')&&auto);" +
              "if(ev){document.documentElement.dataset.theme='evening';}}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <AuthProvider>
          <PublicHolidayBanner />
          <SiteHeaderGate />
          {children}
          {modal}
          <SiteFooterGate />
          <SiteTabBarGate />
          <CartDrawerGate />
          <ChatGate />
        </AuthProvider>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
