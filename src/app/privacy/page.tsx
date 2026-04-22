import type { Metadata } from "next";
import Link from "next/link";
import { BRAND, BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy Policy & Terms — Mandy's Bubble Tea",
  description:
    "Privacy Policy and Terms of Service for Mandy's Bubble Tea online ordering.",
};

/* ------------------------------------------------------------------ */
/*  Section helper                                                     */
/* ------------------------------------------------------------------ */

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2
        className="text-xl font-bold mb-3"
        style={{ color: BRAND.primaryColor }}
      >
        {number}. {title}
      </h2>
      <div className="space-y-3 text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PrivacyPage() {
  return (
    <main
      className="flex-1 py-10 px-4 sm:px-6 lg:px-8"
      style={{ backgroundColor: BRAND.bgColor }}
    >
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm mb-8 hover:underline"
          style={{ color: BRAND.primaryColor }}
        >
          &larr; Back to Home
        </Link>

        {/* ============== PRIVACY POLICY ============== */}
        <h1
          className="text-3xl font-extrabold mb-1"
          style={{ color: BRAND.primaryColor }}
        >
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 mb-2">
          MANDY&rsquo;S BEVERAGE CO PTY LTD
        </p>
        <p className="text-sm text-gray-400 mb-8">Last Updated: 22 April 2026</p>

        <Section number="1" title="Introduction">
          <p>
            MANDY&rsquo;S BEVERAGE CO PTY LTD (&ldquo;Mandy&rsquo;s&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is
            committed to protecting your privacy. This Privacy Policy outlines
            how we collect, use, and safeguard your personal information when you
            access our website and use our online ordering services.
          </p>
          <p>
            This policy complies with the{" "}
            <em>Australian Privacy Act 1988</em>.
          </p>
        </Section>

        <Section number="2" title="Information We Collect">
          <h3 className="font-semibold text-gray-800">
            2.1 Personal Information
          </h3>
          <p>We may collect the following personal information:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Name</li>
            <li>Phone number</li>
            <li>Email address</li>
            <li>Delivery address (if applicable)</li>
            <li>
              Payment details (processed securely via third-party providers)
            </li>
          </ul>

          <h3 className="font-semibold text-gray-800 mt-4">
            2.2 Order Information
          </h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>Order details (items purchased, preferences)</li>
            <li>Transaction amount</li>
            <li>Promotion usage (e.g., discounts, loyalty rewards)</li>
          </ul>

          <h3 className="font-semibold text-gray-800 mt-4">
            2.3 Technical Information
          </h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>IP address</li>
            <li>Browser type</li>
            <li>Device information</li>
            <li>Cookies and usage data</li>
          </ul>

          <h3 className="font-semibold text-gray-800 mt-4">
            2.4 Mobile App Data
          </h3>
          <p>When you use our iOS or Android app, we additionally collect:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Push notification token (issued by Apple APNs or Google FCM via
              Expo) — used solely to notify you when your order is ready for
              pickup
            </li>
            <li>
              App version and platform (iOS or Android) — for support and
              diagnostics
            </li>
            <li>
              Anonymous sign-in identifiers from Apple Sign In or Google Sign In,
              when you choose those login methods
            </li>
          </ul>
          <p className="mt-2">
            We do not collect precise location, contacts, photos, or any data
            not listed above. The app does not use third-party advertising or
            analytics SDKs.
          </p>
        </Section>

        <Section number="3" title="How We Use Your Information">
          <p>We use your information to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Process and fulfill orders</li>
            <li>Provide pickup or delivery services</li>
            <li>Manage customer support</li>
            <li>Operate loyalty and promotional programs</li>
            <li>Send marketing communications (if opted-in)</li>
            <li>Improve our website and services</li>
          </ul>
        </Section>

        <Section number="4" title="Marketing Communications">
          <p>
            By registering or placing an order, you may receive promotional
            messages (e.g., offers, discounts). You can opt out at any time by
            following the unsubscribe instructions or contacting us.
          </p>
        </Section>

        <Section number="5" title="Sharing of Information">
          <p>
            We do not sell your personal information. We share only the minimum
            data required with the following trusted service providers:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Square, Inc.</strong> (payments, catalog, order
              management, loyalty stars) — receives your name, phone number,
              order details, and payment information. See{" "}
              <a
                href="https://squareup.com/au/en/legal/general/privacy"
                className="underline"
                style={{ color: BRAND.primaryColor }}
                target="_blank"
                rel="noopener noreferrer"
              >
                Square&rsquo;s Privacy Notice
              </a>
              .
            </li>
            <li>
              <strong>Supabase, Inc.</strong> (authentication, account database)
              — stores your phone number, name, and account metadata. See{" "}
              <a
                href="https://supabase.com/privacy"
                className="underline"
                style={{ color: BRAND.primaryColor }}
                target="_blank"
                rel="noopener noreferrer"
              >
                Supabase Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>Expo / Apple APNs / Google FCM</strong> (push notification
              delivery) — receives your anonymous device push token and the
              notification payload (e.g., &ldquo;Your order is ready&rdquo;).
            </li>
            <li>
              <strong>Apple Inc.</strong> and <strong>Google LLC</strong> — if
              you choose Sign in with Apple or Sign in with Google, they provide
              us with an anonymous user identifier and, if you consent, your
              name.
            </li>
            <li>
              <strong>Twilio Inc.</strong> (SMS delivery for one-time login
              codes, via Supabase) — receives your phone number and the OTP
              message body.
            </li>
            <li>
              <strong>Vercel Inc.</strong> (web hosting) — processes incoming
              web requests; does not retain personal data beyond standard server
              logs.
            </li>
          </ul>
          <p>
            All third parties are contractually or legally required to comply
            with privacy obligations and use your data only for the services
            they provide to us.
          </p>
        </Section>

        <Section number="6" title="Data Security">
          <p>
            We take reasonable steps to protect your information, including:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Secure encryption (SSL)</li>
            <li>Trusted payment gateways</li>
            <li>Restricted internal access</li>
          </ul>
        </Section>

        <Section number="7" title="Cookies">
          <p>We use cookies to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Enhance user experience</li>
            <li>Remember preferences</li>
            <li>Analyse website traffic</li>
          </ul>
          <p>You may disable cookies through your browser settings.</p>
        </Section>

        <Section number="8" title="Access and Correction">
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Request access to your personal information</li>
            <li>Request corrections to inaccurate data</li>
          </ul>
          <p>Please contact us using the details below.</p>
        </Section>

        <Section number="9" title="Account Deletion">
          <p>
            You may delete your Mandy&rsquo;s account at any time. This
            permanently removes:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Your phone number, name, and login credentials</li>
            <li>Your device push notification tokens</li>
            <li>
              Your linked Square customer record (loyalty stars balance,
              promotion eligibility)
            </li>
          </ul>
          <p className="mt-2 font-medium text-gray-800">How to delete:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>In the mobile app:</strong> open the Account tab, scroll
              to the bottom, and tap &ldquo;Delete Account&rdquo;. Confirm the
              prompt. Your account is deleted immediately.
            </li>
            <li>
              <strong>Alternatively:</strong> email or call us using the contact
              details below and we will delete your account within 7 days.
            </li>
          </ul>
          <p className="mt-2">
            Past order records (including amounts and items) are retained in
            anonymised form for up to 7 years to comply with Australian tax and
            accounting law. These records no longer contain your name, phone
            number, or any information that can identify you.
          </p>
        </Section>

        <Section number="10" title="Contact Us">
          <p>MANDY&rsquo;S BEVERAGE CO PTY LTD</p>
          <p>
            Address:{" "}
            <span className="text-gray-800">{BUSINESS.address}</span>
          </p>
          <p>
            Phone:{" "}
            <a
              href={`tel:${BUSINESS.phone}`}
              className="underline"
              style={{ color: BRAND.primaryColor }}
            >
              {BUSINESS.phone}
            </a>
          </p>
        </Section>

        {/* ============== DIVIDER ============== */}
        <hr className="my-12 border-gray-300" />

        {/* ============== TERMS OF SERVICE ============== */}
        <h1
          id="terms"
          className="text-3xl font-extrabold mb-1 scroll-mt-24"
          style={{ color: BRAND.primaryColor }}
        >
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 mb-2">
          MANDY&rsquo;S BEVERAGE CO PTY LTD
        </p>
        <p className="text-sm text-gray-400 mb-8">Last Updated: April 2026</p>

        <Section number="1" title="Acceptance of Terms">
          <p>
            By accessing our website or using our online ordering services, you
            agree to be bound by these Terms of Service.
          </p>
        </Section>

        <Section number="2" title="Orders & Payments">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              All orders must be paid online or in accordance with in-store
              payment policies
            </li>
            <li>
              Once an order is confirmed, it may not be modified or cancelled
            </li>
            <li>
              We reserve the right to cancel orders due to system errors, pricing
              issues, or product unavailability, with a full refund provided
            </li>
          </ul>
        </Section>

        <Section number="3" title="Pricing & Promotions">
          <h3 className="font-semibold text-gray-800">
            3.1 First Order 30% Off
          </h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>Available to first-time registered users only</li>
            <li>Limited to one use per account</li>
            <li>Cannot be combined with other promotions or discounts</li>
            <li>
              Mandy&rsquo;s reserves the right to cancel orders or accounts
              suspected of abusing this promotion
            </li>
          </ul>

          <h3 className="font-semibold text-gray-800 mt-4">
            3.2 Loyalty Program (Buy 9 Get 1 Free)
          </h3>
          <p>We offer a loyalty reward program as follows:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Each purchased drink counts toward your loyalty progress</li>
            <li>
              After purchasing 9 drinks, you are eligible to redeem 1 free drink
            </li>
          </ul>
          <p className="mt-2 font-medium text-gray-800">Conditions:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              The free drink will be of equal or lesser value than the purchased
              items or as determined by Mandy&rsquo;s
            </li>
            <li>Not redeemable for cash</li>
            <li>Non-transferable</li>
            <li>Cannot be used in conjunction with other promotions</li>
            <li>
              Refunded or cancelled orders will not count toward loyalty progress
            </li>
          </ul>
        </Section>

        <Section number="4" title="Account Responsibility">
          <p>
            You are responsible for maintaining the confidentiality and accuracy
            of your account information. We reserve the right to suspend or
            terminate accounts in case of suspicious or fraudulent activity.
          </p>
        </Section>

        <Section number="5" title="Product Availability">
          <ul className="list-disc pl-6 space-y-1">
            <li>Products are subject to availability</li>
            <li>Menu images are for illustrative purposes only</li>
            <li>Actual products may vary slightly</li>
          </ul>
        </Section>

        <Section number="6" title="Refunds & Complaints">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              Orders that have already been prepared are generally non-refundable
            </li>
            <li>
              If there is an issue with your order, please contact us promptly
            </li>
            <li>
              We may offer a remake, store credit, or compensation at our
              discretion
            </li>
          </ul>
        </Section>

        <Section number="7" title="Limitation of Liability">
          <p>
            To the maximum extent permitted by law, Mandy&rsquo;s shall not be
            liable for:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Indirect or consequential losses</li>
            <li>Delivery delays</li>
            <li>Issues caused by third-party services</li>
          </ul>
        </Section>

        <Section number="8" title="Changes to Terms">
          <p>
            We reserve the right to update these Terms of Service at any time.
            Changes will be posted on our website.
          </p>
        </Section>

        <Section number="9" title="Governing Law">
          <p>
            These Terms are governed by the laws of Australia.
          </p>
        </Section>

        <Section number="10" title="Contact Us">
          <p>MANDY&rsquo;S BEVERAGE CO PTY LTD</p>
          <p>
            Address:{" "}
            <span className="text-gray-800">{BUSINESS.address}</span>
          </p>
          <p>
            Phone:{" "}
            <a
              href={`tel:${BUSINESS.phone}`}
              className="underline"
              style={{ color: BRAND.primaryColor }}
            >
              {BUSINESS.phone}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
