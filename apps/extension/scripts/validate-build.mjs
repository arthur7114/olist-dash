import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const dist = new URL("../dist/", import.meta.url)
const manifest = JSON.parse(await readFile(new URL("manifest.json", dist), "utf8"))

if (manifest.manifest_version !== 3) throw new Error("O pacote deve usar Manifest V3.")
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage"])) {
  throw new Error(`Permissões inesperadas: ${JSON.stringify(manifest.permissions)}`)
}

const files = await walk(dist)
if (files.some((file) => file.endsWith(".map"))) throw new Error("Source map público encontrado no pacote.")
for (const file of files.filter((name) => /\.(?:js|json|html|css)$/.test(name))) {
  const content = await readFile(new URL(file, dist), "utf8")
  if (/EXTENSION_API_KEY\s*=|Bearer\s+[A-Za-z0-9_-]{20,}/.test(content)) {
    throw new Error(`Possível segredo encontrado em ${file}.`)
  }
}

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...await walk(new URL(`${entry.name}/`, directory), relative))
    else result.push(relative)
  }
  return result
}
