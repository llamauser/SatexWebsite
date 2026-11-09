import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmailJob, loadSiteSettings } from "@/emails/context";
import { TEMPLATES } from "@/emails/registry";
import { renderEmail } from "@/emails/render";
import { MAX_ATTACHMENT_BYTES, emailProvider, sendEmail, type EmailAttachment } from "@/emails/send";
import type { JobPayload } from "../runner";

/**
 * Sends one transactional email event to every recipient, once.
 * - one row per (template, entity, recipient) in email_log; a retry never sends the same email twice
 * - client emails also create an in-app notification (the bell), once, when the email is first delivered
 */
export async function handleEmail(message: JobPayload, sb: SupabaseClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const settings = await loadSiteSettings(sb);
  const job = await loadEmailJob(sb, message, settings);
  if (!job || job.recipients.length === 0) return;

  const def = TEMPLATES[job.template];
  const provider = emailProvider(env);
  const siteUrl = env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const failures: string[] = [];

  // the file that goes with the email, fetched once for all recipients; if it cannot be read the email still goes out (it has the link)
  let attachments: EmailAttachment[] = [];
  if (job.attachment) {
    const file = await sb.storage.from(job.attachment.bucket).download(job.attachment.path);
    if (file.error || !file.data) {
      console.error(JSON.stringify({ event: "email.attachment.missing", template: job.template, path: job.attachment.path, error: file.error?.message ?? "empty" }));
    } else {
      const content = Buffer.from(await file.data.arrayBuffer());
      if (content.length <= MAX_ATTACHMENT_BYTES) attachments = [{ filename: job.attachment.filename, content }];
      else console.error(JSON.stringify({ event: "email.attachment.too_big", template: job.template, bytes: content.length }));
    }
  }

  for (const recipient of job.recipients) {
    const key = [job.template, job.entityId, message.key ?? "", recipient.email.toLowerCase()].join(":");
    const { data: existing } = await sb.from("email_log").select("id, status, attempts").eq("dedupe_key", key).maybeSingle();
    if (existing && (existing.status === "sent" || existing.status === "logged")) continue;

    const vars = job.vars(recipient.locale);
    const mail = await renderEmail({
      template: job.template, locale: recipient.locale, vars, recipientName: recipient.name || undefined,
      siteUrl, company: settings.company, email: settings.email, foundedYear: settings.foundedYear,
    });

    const base = {
      to_email: recipient.email, template: job.template, locale: recipient.locale, subject: mail.subject, dedupe_key: key,
      payload: {
        entityId: job.entityId, vars, attachments: attachments.map((a) => ({ filename: a.filename, bytes: a.content.length })),
        ...(provider === "log" ? { html: mail.html, text: mail.text, url: mail.url } : {}),
      },
    };
    let logId = existing?.id as string | undefined;
    if (!logId) {
      const { data, error } = await sb.from("email_log").insert({ ...base, status: "queued", attempts: 1 }).select("id").single();
      if (error) throw new Error(`email_log: ${error.message}`);
      logId = data.id;
    } else {
      await sb.from("email_log").update({ ...base, attempts: (existing!.attempts ?? 0) + 1 }).eq("id", logId);
    }

    try {
      const providerId = await sendEmail({ to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text, attachments }, env);
      await sb.from("email_log").update({ status: provider === "log" ? "logged" : "sent", provider_id: providerId, sent_at: new Date().toISOString(), error: null }).eq("id", logId);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await sb.from("email_log").update({ status: "failed", error }).eq("id", logId);
      failures.push(`${recipient.email}: ${error}`);
      continue;
    }

    if (def.notify && recipient.userId) {
      const { error } = await sb.from("notifications").insert({
        user_id: recipient.userId,
        type: job.template,
        payload: { entityId: job.entityId, ref: vars.ref ?? "", fabric: vars.fabric ?? "", link: def.link(vars) },
      });
      if (error) failures.push(`notification for ${recipient.email}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
}
