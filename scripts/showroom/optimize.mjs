// Shrinks a glb from Blender for the web: merges duplicates, quantizes geometry and compresses textures (webp, resized).
// No meshopt/draco on purpose: their decoders need WebAssembly or a CDN, which the site's Content-Security-Policy does not allow.
//   node scripts/showroom/optimize.mjs <in.glb> <out.glb> [maxTextureSize=512]
import { statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, textureCompress, weld } from "@gltf-transform/functions";
import sharp from "sharp";

const [input, output, size = "512"] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/showroom/optimize.mjs <in.glb> <out.glb> [maxTextureSize]");
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const max = Number(size);
await doc.transform(
  dedup(),
  weld(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [max, max], quality: 82 }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
  prune(),
);
await io.write(output, doc);
const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
console.log(`${input} (${kb(input)}) -> ${output} (${kb(output)})`);
