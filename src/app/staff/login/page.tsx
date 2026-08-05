import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  STAFF_COOKIE,
  STAFF_COOKIE_OPTIONS,
  checkPasscode,
  currentRole,
  isConfigured,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentRole()) redirect("/staff");
  const { error } = await searchParams;
  const configured = isConfigured();

  async function signIn(formData: FormData) {
    "use server";
    const code = String(formData.get("passcode") ?? "");
    const match = checkPasscode(code);
    if (!match) redirect("/staff/login?error=1");
    const jar = await cookies();
    jar.set(STAFF_COOKIE, match.token, STAFF_COOKIE_OPTIONS);
    redirect("/staff");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">Staff</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Enter the shop passcode.
      </p>

      {!configured && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Not set up yet.</b> No passcode is configured on the server, so
          nobody can get in. Set <code>STAFF_PASSCODE</code> and{" "}
          <code>OWNER_PASSCODE</code> in the deployment&apos;s environment
          variables.
        </p>
      )}

      <form action={signIn} className="mt-6 space-y-3">
        <input
          name="passcode"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          placeholder="passcode"
        />
        {error && (
          <p className="text-sm text-red-600">That passcode didn&apos;t work.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-[#3B82C4] px-4 py-2 font-semibold text-white"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
