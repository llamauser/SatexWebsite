import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const FILE = "src/components/Example.tsx";

async function messages(code: string) {
  const [result] = await eslint.lintText(code, { filePath: FILE });
  return (result?.messages ?? []).filter((m) => m.ruleId === "satex-rtl/no-physical-direction");
}

describe("satex-rtl/no-physical-direction", () => {
  it.each([
    'const a = "ml-4";',
    'const a = "flex mr-2 items-center";',
    'const a = "md:pl-6";',
    'const a = "absolute left-0";',
    'const a = "text-left";',
    'const a = "rounded-l-lg";',
    'const a = "border-r";',
    "const a = `p-2 pr-${n}`;",
  ])("flags physical classes: %s", async (code) => {
    expect((await messages(code)).length).toBeGreaterThan(0);
  });

  it.each([
    'const a = "ms-4 me-2 ps-6 pe-1";',
    'const a = "absolute start-0 end-0 text-start";',
    'const a = "rounded-s-lg border-e";',
    'const a = "-start-24 -top-24 px-4";',
    'const a = "html-parser";',
  ])("allows logical classes: %s", async (code) => {
    expect(await messages(code)).toEqual([]);
  });
});
