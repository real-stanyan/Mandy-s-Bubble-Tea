import { Clock, MapPin, Phone } from "lucide-react";
import { BUSINESS } from "@/lib/constants";

export function StoreInfo() {
  return (
    <section className="px-4 mt-5">
      <h2
        className="font-serif text-ink"
        style={{ fontSize: 17, letterSpacing: -0.3, fontWeight: 500 }}
      >
        Store
      </h2>
      <div className="mt-2 flex flex-col gap-2 rounded-card border border-line bg-paper p-4">
        <div className="flex items-start gap-3">
          <MapPin size={16} className="text-ink2 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span
              className="block text-ink"
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {BUSINESS.name}
            </span>
            <span
              className="block text-ink2"
              style={{ fontSize: 13, lineHeight: "18px" }}
            >
              {BUSINESS.address}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Phone size={16} className="text-ink2 shrink-0" />
          <a
            href={`tel:+61${BUSINESS.phone.replace(/\D/g, "").replace(/^0/, "")}`}
            className="font-mono text-brand"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {BUSINESS.phone}
          </a>
        </div>
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-ink2 mt-0.5 shrink-0" />
          <span
            className="text-ink2"
            style={{ fontSize: 13, lineHeight: "18px" }}
          >
            Mon–Sun · 10:30 am – 10:30 pm
          </span>
        </div>
      </div>
    </section>
  );
}
