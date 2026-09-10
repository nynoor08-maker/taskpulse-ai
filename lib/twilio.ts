import twilio from "twilio";

export async function sendTaskSMS(to: string, message: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio configuration is incomplete.");
  }

  return twilio(accountSid, authToken).messages.create({
    to,
    from,
    body: message,
  });
}
