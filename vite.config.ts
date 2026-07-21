import path from "node:path";
import { createRequire } from "node:module";

import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);

const pdfjsDistPath = path.dirname(require.resolve("pdfjs-dist/package.json"));
const cMapsDir = normalizePath(path.join(pdfjsDistPath, "cmaps"));
const standardFontsDir = normalizePath(
  path.join(pdfjsDistPath, "standard_fonts")
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    svgr(),
    viteStaticCopy({
      targets: [
        {
          src: `${cMapsDir}/*`,
          dest: "cmaps",
          rename: { stripBase: true },
        },
        {
          src: `${standardFontsDir}/*`,
          dest: "standard_fonts",
          rename: { stripBase: true },
        },
      ],
    }),
    tailwindcss(),
  ],
});
