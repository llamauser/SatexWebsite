export type EmailProviderName = "resend" | "log";

/**
 * resend: real delivery (RESEND_API_KEY, EMAIL_FROM).  log: nothing leaves the machine; the rendered email is kept in
 * email_log (local development and tests). EMAIL_PROVIDER forces one; otherwise a Resend key selects resend.
 */
export function emailProvider(env: NodeJS.ProcessEnv = process.env): EmailProviderName {
  const wanted = (env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (wanted === "log") return "log";
  return env.RESEND_API_KEY ? "resend" : "log";
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/** Resend refuses a message over 40 MB in total; stay well under, so one big attachment never blocks the email. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Returns the provider message id (null for the log provider). Throws on failure so the job is retried. */
export async function sendEmail(mail: OutgoingEmail, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (emailProvider(env) === "log") return null;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "SATEX Commerce <onboarding@resend.dev>",
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { id?: string }).id ?? null;
}
