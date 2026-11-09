import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleEmail } from "@/lib/jobs/handlers/email";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

const job = {
  template: "quote_sent" as const,
  entityId: "q1",
  recipients: [{ email: "client@example.test", locale: "fr" as const, name: "Cléa", userId: null }],
  vars: () => ({ id: "q1", ref: "DEV-2026-0001", company: "Atelier Test", total: "120,00 €", validUntil: "1 déc. 2026", reason: "" }),
  attachment: { bucket: "quote-pdfs", path: "quotes/q1/r1.pdf", filename: "DEV-2026-0001.pdf" },
};

vi.mock("@/emails/context", () => ({
  loadSiteSettings: async () => ({ company: "SATEX Commerce", email: "contact@satex.test", foundedYear: 1995, timezone: "Europe/Paris", staffEmail: "staff@satex.test", staffLocale: "fr" }),
  loadEmailJob: async () => job,
}));

/** Just enough of the database client for the e-mail handler: the log table, notifications and Storage. */
function fakeDb(file: Uint8Array | null) {
  const log: Record<string, unknown>[] = [];
  const downloads: string[] = [];
  const sb = {
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          downloads.push(`${bucket}/${path}`);
          return file ? { data: new Blob([file as BlobPart]), error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
    from: (table: string) => {
      if (table === "email_log") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          insert: (row: Record<string, unknown>) => ({ select: () => ({ single: async () => { log.push({ ...row }); return { data: { id: "log-1" }, error: null }; } }) }),
          update: (row: Record<string, unknown>) => ({ eq: async () => { Object.assign(log[0]!, row); return { error: null }; } }),
        };
      }
      if (table === "notifications") return { insert: async () => ({ error: null }) };
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { sb: sb as unknown as SupabaseClient, log, downloads };
}

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x7f]); // "%PDF-1.7\n" and some binary bytes

describe("the quote e-mail carries its PDF", () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the file to Resend as a base64 attachment named after the quote, downloaded once", async () => {
    const { sb, log, downloads } = fakeDb(pdf);
    await handleEmail({ type: "q_email", id: "q1", template: "quote_sent", attempt: 1 } as never, sb, env({ RESEND_API_KEY: "re_test", EMAIL_FROM: "SATEX <no-reply@satex.test>" }));
    expect(downloads).toEqual(["quote-pdfs/quotes/q1/r1.pdf"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const attachments = calls[0]!.body.attachments as { filename: string; content: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.filename).toBe("DEV-2026-0001.pdf");
    expect([...Buffer.from(attachments[0]!.content, "base64")]).toEqual([...pdf]); // the bytes arrive intact
    expect((log[0]!.payload as { attachments: unknown[] }).attachments).toEqual([{ filename: "DEV-2026-0001.pdf", bytes: pdf.length }]);
    expect(log[0]!.status).toBe("sent");
  });

  it("keeps the same file for every recipient but downloads it only once", async () => {
    job.recipients.push({ email: "second@example.test", locale: "fr", name: "Sam", userId: null });
    try {
      const { sb, downloads } = fakeDb(pdf);
      await handleEmail({ type: "q_email", id: "q1", template: "quote_sent", attempt: 1 } as never, sb, env({ RESEND_API_KEY: "re_test" }));
      expect(downloads).toHaveLength(1);
      expect(calls).toHaveLength(2);
      expect(calls.every((c) => (c.body.attachments as unknown[]).length === 1)).toBe(true);
    } finally {
      job.recipients.pop();
    }
  });

  it("with the log provider nothing is sent, and the log says which file would have gone with it", async () => {
    const { sb, log } = fakeDb(pdf);
    await handleEmail({ type: "q_email", id: "q1", template: "quote_sent", attempt: 1 } as never, sb, env({ EMAIL_PROVIDER: "log" }));
    expect(calls).toHaveLength(0);
    expect(log[0]!.status).toBe("logged");
    expect((log[0]!.payload as { attachments: { filename: string }[] }).attachments[0]!.filename).toBe("DEV-2026-0001.pdf");
  });

  it("if the PDF cannot be read, the e-mail still goes out without it (it has the link to the quote)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sb, log } = fakeDb(null);
    await handleEmail({ type: "q_email", id: "q1", template: "quote_sent", attempt: 1 } as never, sb, env({ RESEND_API_KEY: "re_test" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.attachments).toBeUndefined();
    expect((log[0]!.payload as { attachments: unknown[] }).attachments).toEqual([]);
    expect(String(error.mock.calls[0]![0])).toContain("email.attachment.missing");
  });

  it("an email without an attachment (any other template) sends none", async () => {
    const withoutFile = { ...job, attachment: undefined };
    const context = await import("@/emails/context");
    vi.spyOn(context, "loadEmailJob").mockResolvedValueOnce(withoutFile as never);
    const { sb, downloads } = fakeDb(pdf);
    await handleEmail({ type: "q_email", id: "q1", template: "quote_sent", attempt: 1 } as never, sb, env({ RESEND_API_KEY: "re_test" }));
    expect(downloads).toEqual([]);
    expect(calls[0]!.body.attachments).toBeUndefined();
  });
});
