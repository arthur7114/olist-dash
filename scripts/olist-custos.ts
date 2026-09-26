#!/usr/bin/env -S pnpm tsx --env-file=.env.local
// Custo no cadastro da Olist: todo produto ativo precisa ter precoCusto preenchido.
//
//   kits        grava no kit a soma dos componentes (vazio ou desatualizado)
//   exportar    gera a planilha dos produtos simples sem custo, para compras preencher
//   importar    lê a planilha preenchida e grava o custo na Olist
//
//   pnpm tsx --env-file=.env.local scripts/olist-custos.ts kits --dry-run
//   pnpm tsx --env-file=.env.local scripts/olist-custos.ts kits [--skus 34572G/34573G]
//   pnpm tsx --env-file=.env.local scripts/olist-custos.ts exportar report/custos-a-preencher.xlsx
//   pnpm tsx --env-file=.env.local scripts/olist-custos.ts importar planilha.xlsx --dry-run
//   pnpm tsx --env-file=.env.local scripts/olist-custos.ts importar planilha.xlsx [--sobrescrever]

import fs from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { and, eq, isNotNull } from "drizzle-orm"
import { getDb } from "@/lib/db/client"
import { mlItems } from "@/lib/db/schema"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { fetchProductFull, refreshAccessToken, tinyFetch, updateProductFull, type TinyProductFull } from "@/lib/olist-v3"
import { buildPutBody } from "@/lib/olist-catalog-fill"
import { kitCostFromComponents, kitNeedsUpdate, parseCustoPlanilha } from "@/lib/olist-custos"

type Args = { cmd: string; file?: string; dryRun: boolean; sobrescrever: boolean; skus: Set<string> | null }

function parseArgs(argv: string[]): Args {
  const [cmd, ...rest] = argv
  const args: Args = { cmd: cmd ?? "", dryRun: false, sobrescrever: false, skus: null }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === "--dry-run") args.dryRun = true
    else if (a === "--sobrescrever") args.sobrescrever = true
    else if (a === "--skus") args.skus = new Set(String(rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    else if (!a.startsWith("--") && !args.file) args.file = a
    else throw new Error(`Argumento desconhecido: ${a}`)
  }
  if (!["kits", "exportar", "importar"].includes(args.cmd)) throw new Error("Use: kits | exportar <arquivo.xlsx> | importar <arquivo.xlsx>")
  if (args.cmd !== "kits" && !args.file) throw new Error(`${args.cmd} precisa do caminho do arquivo .xlsx`)
  return args
}

type Produto = TinyProductFull & { kit?: Array<{ produto?: { id?: number; sku?: string }; quantidade?: number }> | null }
type ListItem = { id: number; sku?: string; descricao?: string; tipo?: string; situacao?: string; precos?: Produto["precos"] }

const custoProprio = (p: { precos?: Produto["precos"] } | undefined) =>
  Math.max(Number(p?.precos?.precoCustoMedio) || 0, Number(p?.precos?.precoCusto) || 0)

async function getAccessToken(): Promise<string> {
  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  return refreshed.access_token
}

async function listAllProducts(at: string): Promise<ListItem[]> {
  const all: ListItem[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await tinyFetch<{ itens?: ListItem[]; paginacao?: { total?: number } }>(at, `/produtos?limit=100&offset=${offset}`)
    all.push(...(page.itens ?? []))
    if (!page.itens?.length || all.length >= (page.paginacao?.total ?? all.length)) break
  }
  return all
}

// Custo de um produto simples: cadastro e, se vazio, o último registro do histórico.
function makeCostReader(at: string) {
  const memo = new Map<number, Promise<{ produto: Produto; custo: number }>>()
  return (id: number) => {
    let hit = memo.get(id)
    if (!hit) {
      hit = (async () => {
        const produto = (await fetchProductFull(at, id)) as Produto
        let custo = custoProprio(produto)
        if (!(custo > 0)) {
          const h = await tinyFetch<{ itens?: Array<{ custoMedio?: number; precoCusto?: number }> }>(at, `/produtos/${id}/custos?limit=1`)
          custo = Math.max(Number(h.itens?.[0]?.custoMedio) || 0, Number(h.itens?.[0]?.precoCusto) || 0)
        }
        return { produto, custo }
      })()
      memo.set(id, hit)
    }
    return hit
  }
}

// PUT com o cadastro inteiro (o endpoint exige) trocando só o precoCusto; depois relê e
// confere que o custo entrou e que nada estrutural (SKU, componentes do kit) mudou.
async function gravarCusto(at: string, produto: Produto, custo: number): Promise<void> {
  const id = produto.id!
  const body = buildPutBody(produto, {})
  body.precos = { ...((body.precos as Record<string, unknown>) ?? {}), precoCusto: custo }
  await updateProductFull(at, id, body)
  const depois = (await fetchProductFull(at, id)) as Produto
  const problemas: string[] = []
  if (Math.abs((Number(depois.precos?.precoCusto) || 0) - custo) > 0.005) problemas.push(`precoCusto ficou ${depois.precos?.precoCusto}`)
  if (depois.sku !== produto.sku) problemas.push(`SKU mudou para ${depois.sku}`)
  if ((depois.kit?.length ?? 0) !== (produto.kit?.length ?? 0)) problemas.push(`kit tinha ${produto.kit?.length ?? 0} componentes, ficou ${depois.kit?.length ?? 0}`)
  if (problemas.length) throw new Error(`Conferência falhou no produto ${id}: ${problemas.join("; ")}`)
}

type Linha = Record<string, string | number>

async function writeReport(nome: string, linhas: Linha[]): Promise<string> {
  const outDir = path.join(process.cwd(), "report")
  await fs.mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  const outPath = path.join(outDir, `${nome}-${stamp}.csv`)
  const header = Object.keys(linhas[0] ?? { vazio: "" })
  const esc = (v: unknown) => {
    const s = String(v ?? "")
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  await fs.writeFile(outPath, [header.join(","), ...linhas.map((l) => header.map((h) => esc(l[h])).join(","))].join("\n") + "\n", "utf8")
  return path.relative(process.cwd(), outPath)
}

async function cmdKits(args: Args) {
  const at = await getAccessToken()
  const custoDe = makeCostReader(at)
  const kits = (await listAllProducts(at)).filter(
    (p) => p.tipo === "K" && p.situacao === "A" && (!args.skus || args.skus.has(String(p.sku ?? ""))),
  )
  const linhas: Linha[] = []
  for (const item of kits) {
    const kit = (await fetchProductFull(at, item.id)) as Produto
    const partes = []
    const faltando: string[] = []
    for (const c of kit.kit ?? []) {
      const r = c.produto?.id ? await custoDe(c.produto.id) : { custo: 0, produto: {} as Produto }
      if (!(r.custo > 0)) faltando.push(c.produto?.sku ?? String(c.produto?.id))
      partes.push({ custo: r.custo, quantidade: Number(c.quantidade) || 0 })
    }
    const soma = kitCostFromComponents(partes)
    const antes = Number(kit.precos?.precoCusto) || 0
    const base = { id: item.id, sku: kit.sku ?? "", descricao: kit.descricao ?? "", custo_antes: antes, soma }
    if (!(soma > 0)) linhas.push({ ...base, resultado: "sem_soma", motivo: `componente sem custo: ${faltando.join(", ")}` })
    else if (!kitNeedsUpdate(antes, soma)) linhas.push({ ...base, resultado: "ja_certo", motivo: "" })
    else if (args.dryRun) linhas.push({ ...base, resultado: "dry_run", motivo: "" })
    else if (!kit.sku?.trim()) linhas.push({ ...base, resultado: "erro", motivo: "kit sem SKU: a Olist recusa o PUT" })
    else {
      try {
        await gravarCusto(at, kit, soma)
        linhas.push({ ...base, resultado: "gravado", motivo: "" })
      } catch (error) {
        linhas.push({ ...base, resultado: "erro", motivo: error instanceof Error ? error.message.slice(0, 200) : String(error) })
      }
    }
    const l = linhas[linhas.length - 1]
    if (l.resultado !== "ja_certo") console.log(`${l.resultado.toString().padEnd(9)} ${String(l.sku).padEnd(28)} ${antes} -> ${soma} ${l.motivo}`)
  }
  resumo(linhas)
  console.log(`CSV: ${await writeReport(`olist-custo-kits${args.dryRun ? "-dry-run" : ""}`, linhas)}`)
}

const COLS = [
  { header: "SKU", key: "sku", width: 18 },
  { header: "Descrição (Olist)", key: "descricao", width: 60 },
  { header: "Fornecedor", key: "fornecedor", width: 32 },
  { header: "Código no fornecedor", key: "codFornecedor", width: 18 },
  { header: "Estoque Olist", key: "estoque", width: 10 },
  { header: "Preço de venda Olist (R$)", key: "precoVenda", width: 14 },
  { header: "Anúncios ativos ML", key: "anunciosMl", width: 11 },
  { header: "Maior preço ML (R$)", key: "precoMl", width: 14 },
  { header: "Destrava o kit", key: "kits", width: 22 },
  { header: "Custo unitário (R$)", key: "custo", width: 14 },
  { header: "Observação", key: "obs", width: 30 },
  { header: "ID Olist", key: "id", width: 12 },
] as const

async function cmdExportar(args: Args) {
  const at = await getAccessToken()
  const custoDe = makeCostReader(at)
  const ativos = (await listAllProducts(at)).filter((p) => p.situacao === "A")

  // Kits que só não fecham por causa de um componente: vale mostrar ao lado do componente.
  const destrava = new Map<number, string[]>()
  for (const k of ativos.filter((p) => p.tipo === "K" && !(custoProprio(p) > 0))) {
    const kit = (await fetchProductFull(at, k.id)) as Produto
    for (const c of kit.kit ?? []) {
      if (c.produto?.id && !((await custoDe(c.produto.id)).custo > 0)) {
        destrava.set(c.produto.id, [...(destrava.get(c.produto.id) ?? []), kit.sku ?? String(kit.id)])
      }
    }
  }

  const db = getDb()
  const ml = new Map<string, { n: number; preco: number }>()
  const itens = await db
    .select({ sku: mlItems.sellerSku, preco: mlItems.currentPrice })
    .from(mlItems)
    .where(and(eq(mlItems.status, "active"), isNotNull(mlItems.sellerSku)))
  for (const i of itens) {
    const sku = String(i.sku).trim()
    const cur = ml.get(sku) ?? { n: 0, preco: 0 }
    ml.set(sku, { n: cur.n + 1, preco: Math.max(cur.preco, Number(i.preco) || 0) })
  }

  const linhas = []
  for (const p of ativos.filter((p) => p.tipo === "S" && !(custoProprio(p) > 0))) {
    const { produto, custo } = await custoDe(p.id)
    if (custo > 0) continue // o histórico tinha custo: o sync já enxerga, não é caso de compras
    const f = produto.fornecedores?.[0]
    const m = ml.get(String(produto.sku ?? "").trim())
    linhas.push({
      sku: produto.sku ?? "",
      descricao: produto.descricao ?? "",
      fornecedor: f?.nome ?? "",
      codFornecedor: f?.codigoProdutoNoFornecedor ?? "",
      estoque: Number(produto.estoque?.quantidade) || 0,
      precoVenda: Number(produto.precos?.preco) || null,
      anunciosMl: m?.n ?? 0,
      precoMl: m?.preco || null,
      kits: (destrava.get(p.id) ?? []).join(", "),
      custo: null,
      obs: "",
      id: p.id,
    })
  }
  linhas.sort((a, b) => b.anunciosMl - a.anunciosMl || (b.precoMl ?? 0) - (a.precoMl ?? 0) || a.sku.localeCompare(b.sku))

  const wb = new ExcelJS.Workbook()
  const font = { name: "Arial", size: 10 }
  const amarelo = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } } as const
  const cinza = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } } as const

  const ws = wb.addWorksheet("Custos", { views: [{ state: "frozen", ySplit: 1 }] })
  ws.columns = COLS.map((c) => ({ ...c }))
  ws.addRows(linhas)
  ws.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + COLS.length)}1` }
  ws.eachRow((row, n) => {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = COLS[col - 1]?.key
      cell.font = { ...font, bold: n === 1 }
      if (n === 1) {
        cell.fill = key === "custo" || key === "obs" ? amarelo : cinza
        cell.alignment = { wrapText: true, vertical: "middle" }
      } else if (key === "custo" || key === "obs") cell.fill = amarelo
      if (["precoVenda", "precoMl", "custo"].includes(key)) cell.numFmt = '"R$" #,##0.00;-"R$" #,##0.00;"-"'
    })
  })
  ws.getRow(1).height = 30

  const leg = wb.addWorksheet("Como preencher")
  leg.columns = [{ width: 26 }, { width: 90 }]
  const texto: Array<[string, string]> = [
    ["O que é", `Produtos ativos na Olist sem custo no cadastro nem no histórico (${linhas.length} em ${new Date().toISOString().slice(0, 10)}). Sem custo, o produto fica fora de precificação e de promoção.`],
    ["O que preencher", "Só as colunas amarelas da aba Custos: \"Custo unitário (R$)\" e, se quiser, \"Observação\". Não mexa nas outras colunas nem apague a coluna ID Olist: é ela que liga a linha ao cadastro."],
    ["Qual custo", "O custo de compra por unidade, como na nota de entrada do fornecedor (o mesmo número que iria no campo Preço de custo da Olist)."],
    ["Formato", "Número em reais, com vírgula ou ponto: 123,45 ou 123.45. Pode deixar em branco o que não souber; linha vazia é ignorada."],
    ["Exemplo", "SKU 5104 · Custo unitário (R$) = 412,90 · Observação = NF 18233 Autoflex, ago/2026"],
    ["Destrava o kit", "Quando preenchida, o kit listado passa a ter custo sozinho (o custo do kit é a soma dos componentes)."],
    ["Depois", "Devolva a planilha. Ela é lida por scripts/olist-custos.ts importar, que grava o custo na Olist só onde o cadastro ainda está vazio."],
  ]
  for (const [a, b] of texto) {
    const row = leg.addRow([a, b])
    row.getCell(1).font = { ...font, bold: true }
    row.getCell(2).font = font
    row.getCell(2).alignment = { wrapText: true, vertical: "top" }
    row.getCell(1).alignment = { vertical: "top" }
  }

  await fs.mkdir(path.dirname(path.resolve(args.file!)), { recursive: true })
  await wb.xlsx.writeFile(args.file!)
  console.log(`${linhas.length} produtos sem custo → ${args.file}`)
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object") {
    if ("result" in v) return v.result
    if ("richText" in v) return v.richText.map((t) => t.text).join("")
    if ("text" in v) return v.text
  }
  return v
}

async function cmdImportar(args: Args) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(args.file!)
  const ws = wb.getWorksheet("Custos")
  if (!ws) throw new Error('A planilha não tem a aba "Custos".')
  const header = new Map<string, number>()
  ws.getRow(1).eachCell((cell, col) => header.set(String(cellValue(cell.value) ?? "").trim(), col))
  const col = (h: string) => {
    const c = header.get(h)
    if (!c) throw new Error(`Coluna "${h}" não encontrada na aba Custos.`)
    return c
  }
  const [cId, cSku, cCusto] = [col("ID Olist"), col("SKU"), col("Custo unitário (R$)")]

  const pedidos: Array<{ linha: number; id: number; sku: string; custo: number }> = []
  const linhas: Linha[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const id = Number(cellValue(row.getCell(cId).value))
    const sku = String(cellValue(row.getCell(cSku).value) ?? "").trim()
    const parsed = parseCustoPlanilha(cellValue(row.getCell(cCusto).value))
    if (parsed.ok === "vazio") return
    if (parsed.ok === false || !Number.isInteger(id)) {
      linhas.push({ linha: n, id: id || "", sku, custo: "", resultado: "erro", motivo: parsed.ok === false ? parsed.motivo : "ID Olist inválido" })
      return
    }
    pedidos.push({ linha: n, id, sku, custo: parsed.custo })
  })
  for (const l of linhas) console.log(`${"erro".padEnd(12)} linha ${l.linha} ${l.sku} ${l.motivo}`)
  if (!pedidos.length && !linhas.length) {
    console.log("Nenhuma linha com custo preenchido.")
    return
  }

  const at = await getAccessToken()
  for (const p of pedidos) {
    const base = { linha: p.linha, id: p.id, sku: p.sku, custo: p.custo }
    try {
      const produto = (await fetchProductFull(at, p.id)) as Produto
      const atual = custoProprio(produto)
      if (String(produto.sku ?? "").trim() !== p.sku) linhas.push({ ...base, resultado: "erro", motivo: `SKU na Olist é ${produto.sku}` })
      else if (atual > 0 && !args.sobrescrever) linhas.push({ ...base, resultado: "ja_tem_custo", motivo: `Olist já tem ${atual}` })
      else if (args.dryRun) linhas.push({ ...base, resultado: "dry_run", motivo: atual > 0 ? `sobrescreveria ${atual}` : "" })
      else {
        await gravarCusto(at, produto, p.custo)
        linhas.push({ ...base, resultado: "gravado", motivo: atual > 0 ? `era ${atual}` : "" })
      }
    } catch (error) {
      linhas.push({ ...base, resultado: "erro", motivo: error instanceof Error ? error.message.slice(0, 200) : String(error) })
    }
    const l = linhas[linhas.length - 1]
    console.log(`${String(l.resultado).padEnd(12)} ${p.sku.padEnd(20)} ${p.custo} ${l.motivo}`)
  }
  resumo(linhas)
  console.log(`CSV: ${await writeReport(`olist-custo-planilha${args.dryRun ? "-dry-run" : ""}`, linhas)}`)
}

function resumo(linhas: Linha[]) {
  const c: Record<string, number> = {}
  for (const l of linhas) c[String(l.resultado)] = (c[String(l.resultado)] ?? 0) + 1
  console.log("\nResumo:", c)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.cmd === "kits") await cmdKits(args)
  else if (args.cmd === "exportar") await cmdExportar(args)
  else await cmdImportar(args)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
