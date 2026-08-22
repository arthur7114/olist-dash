#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FileBlob, SpreadsheetFile } = require("@oai/artifact-tool");
const root = path.resolve(process.argv[2] || ".");
const input = await FileBlob.load(path.join(root, "report/mercado_livre_analysis.xlsx"));
const workbook = await SpreadsheetFile.importXlsx(input);
const previews = path.join(root, "report/.verification");
await fs.mkdir(previews, { recursive: true });
const ranges = {
  "Resumo executivo": "A1:L16",
  "Desempenho mensal": "A1:T38",
  "Cancelamentos e devoluções": "A1:V52",
  "Desempenho por produto": "A1:N25",
  "Curvas ABC": "A1:F35",
  "Oportunidades": "A1:J25",
  "Platinum": "A1:H16",
  "Cenários": "A1:J10",
  "Qualidade": "A1:H16",
};
for (const [sheetName, range] of Object.entries(ranges)) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(previews, `${sheetName.replaceAll(" ", "_")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const cancellationCheck = await workbook.inspect({ kind: "table", range: "'Cancelamentos e devoluções'!A4:I16", include: "values,formulas", tableMaxRows: 16, tableMaxCols: 9, maxChars: 5000 });
console.log(cancellationCheck.ndjson || "cancelamentos range ok");
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log(errors.ndjson || "no formula errors");
