/**
 * Preview of the procedural textures: writes one 512px swatch per structure to .tmp/texture-preview/
 * so a human can eyeball them.   Run: pnpm textures:preview
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STRUCTURE_NAMES } from "./seed-data/dictionaries";
import { swatchRaw, toWebp } from "./lib/textures";

async function main() {
  const dir = join(process.cwd(), ".tmp", "texture-preview");
  mkdirSync(dir, { recursive: true });
  for (const structure of Object.keys(STRUCTURE_NAMES)) {
    const hex = structure === "denim" ? "#2B3A67" : "#2C5AA0";
    writeFileSync(join(dir, `${structure}.webp`), await toWebp(swatchRaw(structure, hex, 512), 512, 512));
  }
  console.log(`Wrote ${Object.keys(STRUCTURE_NAMES).length} swatches to ${dir}`);
}

void main();
