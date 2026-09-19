#!/usr/bin/env -S pnpm tsx --env-file=.env.local
// Preenche descrição, fotos e medidas/peso dos produtos da Olist a partir dos
// anúncios ativos do Mercado Livre, casando por SKU. Só preenche o que está
// vazio na Olist. Spec: docs/superpowers/specs/2026-09-19-olist-catalogo-do-ml-design.md
//
//   pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts --dry-run --skus 6021,52154367
//   pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts --dry-run
//   pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts [--limit N]

import fs from "node:fs/promises"
import path from "node:path"
import { and, eq, isNotNull } from "drizzle-orm"
import { getDb } from "@/lib/db/client"
import { mlItems } from "@/lib/db/schema"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { getMlAccessToken } from "@/lib/ml-api"
import { fetchMlItemCatalog } from "@/lib/ml-catalog"
import {
  addProductAnexos,
  fetchProductAnexos,
  fetchProductFull,
  fetchProductIdBySku,
  refreshAccessToken,
  TinyApiError,
  updateProductFull,
} from "@/lib/olist-v3"
import {
  buildPutBody,
  computeDelta,
  isDeltaEmpty,
  pickBestListing,
  skipReasonFor,
  type CatalogDelta,
  type MlCatalog,
} from "@/lib/olist-catalog-fill"

type Args = { dryRun: boolean; skus: Set<string> | null; limit: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, skus: null, limit: Infinity }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--dry-run") args.dryRun = true
    else if (a === "--skus") args.skus = new Set(String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    else if (a.startsWith("--skus=")) args.skus = new Set(a.slice(7).split(",").map((s) => s.trim()).filter(Boolean))
    else if (a === "--limit") args.limit = Number(argv[++i])
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice(8))
    else throw new Error(`Argumento desconhecido: ${a}`)
  }
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = Infinity
  return args
}

type Action = "preenchido" | "ja_tinha" | "ml_sem_dado" | "dry_run" | "-" | `erro:${string}`

type Row = {
  sku: string
  itemId: string
  olistId: number | ""
  descricao: Action
  medidas: Action
  fotos: Action
  resultado: "ok" | "pulado" | "erro" | "nada_a_fazer" | "dry_run"
  motivo: string
}

const ML_CONCURRENCY = 4

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function getOlistToken(): Promise<string> {
  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const validFor = creds.accessExpiresAt ? creds.accessExpiresAt.getTime() - Date.now() : 0
  if (creds.accessToken && validFor > 60_000) return creds.accessToken
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  return refreshed.access_token
}

function errorLabel(error: unknown): `erro:${string}` {
  if (error instanceof TinyApiError) return `erro:${error.status}`
  const msg = error instanceof Error ? error.message : String(error)
  const status = msg.match(/retornou (\d{3})/)?.[1]
  return `erro:${status ?? msg.slice(0, 60).replace(/\s+/g, " ")}`
}

function describeDelta(delta: CatalogDelta, catalog: MlCatalog): Pick<Row, "descricao" | "medidas" | "fotos"> {
  const hasDims = Object.keys(catalog.dims).length > 0
  return {
    descricao: delta.descricaoComplementar ? "preenchido" : catalog.description ? "ja_tinha" : "ml_sem_dado",
    medidas: delta.dimensoes ? "preenchido" : hasDims ? "ja_tinha" : "ml_sem_dado",
    fotos: delta.anexos ? "preenchido" : catalog.pictures.length ? "ja_tinha" : "ml_sem_dado",
  }
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "")
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const db = getDb()

  // 1. Candidatos do ML (tabela já sincronizada).
  const rows = await db
    .select({ itemId: mlItems.itemId, sellerSku: mlItems.sellerSku })
    .from(mlItems)
    .where(and(eq(mlItems.status, "active"), isNotNull(mlItems.sellerSku)))

  const bySku = new Map<string, string[]>()
  for (const row of rows) {
    const sku = String(row.sellerSku ?? "").trim()
    if (!sku) continue
    if (args.skus && !args.skus.has(sku)) continue
    bySku.set(sku, [...(bySku.get(sku) ?? []), row.itemId])
  }
  if (args.skus) {
    for (const sku of args.skus) if (!bySku.has(sku)) console.warn(`[aviso] SKU ${sku} não tem anúncio ativo em ml_items`)
  }

  const skus = [...bySku.keys()].sort().slice(0, args.limit)
  console.log(`${skus.length} SKUs a processar (${rows.length} anúncios ativos, ${args.dryRun ? "DRY-RUN" : "GRAVANDO"})`)

  const mlToken = await getMlAccessToken()
  const olistToken = await getOlistToken()

  // 2. Detalhe no ML, escolhendo o melhor anúncio por SKU.
  const chosen = new Map<string, { catalog: MlCatalog; skippedVariation: boolean }>()
  const mlErrors = new Map<string, string>()
  await mapConcurrent(skus, ML_CONCURRENCY, async (sku) => {
    const itemIds = bySku.get(sku) ?? []
    const catalogs: MlCatalog[] = []
    let anyVariation = false
    for (const itemId of itemIds) {
      try {
        const { catalog, hasVariations } = await fetchMlItemCatalog(itemId, mlToken)
        if (hasVariations) {
          anyVariation = true
          continue
        }
        catalogs.push(catalog)
      } catch (error) {
        mlErrors.set(sku, errorLabel(error))
      }
    }
    const best = pickBestListing(catalogs)
    if (best) chosen.set(sku, { catalog: best, skippedVariation: false })
    else if (anyVariation) chosen.set(sku, { catalog: { itemId: itemIds[0], soldQuantity: 0, description: null, pictures: [], dims: {} }, skippedVariation: true })
  })

  // 3–6. Olist, sequencial.
  const report: Row[] = []
  const counts = { ok: 0, pulado: 0, erro: 0, nada_a_fazer: 0, dry_run: 0 }
  const log = (row: Row) => {
    report.push(row)
    counts[row.resultado]++
    console.log(
      `${row.sku.padEnd(14)} ${row.itemId.padEnd(14)} ${String(row.olistId).padEnd(10)} ` +
        `desc=${row.descricao} med=${row.medidas} fotos=${row.fotos} => ${row.resultado}${row.motivo ? ` (${row.motivo})` : ""}`,
    )
  }

  for (const sku of skus) {
    const pick = chosen.get(sku)
    const itemId = pick?.catalog.itemId ?? bySku.get(sku)?.[0] ?? ""
    const base: Row = { sku, itemId, olistId: "", descricao: "-", medidas: "-", fotos: "-", resultado: "pulado", motivo: "" }

    if (!pick) {
      log({ ...base, resultado: mlErrors.has(sku) ? "erro" : "pulado", motivo: mlErrors.get(sku) ?? "ml_sem_detalhe" })
      continue
    }
    if (pick.skippedVariation) {
      log({ ...base, motivo: "ml_com_variacao" })
      continue
    }
    const { catalog } = pick

    try {
      const olistId = await fetchProductIdBySku(olistToken, sku)
      if (!olistId) {
        log({ ...base, motivo: "olist_nao_encontrado" })
        continue
      }
      base.olistId = olistId

      const product = await fetchProductFull(olistToken, olistId)
      const skip = skipReasonFor(product)
      if (skip) {
        log({ ...base, motivo: skip })
        continue
      }

      // O detalhe costuma trazer `anexos`; quando não vem, consulta o endpoint próprio.
      const anexos = product.anexos ?? (await fetchProductAnexos(olistToken, olistId))
      const delta = computeDelta(product, catalog, anexos)
      const actions = describeDelta(delta, catalog)

      if (isDeltaEmpty(delta)) {
        log({ ...base, ...actions, resultado: "nada_a_fazer" })
        continue
      }
      if (args.dryRun) {
        log({ ...base, ...actions, resultado: "dry_run", motivo: summarizeDelta(delta) })
        continue
      }

      const motivos: string[] = []
      if (delta.descricaoComplementar || delta.dimensoes) {
        await updateProductFull(olistToken, olistId, buildPutBody(product, delta))
      }
      if (delta.anexos) {
        const payload = delta.anexos.map((url) => ({ url, externo: false }))
        try {
          await addProductAnexos(olistToken, olistId, payload)
          motivos.push("fotos hospedadas")
        } catch (error) {
          if (error instanceof TinyApiError && error.status >= 400 && error.status < 500) {
            await addProductAnexos(olistToken, olistId, payload.map((a) => ({ ...a, externo: true })))
            motivos.push(`fotos como link externo (hospedar deu ${error.status})`)
          } else throw error
        }
      }
      log({ ...base, ...actions, resultado: "ok", motivo: motivos.join("; ") })
    } catch (error) {
      log({ ...base, resultado: "erro", motivo: errorLabel(error) + (error instanceof Error ? ` ${error.message.slice(0, 160)}` : "") })
    }
  }

  // 7. Relatório.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
  const outDir = path.join(process.cwd(), "report")
  await fs.mkdir(outDir, { recursive: true })
  const outPath = path.join(outDir, `olist-catalogo-${stamp}${args.dryRun ? "-dry-run" : ""}.csv`)
  const header = ["sku", "item_id", "olist_id", "descricao", "medidas", "fotos", "resultado", "motivo"]
  const lines = [header.join(","), ...report.map((r) => [r.sku, r.itemId, r.olistId, r.descricao, r.medidas, r.fotos, r.resultado, r.motivo].map(csvEscape).join(","))]
  await fs.writeFile(outPath, lines.join("\n") + "\n", "utf8")

  console.log("\nResumo:", counts)
  console.log(`CSV: ${path.relative(process.cwd(), outPath)}`)
}

function summarizeDelta(delta: CatalogDelta): string {
  const parts: string[] = []
  if (delta.descricaoComplementar) parts.push(`descrição ${delta.descricaoComplementar.length} chars`)
  if (delta.dimensoes) parts.push(`dims ${JSON.stringify(delta.dimensoes)}`)
  if (delta.anexos) parts.push(`${delta.anexos.length} fotos`)
  return parts.join("; ")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
