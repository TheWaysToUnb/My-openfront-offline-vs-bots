import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { renderHtmlContent } from "../src/server/RenderHtml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const htmlPath = path.resolve(__dirname, "../static/index.html");

const rendered = await renderHtmlContent(htmlPath, {
  perServer: false,
});

await fs.writeFile(htmlPath, rendered, "utf-8");

console.log(`Rendered GitHub Pages HTML: ${htmlPath}`);
