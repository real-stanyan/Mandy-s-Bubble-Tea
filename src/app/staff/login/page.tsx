import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  STAFF_COOKIE,
  STAFF_COOKIE_OPTIONS,
  checkPasscode,
  currentRole,
  isConfigured,
} from "@/lib/staff/auth";
import {
  clearFailures,
  clientIp,
  lockoutMinutes,
  recordFailure,
} from "@/lib/staff/login-throttle.server";

export const dynamic = "force-dynamic";

export default async function StaffLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mins?: string }>;
}) {
  if (await currentRole()) redirect("/staff");
  const { error, mins } = await searchParams;
  const configured = isConfigured();
  // The wait comes back through the query string, so anyone can hand a staff
  // member a link claiming they are locked out for a year. Clamp it to
  // something the lock could actually produce.
  const parsedMins = Number.parseInt(mins ?? "", 10);
  const waitMins =
    Number.isFinite(parsedMins) && parsedMins > 0 && parsedMins <= 60 ? parsedMins : 15;

  async function signIn(formData: FormData) {
    "use server";
    const ip = await clientIp();

    // Check before comparing, so a locked-out guesser learns nothing from how
    // long the response takes or whether the code was close.
    const waiting = await lockoutMinutes(ip);
    if (waiting > 0) redirect(`/staff/login?error=locked&mins=${waiting}`);

    const code = String(formData.get("passcode") ?? "");
    const match = checkPasscode(code);
    if (!match) {
      const locked = await recordFailure(ip);
      redirect(locked > 0 ? `/staff/login?error=locked&mins=${locked}` : "/staff/login?error=1");
    }
    await clearFailures(ip);
    const jar = await cookies();
    jar.set(STAFF_COOKIE, match.token, STAFF_COOKIE_OPTIONS);
    redirect("/staff");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">Staff</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
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
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="passcode"
        />
        {error === "locked" ? (
          <p className="text-sm text-red-600">
            Too many attempts. Try again in {waitMins} minute
            {waitMins === 1 ? "" : "s"}.
          </p>
        ) : (
          error && (
            <p className="text-sm text-red-600">That passcode didn&apos;t work.</p>
          )
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
