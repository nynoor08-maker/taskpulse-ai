import { Resend } from "resend";
import { createServiceClient } from "@/server";
import { sendTaskSMS } from "@/lib/twilio";

type FallbackTask = {
  id: string;
  title: string;
  description: string | null;
  target_vendor_phone: string | null;
};

type FallbackVendor = {
  business_name: string;
  email: string | null;
};

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://taskpulse-ai.vercel.app").replace(
    /\/$/,
    "",
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function sendFallbackEmail(vendor: FallbackVendor, task: FallbackTask) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !vendor.email) return false;

  const quoteUrl = `${appUrl()}/vendor/quote?taskId=${encodeURIComponent(task.id)}`;
  const description = escapeHtml(task.description ?? task.title);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: vendor.email,
    subject: `Quote request: ${task.title}`,
    html: `<p>Hi ${escapeHtml(vendor.business_name)},</p><p>We tried calling regarding <strong>${escapeHtml(task.title)}</strong>.</p><p>${description}</p><p><a href="${quoteUrl}">Submit a quote</a></p>`,
  });
  if (error) throw new Error(`Unable to send fallback email: ${error.message}`);
  return true;
}

export async function dispatchFallback(
  task: FallbackTask,
) {
  if (!task.target_vendor_phone) {
    throw new Error("Task has no vendor phone number for fallback delivery.");
  }

  const supabase = await createServiceClient();
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("business_name, email")
    .eq("phone_number", task.target_vendor_phone)
    .maybeSingle();
  if (vendorError) throw new Error(`Unable to find vendor: ${vendorError.message}`);

  const vendorName = vendor?.business_name ?? "there";
  const quoteUrl = `${appUrl()}/vendor/quote?taskId=${encodeURIComponent(task.id)}`;
  await sendTaskSMS(
    task.target_vendor_phone,
    `Hi ${vendorName}, we tried calling regarding a service request for '${task.title}'. Reply directly to this text with your rate and availability, or submit a quote: ${quoteUrl}`,
  );

  const emailSent = vendor ? await sendFallbackEmail(vendor, task) : false;
  return { smsSent: true, emailSent };
}
