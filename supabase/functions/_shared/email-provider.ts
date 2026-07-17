export type TransactionalEmail = {
  to: string;
  subject: string;
  html: string;
  tags?: Record<string, string>;
};

export type EmailDelivery = {
  id: string | null;
  provider: "maileroo";
};

type MailerooResponse = {
  success?: boolean;
  message?: string;
  data?: { reference_id?: string };
};

type MailerooConfig = {
  apiKey: string;
  fromAddress: string;
  fromName: string;
};

const MAILEROO_ENDPOINT = "https://smtp.maileroo.com/api/v2/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredEnv(name: string): string {
  const value = (Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function assertEmailProviderConfigured(): MailerooConfig {
  const provider = requiredEnv("EMAIL_PROVIDER").toLowerCase();
  if (provider !== "maileroo") throw new Error("EMAIL_PROVIDER must be set to maileroo");

  const fromAddress = requiredEnv("MAILEROO_FROM_EMAIL").toLowerCase();
  if (!EMAIL_PATTERN.test(fromAddress)) throw new Error("MAILEROO_FROM_EMAIL is invalid");

  return {
    apiKey: requiredEnv("MAILEROO_API_KEY"),
    fromAddress,
    fromName: (Deno.env.get("MAILEROO_FROM_NAME") || "D'fortees Pickleball Court").trim(),
  };
}

function normalizedTags(tags: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags || {})
      .filter(([key, value]) => key.trim() && String(value).trim())
      .slice(0, 12)
      .map(([key, value]) => [key.trim().slice(0, 128), String(value).trim().slice(0, 768)]),
  );
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<EmailDelivery> {
  const config = assertEmailProviderConfigured();
  const recipient = String(message.to || "").trim().toLowerCase();
  const subject = String(message.subject || "").trim();
  const html = String(message.html || "").trim();

  if (!EMAIL_PATTERN.test(recipient)) throw new Error("Recipient email is invalid");
  if (!subject) throw new Error("Email subject is required");
  if (!html) throw new Error("Email HTML is required");

  const response = await fetch(MAILEROO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": config.apiKey,
    },
    body: JSON.stringify({
      from: { address: config.fromAddress, display_name: config.fromName },
      to: [{ address: recipient }],
      subject: subject.slice(0, 255),
      html,
      tags: normalizedTags({ application: "dfortees", ...(message.tags || {}) }),
    }),
  });

  const result = await response.json().catch(() => ({})) as MailerooResponse;
  if (!response.ok || result.success === false) {
    const detail = String(result.message || "Email provider rejected the request").slice(0, 300);
    throw new Error(`Maileroo error ${response.status}: ${detail}`);
  }

  return { id: result.data?.reference_id || null, provider: "maileroo" };
}
