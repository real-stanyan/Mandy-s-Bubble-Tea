import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { CartDrawerGate } from "@/components/cart/CartDrawerGate";
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
  openGraph: {
    type: "website",
    siteName: "Mandy's Bubble Tea",
    locale: "en_AU",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
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
