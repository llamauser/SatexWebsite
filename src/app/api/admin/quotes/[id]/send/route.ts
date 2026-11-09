import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { defaultValidUntil } from "@/lib/quotes/calc";
import { loadQuotePdfData } from "@/lib/quotes/pdf-data";
import { renderQuotePdf, type QuotePdfLabels } from "@/lib/quotes/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({ validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * "Send to client": renders the quote as a PDF in the client's language, stores it, then moves the quote to `sent`
 * (which queues the e-mail). Staff only. The status change itself is done by the database function `send_quote`, called with
 * the caller's own session, so the database re-checks who is asking.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const sb = await createServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const service = createServiceSupabase();
  const { data: profile } = await service.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (profile?.role !== "sales" && profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: quote } = await service.from("quotes").select("status, revision, valid_until").eq("id", id).maybeSingle();
  if (!quote) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (quote.status !== "submitted" && quote.status !== "in_review") return NextResponse.json({ error: "status" }, { status: 409 });
  const { count } = await service.from("quote_lines").select("id", { count: "exact", head: true }).eq("quote_id", id);
  if (!count) return NextResponse.json({ error: "no_lines" }, { status: 409 });

  const { data: validity } = await service.from("app_settings").select("value").eq("key", "quote_validity_days").maybeSingle();
  const validUntil = body.data.validUntil ?? quote.valid_until ?? defaultValidUntil(Number(validity?.value) || 15);
  if (validUntil < new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "past" }, { status: 409 });

  const loaded = await loadQuotePdfData(service, id);
  if (!loaded) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data, locale } = loaded;
  data.validUntil = validUntil;

  const t = await getTranslations({ locale, namespace: "quotePdf" });
  const labels: QuotePdfLabels = {
    quote: t("quote"), revision: t("revision"), date: t("date"), validUntil: t("validUntil"), client: t("client"), taxId: t("taxId"), billing: t("billing"), shipping: t("shipping"),
    reference: t("reference"), fabric: t("fabric"), meters: t("meters"), unitPrice: t("unitPrice"), lineTotal: t("lineTotal"),
    subtotal: t("subtotal"), discount: t("discount"), vat: t("vat"), total: t("total"), totalNote: t("totalNote"), message: t("message"), terms: t("terms"),
    footer: t("footer", { year: data.company.foundedYear }),
  };

  let pdf: Buffer;
  try {
    pdf = await renderQuotePdf(data, labels, locale);
  } catch (e) {
    console.error("quote pdf failed", e);
    return NextResponse.json({ error: "pdf_failed" }, { status: 500 });
  }
  const pdfPath = `quotes/${id}/r${quote.revision}.pdf`;
  const upload = await service.storage.from("quote-pdfs").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upload.error) return NextResponse.json({ error: "storage_failed" }, { status: 500 });

  const { error } = await sb.rpc("send_quote", { p_id: id, p_valid_until: validUntil, p_pdf_path: pdfPath });
  if (error) return NextResponse.json({ error: "send_failed", message: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, pdfPath, validUntil });
}
