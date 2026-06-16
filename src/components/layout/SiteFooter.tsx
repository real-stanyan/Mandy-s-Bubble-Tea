import Link from "next/link";
import Image from "next/image";
import { MapPin, Phone } from "lucide-react";
import { BRAND, BUSINESS } from "@/lib/constants";

// Dark footer, recreated from the design (web-components.jsx Footer):
// brand column (inverted logo, tagline, address/phone) + Menu / Company /
// Support link columns + bottom bar. Server component.

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] =
  [
    {
      heading: "Menu",
      links: [
        { label: "Milky teas", href: "/menu" },
        { label: "Fruity teas", href: "/menu" },
        { label: "Fresh brews", href: "/menu" },
        { label: "Frozen", href: "/menu" },
        { label: "Cheese cream", href: "/menu" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "Our story", href: "/our-story" },
        { label: "Rewards", href: "/account" },
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/privacy#terms" },
      ],
    },
  ];

export function SiteFooter() {
  return (
    <footer
      className="relative mt-2 overflow-hidden text-white"
      style={{ background: "#241710" }}
    >
      <div className="mx-auto max-w-6xl px-5 pb-8 pt-14 sm:px-8 sm:pt-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Image
              src="/logo.webp"
              width={160}
              height={64}
              alt="Mandy's"
              className="h-[50px] w-auto opacity-95 brightness-0 invert"
            />
            <p className="mt-4 max-w-[300px] text-[14px] leading-relaxed text-white/60">
              Silky milk teas and chewy pearls, shaken to order — a
              neighbourhood bubble tea spot on the Gold Coast.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[13.5px] text-white/70">
              <MapPin size={15} className="text-peach" /> {BUSINESS.address}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[13.5px] text-white/70">
              <Phone size={15} className="text-peach" />
              <a href={`tel:${BUSINESS.phone}`} className="hover:text-white">
                {BUSINESS.phone}
              </a>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <a
                href="https://www.facebook.com/mandysbubbletea"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="text-white/60 transition hover:text-white"
              >
                <FacebookIcon className="h-5 w-5" />
              </a>
              <a
                href="https://www.instagram.com/mandysbubbletea/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="text-white/60 transition hover:text-white"
              >
                <InstagramIcon className="h-5 w-5" />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <div className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-peach">
                {col.heading}
              </div>
              <nav className="flex flex-col gap-3">
                {col.links.map((l, i) => (
                  <Link
                    key={`${l.label}-${i}`}
                    href={l.href}
                    className="w-fit text-[14px] text-white/70 transition hover:text-white"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}

          {/* Support */}
          <div>
            <div className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-peach">
              Support
            </div>
            <nav className="flex flex-col gap-3 text-[14px] text-white/70">
              <a
                href="mailto:hello@mandybubbletea.com"
                className="w-fit transition hover:text-white"
              >
                Contact us
              </a>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(BUSINESS.address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit transition hover:text-white"
              >
                Store location
              </a>
              <span className="text-white/45">Open daily · 10:30am–10:30pm</span>
            </nav>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/12 pt-6">
          <span className="text-[12.5px] text-white/50">
            © 2026 {BRAND.name}. All rights reserved.
          </span>
          <div className="flex gap-6 text-[12.5px] text-white/50">
            <Link href="/privacy" className="hover:text-white/80">
              Privacy
            </Link>
            <Link href="/privacy#terms" className="hover:text-white/80">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
