import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const FROM = process.env.TWILIO_PHONE_NUMBER!;

export async function sendOtp(to: string, code: string): Promise<void> {
  await client.messages.create({
    to,
    from: FROM,
    body: `Your Mandy's Bubble Tea verification code is: ${code}`,
  });
}
