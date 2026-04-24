import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { SiteHeaderGate } from "@/components/layout/SiteHeaderGate";
import { SiteFooterGate } from "@/components/layout/SiteFooterGate";
import { AuthProvider } from "@/components/auth/AuthProvider";

const GA_ID = "G-KXVRP14YZF";

const fraunces = Fraunces({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
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
}: Readonly<{
  children: React.ReactNode;
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
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <AuthProvider>
          <SiteHeaderGate />
          {children}
          <SiteFooterGate />
          <CartDrawer />
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
