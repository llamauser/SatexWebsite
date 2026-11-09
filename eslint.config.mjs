import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import i18nRtl from "./eslint-rules/no-physical-direction.mjs";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "satex-rtl": i18nRtl },
    rules: { "satex-rtl/no-physical-direction": "error" },
  },
];

export default config;
