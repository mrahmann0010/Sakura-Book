import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party, minified, and not ours to fix: the pdf.js worker and its
    // data files, copied out of the installed pdfjs-dist into public/ by
    // scripts/copy-pdfjs-assets.mjs. Linting the worker alone reported eight
    // errors and seven hundred warnings about someone else's minifier output.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
