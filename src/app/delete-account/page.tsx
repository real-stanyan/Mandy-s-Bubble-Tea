import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  // The root layout appends "| Mandy's Bubble Tea"; naming the shop here too
  // renders it twice.
  title: "Delete Your Account",
  description:
    "How to delete your Mandy's Bubble Tea account and what happens to your data.",
};

/**
 * Google Play requires a public URL where account deletion is explained, and
 * requires it to do three things: name the app and developer as they appear
 * on the store listing, put the steps somewhere prominent, and state exactly
 * what is deleted, what is kept, and for how long.
 *
 * §9 of the privacy policy already says all of this, but it is section nine
 * of a long document — "prominent" is the part that fails. This page exists
 * so the steps are the first thing on the screen. The facts are the same;
 * when one changes, change both.
 */
export default function DeleteAccountPage() {
  return (
    <main
      className="flex-1 py-10 px-4 sm:px-6 lg:px-8"
      style={{ backgroundColor: BRAND.bgColor }}
    >
      <div className="max-w-3xl mx-auto">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm mb-8 hover:underline"
          style={{ color: BRAND.primaryColor }}
        >
          &larr; Back to Home
        </Link>

        <h1
          className="text-3xl font-extrabold mb-1"
          style={{ color: BRAND.primaryColor }}
        >
          Delete Your Account
        </h1>
        <p className="text-sm text-gray-500 mb-1">
          Mandy&rsquo;s Bubble Tea &mdash; mobile app and website
        </p>
        <p className="text-sm text-gray-500 mb-8">
          Developer: MANDY&rsquo;S BEVERAGE CO PTY LTD
        </p>

        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-3"
            style={{ color: BRAND.primaryColor }}
          >
            Delete your account in the app
          </h2>
          <ol className="list-decimal pl-6 space-y-2 text-gray-800">
            <li>Open the Mandy&rsquo;s Bubble Tea app and sign in.</li>
            <li>
              Tap the <strong>Account</strong> tab at the bottom of the screen.
            </li>
            <li>
              Scroll to the bottom and tap <strong>Delete Account</strong>.
            </li>
            <li>
              Confirm when prompted. Your account is deleted immediately &mdash;
              there is nothing else to wait for.
            </li>
          </ol>
        </section>

        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-3"
            style={{ color: BRAND.primaryColor }}
          >
            Request deletion without the app
          </h2>
          <p className="text-gray-800 mb-2">
            If you no longer have the app installed, contact us and we will
            delete your account within 7 days. Tell us the phone number your
            account uses so we can find it.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-gray-800">
            <li>
              Email:{" "}
              <a
                href="mailto:hello@mandybubbletea.com"
                className="underline"
                style={{ color: BRAND.primaryColor }}
              >
                hello@mandybubbletea.com
              </a>
            </li>
            <li>Phone: {BUSINESS.phone}</li>
            <li>In store: {BUSINESS.address}</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-3"
            style={{ color: BRAND.primaryColor }}
          >
            What is deleted
          </h2>
          <p className="text-gray-800 mb-2">
            Deleting your account permanently removes:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-gray-800">
            <li>Your name and phone number</li>
            <li>Your login credentials, including any linked Apple or Google sign-in</li>
            <li>Your saved delivery addresses</li>
            <li>Your device push notification tokens</li>
            <li>
              Your customer record with Square, including loyalty stars,
              membership tier, and any unused promotions or discounts
            </li>
            <li>
              Any photos you attached when reporting a problem with an order
            </li>
          </ul>
          <p className="text-gray-800 mt-3">
            Loyalty stars and rewards cannot be restored after deletion, and
            they have no cash value.
          </p>
        </section>

        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-3"
            style={{ color: BRAND.primaryColor }}
          >
            What is kept, and for how long
          </h2>
          <p className="text-gray-800">
            Records of past orders &mdash; the items and the amounts &mdash; are
            kept in <strong>anonymised</strong> form for up to{" "}
            <strong>7 years</strong>, because Australian tax and accounting law
            requires a business to retain its sales records. These records no
            longer contain your name, your phone number, or anything else that
            can identify you, and they cannot be linked back to you.
          </p>
          <p className="text-gray-800 mt-3">
            Nothing else is retained.
          </p>
        </section>

        <p className="text-sm text-gray-500">
          For the full picture of what we collect and why, see our{" "}
          <Link
            href="/privacy"
            className="underline"
            style={{ color: BRAND.primaryColor }}
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
