import { redirect } from "next/navigation";
import { currentRole } from "@/lib/staff/auth";
import { StaffNav } from "./nav";

// Everything in this route group needs a passcode. The login page sits outside
// it — a route group doesn't change the URL, so /staff and /staff/login are
// still siblings, but only this side is gated.

export const dynamic = "force-dynamic";

export default async function GatedStaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await currentRole();
  if (!role) redirect("/staff/login");
  return (
    <>
      <StaffNav role={role} />
      {children}
    </>
  );
}
