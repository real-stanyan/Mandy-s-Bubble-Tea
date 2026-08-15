import { HelpChat } from "./help-chat";

export const dynamic = "force-dynamic";

export default function StaffHelpPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Ask for help
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Something wrong in the shop? Describe it here. I can check payments, the
        printer, and orders, and I can pause delivery or reprint a sticker.
        Anything about refunds or money goes to Rick.
      </p>
      <HelpChat />
    </main>
  );
}
