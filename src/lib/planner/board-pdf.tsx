import "server-only";
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/* React-PDF images are print assets and its Image component has no alt prop. */
/* eslint-disable jsx-a11y/alt-text */

export interface CollectionBoardPiece {
  label: string;
  garment: string;
  quantity: number;
  sizeRun: string;
  meters: number;
  fabricName: string;
  sku: string;
  colorName: string;
  colorCode: string;
  widthCm: number;
  gsm: number;
  composition: string;
  hex: string;
  photo?: string;
}

export interface CollectionBoardData {
  name: string;
  date: string;
  palette: { name: string; hex: string }[];
  pieces: CollectionBoardPiece[];
}

export interface CollectionBoardLabels {
  title: string;
  palette: string;
  piece: string;
  quantity: string;
  sizeRun: string;
  fabric: string;
  meters: string;
  width: string;
  weight: string;
  composition: string;
  generated: string;
}

const fontPath = path.join(process.cwd(), "assets", "fonts");
let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({ family: "BoardInter", fonts: [
    { src: path.join(fontPath, "inter-latin-400-normal.woff"), fontWeight: 400 },
    { src: path.join(fontPath, "inter-latin-700-normal.woff"), fontWeight: 700 },
  ] });
  Font.register({ family: "BoardArabic", fonts: [
    { src: path.join(fontPath, "IBMPlexSansArabic-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fontPath, "IBMPlexSansArabic-Bold.ttf"), fontWeight: 700 },
  ] });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

function Board({ data, labels, locale }: { data: CollectionBoardData; labels: CollectionBoardLabels; locale: string }) {
  const rtl = locale === "ar";
  const family = rtl ? "BoardArabic" : "BoardInter";
  const row = rtl ? "row-reverse" as const : "row" as const;
  const align = rtl ? "right" as const : "left" as const;
  const s = StyleSheet.create({
    page: { padding: 36, paddingBottom: 48, fontFamily: family, fontSize: 9, color: "#1B2430", lineHeight: 1.35 },
    heading: { fontSize: 22, fontWeight: 700, color: "#1F6FEB", marginBottom: 4 },
    sub: { color: "#5B6675", textAlign: align, marginBottom: 18 },
    sectionTitle: { fontSize: 12, fontWeight: 700, marginBottom: 8, textAlign: align },
    palette: { flexDirection: row, flexWrap: "wrap", gap: 8, marginBottom: 18 },
    swatch: { flexDirection: row, alignItems: "center", gap: 5, borderWidth: 0.5, borderColor: "#D8DEE6", borderRadius: 12, padding: 5 },
    dot: { width: 19, height: 19, borderRadius: 10, borderWidth: 0.5, borderColor: "#D8DEE6" },
    card: { flexDirection: row, borderWidth: 0.7, borderColor: "#D8DEE6", borderRadius: 7, padding: 9, marginBottom: 9, gap: 10 },
    photo: { width: 78, height: 78, objectFit: "cover", borderRadius: 4 },
    fallback: { width: 78, height: 78, borderRadius: 4, borderWidth: 0.5, borderColor: "#D8DEE6" },
    detail: { flexGrow: 1, flexBasis: 0 },
    name: { fontSize: 11, fontWeight: 700, textAlign: align, marginBottom: 2 },
    muted: { color: "#5B6675", textAlign: align },
    top: { flexDirection: row, justifyContent: "space-between", gap: 8, marginBottom: 4 },
    foot: { position: "absolute", bottom: 20, left: 36, right: 36, textAlign: "center", color: "#5B6675", fontSize: 8 },
  });
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return <Document title={`${labels.title} – ${data.name}`}>
    <Page size="A4" style={s.page}>
      <Text style={s.heading}>{labels.title}</Text>
      <Text style={s.sub}>{data.name}</Text>
      <Text style={s.sectionTitle}>{labels.palette}</Text>
      <View style={s.palette}>
        {data.palette.map((color, index) => <View key={`${color.hex}-${index}`} style={s.swatch}>
          <View style={{ ...s.dot, backgroundColor: color.hex }} />
          <Text>{color.name}</Text>
        </View>)}
      </View>
      <Text style={s.sectionTitle}>{labels.piece}</Text>
      {data.pieces.map((piece, index) => <View key={`${piece.sku}-${piece.colorCode}-${index}`} style={s.card} wrap={false}>
        {piece.photo ? <Image src={piece.photo} style={s.photo} /> : <View style={{ ...s.fallback, backgroundColor: piece.hex }} />}
        <View style={s.detail}>
          <View style={s.top}><Text style={s.name}>{piece.label || piece.garment}</Text><Text style={s.muted}>{`${number(piece.meters)} m`}</Text></View>
          <Text style={{ ...s.muted, marginBottom: 2 }}>{`${piece.fabricName} · ${piece.colorName} (${piece.colorCode})`}</Text>
          <Text style={s.muted}>{`${piece.garment} · ${labels.quantity}: ${number(piece.quantity)} · ${labels.sizeRun}: ${piece.sizeRun}`}</Text>
          <Text style={s.muted}>{`${labels.fabric}: ${piece.sku} · ${labels.width}: ${number(piece.widthCm)} cm · ${labels.weight}: ${number(piece.gsm)} gsm`}</Text>
          {piece.composition ? <Text style={s.muted}>{`${labels.composition}: ${piece.composition}`}</Text> : null}
        </View>
      </View>)}
      <Text style={s.foot} fixed>{`${labels.generated} · ${new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(data.date))}`}</Text>
    </Page>
  </Document>;
}

export async function renderCollectionBoardPdf(data: CollectionBoardData, labels: CollectionBoardLabels, locale: string): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<Board data={data} labels={labels} locale={locale} />);
}
