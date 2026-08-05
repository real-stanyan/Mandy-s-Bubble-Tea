import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { CreateEmailOptions } from "resend";
import { getResendClient } from "./resend";
import { describeSendFailure } from "./send-failure";

export type SendOutcome =
  | { sent: true; id: string | null }
  | { sent: false; reason: string };

/**
 * Sends one transactional email and leaves a server-side trail when it fails.
 *
 * Before this, a failed send existed only as a string on the sender's screen:
 * the routes handed the reason back to the browser and nothing else recorded
 * it, so diagnosing meant asking the person at the counter to retype what they
 * saw (see issue #130). `channel` names the sender ("stock-check",
 * "complaint") so one broken channel is distinguishable from the shared
 * client being broken for everyone.
 */
export async function sendTransactionalEmail(
  channel: string,
  payload: CreateEmailOptions,
): Promise<SendOutcome> {
  try {
    const { data, error } = await getResendClient().emails.send(payload);
    if (error) return report(channel, payload, error);
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    return report(channel, payload, err);
  }
}

function report(
  channel: string,
  payload: CreateEmailOptions,
  err: unknown,
): SendOutcome {
  const reason = describeSendFailure(err);

  // Vercel runtime logs are where this gets read during an incident; Sentry is
  // where it gets noticed without anyone going looking.
  console.error(`[email:${channel}] Resend send failed`, {
    reason,
    to: payload.to,
    from: payload.from,
  });

  Sentry.captureException(
    err instanceof Error ? err : new Error(`[email:${channel}] ${reason}`),
    {
      tags: { email_channel: channel },
      // Deliberately no subject and no replyTo: complaint mail carries the
      // customer's name and address in both, and Sentry runs with
      // sendDefaultPii off precisely so customer data stays out of it.
      extra: { reason, to: payload.to, from: payload.from },
    },
  );

  return { sent: false, reason };
}
