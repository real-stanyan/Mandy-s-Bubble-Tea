// MVP: log to console + Sentry (if available). Phase 5b: wire real
// email transport (Resend / Postmark / SendGrid) once a provider is
// chosen. Returns void — we never block a payment refund on this
// notifier since the refund itself is the customer-facing remedy.
export async function notifyMandyDispatchFailure(args: {
  orderId: string;
  reason: string;
  trackingNumber?: string;
}): Promise<void> {
  console.error(
    `[notify-mandy] DISPATCH FAILED — orderId=${args.orderId} reason=${args.reason} tracking=${args.trackingNumber ?? "n/a"}`,
  );
  // TODO Phase 5b: POST to email transport endpoint.
}
