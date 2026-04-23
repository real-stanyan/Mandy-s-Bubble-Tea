import type { AuthProfile } from "@/components/auth/AuthProvider";

type AccountHeaderProps = {
  profile: AuthProfile;
};

export function AccountHeader({ profile }: AccountHeaderProps) {
  const fullName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "Member";
  const initials = computeInitials(profile.first_name, profile.last_name);

  return (
    <div className="flex items-center gap-3.5 px-4 pt-2 pb-3">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-peach to-brand"
        style={{ boxShadow: "0 6px 14px rgba(141,85,36,0.45)" }}
      >
        <span
          className="font-serif text-white"
          style={{ fontSize: 22, letterSpacing: -0.5 }}
        >
          {initials}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h1
          className="font-serif text-ink truncate"
          style={{ fontSize: 22, letterSpacing: -0.5, fontWeight: 500 }}
        >
          {fullName}
        </h1>
        <p
          className="font-mono text-ink3 mt-0.5 truncate"
          style={{ fontSize: 12 }}
        >
          {formatPhone(profile.phone_e164)}
        </p>
      </div>
    </div>
  );
}

function computeInitials(
  first: string | null,
  last: string | null,
): string {
  const a = first?.trim()?.[0] ?? "";
  const b = last?.trim()?.[0] ?? "";
  const initials = `${a}${b}`.toUpperCase();
  return initials || "🧋";
}

function formatPhone(e164: string): string {
  if (!e164) return "";
  if (!e164.startsWith("+61")) return e164;
  const local = `0${e164.slice(3).replace(/^0+/, "")}`;
  if (local.length !== 10) return e164;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
