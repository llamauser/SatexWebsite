import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatMoney, formatNumber } from "@/lib/data/format";

/** Everything the PDF shows, already read from the database (see pdf-data.ts). */
export interface QuotePdfData {
  ref: string;
  revision: number;
  date: string;
  validUntil: string | null;
  currency: string;
  vatRate: number;
  discountPct: number;
  totals: { subtotal: number; discount: number; net: number; vat: number; total: number };
  clientMessage: string | null;
  company: { name: string; email: string; phone: string; address: string; foundedYear: number };
  client: { company: string; taxId: string; shipping: string; billing: string };
  lines: { sku: string; fabric: string; color: string; code: string; meters: number; unitPrice: number; lineTotal: number }[];
  terms: string;
}

export interface QuotePdfLabels {
  quote: string; revision: string; date: string; validUntil: string; client: string; taxId: string; billing: string; shipping: string;
  reference: string; fabric: string; meters: string; unitPrice: string; lineTotal: string;
  subtotal: string; discount: string; vat: string; total: string; totalNote: string; message: string; terms: string; footer: string;
}

const fonts = path.join(process.cwd(), "assets", "fonts");
let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({ family: "Inter", fonts: [{ src: path.join(fonts, "inter-latin-400-normal.woff"), fontWeight: 400 }, { src: path.join(fonts, "inter-latin-700-normal.woff"), fontWeight: 700 }] });
  Font.register({ family: "PlexArabic", fonts: [{ src: path.join(fonts, "IBMPlexSansArabic-Regular.ttf"), fontWeight: 400 }, { src: path.join(fonts, "IBMPlexSansArabic-Bold.ttf"), fontWeight: 700 }] });
  Font.registerHyphenationCallback((word) => [word]); // never hyphenate (Arabic and SKUs must stay whole)
  registered = true;
}

const INK = "#1B2430";
const MUTED = "#5B6675";
const LINE = "#D8DEE6";
const BRAND = "#1F6FEB";

function Doc({ data, labels, locale }: { data: QuotePdfData; labels: QuotePdfLabels; locale: string }) {
  const rtl = locale === "ar";
  const family = rtl ? "PlexArabic" : "Inter";
  const row = rtl ? ("row-reverse" as const) : ("row" as const);
  const align = rtl ? ("right" as const) : ("left" as const);
  const end = rtl ? ("left" as const) : ("right" as const);
  const money = (v: number) => formatMoney(v, data.currency, locale);
  const num = (v: number) => formatNumber(v, locale, { maximumFractionDigits: 2 });
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "long" }).format(new Date(iso)) : "–");

  const s = StyleSheet.create({
    page: { padding: 40, paddingBottom: 60, fontFamily: family, fontSize: 9.5, color: INK, lineHeight: 1.4 },
    head: { flexDirection: row, justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 12 },
    brand: { fontSize: 20, fontWeight: 700, color: BRAND, marginBottom: 8, lineHeight: 1.2 },
    small: { fontSize: 8.5, color: MUTED, textAlign: align },
    title: { fontSize: 16, fontWeight: 700, textAlign: end, lineHeight: 1.2 },
    cols: { flexDirection: row, justifyContent: "space-between", marginTop: 16, gap: 24 },
    box: { flexGrow: 1, flexBasis: 0 },
    label: { fontSize: 8, color: MUTED, textTransform: "uppercase", marginBottom: 2, textAlign: align },
    text: { textAlign: align },
    tableHead: { flexDirection: row, backgroundColor: "#EEF2F7", paddingVertical: 5, paddingHorizontal: 6, marginTop: 18, fontWeight: 700 },
    tableRow: { flexDirection: row, paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
    cSku: { width: "14%", textAlign: align }, cName: { width: "39%", textAlign: align, paddingEnd: 6 }, cMeters: { width: "11%", textAlign: end }, cUnit: { width: "17%", textAlign: end }, cTotal: { width: "19%", textAlign: end },
    totals: { marginTop: 12, alignSelf: end === "right" ? "flex-end" : "flex-start", width: "48%" },
    totalRow: { flexDirection: row, justifyContent: "space-between", paddingVertical: 2 },
    grand: { flexDirection: row, justifyContent: "space-between", borderTopWidth: 1, borderTopColor: INK, marginTop: 4, paddingTop: 5, fontSize: 12, fontWeight: 700 },
    foot: { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "center", fontSize: 8, color: MUTED },
  });

  return (
    <Document title={`${labels.quote} ${data.ref}`} author={data.company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.brand}>{data.company.name}</Text>
            {[data.company.address, data.company.phone, data.company.email].filter(Boolean).map((t, i) => <Text key={i} style={s.small}>{t}</Text>)}
          </View>
          <View>
            <View style={{ flexDirection: row, justifyContent: "flex-end", gap: 6, marginBottom: 8 }}><Text style={s.title}>{labels.quote}</Text><Text style={s.title}>{data.ref}</Text></View>
            <Text style={{ ...s.small, textAlign: end }}>{`${labels.revision} ${data.revision}`}</Text>
            <Text style={{ ...s.small, textAlign: end }}>{`${labels.date} : ${day(data.date)}`}</Text>
            <Text style={{ ...s.small, textAlign: end }}>{`${labels.validUntil} : ${day(data.validUntil)}`}</Text>
          </View>
        </View>

        <View style={s.cols}>
          <View style={s.box}>
            <Text style={s.label}>{labels.client}</Text>
            <Text style={{ ...s.text, fontWeight: 700 }}>{data.client.company}</Text>
            {data.client.taxId ? <Text style={s.text}>{`${labels.taxId} : ${data.client.taxId}`}</Text> : null}
          </View>
          {data.client.billing ? <View style={s.box}><Text style={s.label}>{labels.billing}</Text><Text style={s.text}>{data.client.billing}</Text></View> : null}
          {data.client.shipping ? <View style={s.box}><Text style={s.label}>{labels.shipping}</Text><Text style={s.text}>{data.client.shipping}</Text></View> : null}
        </View>

        <View style={s.tableHead} fixed>
          <Text style={s.cSku}>{labels.reference}</Text>
          <Text style={s.cName}>{labels.fabric}</Text>
          <Text style={s.cMeters}>{labels.meters}</Text>
          <Text style={s.cUnit}>{labels.unitPrice}</Text>
          <Text style={s.cTotal}>{labels.lineTotal}</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={s.tableRow} wrap={false}>
            <Text style={s.cSku}>{l.sku}</Text>
            <Text style={s.cName}>{`${l.fabric} · ${l.color}\u00A0(${l.code})`}</Text>
            <Text style={s.cMeters}>{num(l.meters)}</Text>
            <Text style={s.cUnit}>{money(l.unitPrice)}</Text>
            <Text style={s.cTotal}>{money(l.lineTotal)}</Text>
          </View>
        ))}

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text>{labels.subtotal}</Text><Text>{money(data.totals.subtotal)}</Text></View>
          {data.discountPct > 0 ? <View style={s.totalRow}><Text>{`${labels.discount} (${num(data.discountPct)} %)`}</Text><Text>-{money(data.totals.discount)}</Text></View> : null}
          <View style={s.totalRow}><Text>{`${labels.vat} (${num(data.vatRate * 100)} %)`}</Text><Text>{money(data.totals.vat)}</Text></View>
          <View style={s.grand}><Text>{labels.total}</Text><Text>{money(data.totals.total)}</Text></View>
          <Text style={{ ...s.small, marginTop: 3 }}>{labels.totalNote}</Text>
        </View>

        {data.clientMessage ? <View style={{ marginTop: 16 }} wrap={false}><Text style={s.label}>{labels.message}</Text><Text style={s.text}>{data.clientMessage}</Text></View> : null}
        {data.terms ? <View style={{ marginTop: 16 }} wrap={false}><Text style={s.label}>{labels.terms}</Text><Text style={{ ...s.small }}>{data.terms}</Text></View> : null}

        <Text style={s.foot} fixed>{labels.footer}</Text>
      </Page>
    </Document>
  );
}

/** The quote as a PDF file, in the client's language (Arabic: right to left, IBM Plex Sans Arabic). */
export async function renderQuotePdf(data: QuotePdfData, labels: QuotePdfLabels, locale: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<Doc data={data} labels={labels} locale={locale} />);
}
