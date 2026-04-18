import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { SiteHeaderGate } from "@/components/layout/SiteHeaderGate";
import { SiteFooterGate } from "@/components/layout/SiteFooterGate";
import { AuthProvider } from "@/components/auth/AuthProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#C43A10",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <SiteHeaderGate />
          {children}
          <SiteFooterGate />
          <CartDrawer />
        </AuthProvider>
      </body>
    </html>
  );
}
