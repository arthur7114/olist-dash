// Regras puras do preenchimento do catálogo Olist a partir do ML.
// Spec: docs/superpowers/specs/2026-09-19-olist-catalogo-do-ml-design.md

import type { TinyDimensoes, TinyProductFull } from "@/lib/olist-v3"

// Medidas em cm e peso em kg, já convertidos.
export type MlCatalogDims = {
  comprimento?: number
  largura?: number
  altura?: number
  pesoBruto?: number
}

export type MlCatalog = {
  itemId: string
  soldQuantity: number
  description: string | null
  pictures: string[]
  dims: MlCatalogDims
}

// "1800 g" -> { value: 1800, unit: "g" }. Aceita vírgula decimal.
export function parseMeasure(raw: string | null | undefined): { value: number; unit: string } | undefined {
  if (!raw) return undefined
  const match = String(raw).trim().match(/^([\d.,]+)\s*([a-zA-Z]*)$/)
  if (!match) return undefined
  const value = Number(match[1].replace(",", "."))
  if (!Number.isFinite(value) || value <= 0) return undefined
  return { value, unit: match[2].toLowerCase() }
}

// Comprimento em cm. Sem unidade, assume cm.
export function toCm(raw: string | null | undefined): number | undefined {
  const parsed = parseMeasure(raw)
  if (!parsed) return undefined
  const factor = { "": 1, cm: 1, mm: 0.1, m: 100 }[parsed.unit]
  if (factor === undefined) return undefined
  return round(parsed.value * factor, 2)
}

// Peso em kg. Sem unidade, assume g (padrão do SELLER_PACKAGE_WEIGHT).
export function toKg(raw: string | null | undefined): number | undefined {
  const parsed = parseMeasure(raw)
  if (!parsed) return undefined
  const factor = { "": 0.001, g: 0.001, kg: 1, mg: 0.000001 }[parsed.unit]
  if (factor === undefined) return undefined
  return round(parsed.value * factor, 3)
}

function round(value: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(value * p) / p
}

export function dimsFromAttributes(
  attributes: Array<{ id?: string; value_name?: string | null }> | null | undefined,
): MlCatalogDims {
  const byId = new Map<string, string | null | undefined>()
  for (const attr of attributes ?? []) if (attr.id) byId.set(attr.id, attr.value_name)
  const dims: MlCatalogDims = {}
  const comprimento = toCm(byId.get("SELLER_PACKAGE_LENGTH"))
  const largura = toCm(byId.get("SELLER_PACKAGE_WIDTH"))
  const altura = toCm(byId.get("SELLER_PACKAGE_HEIGHT"))
  const pesoBruto = toKg(byId.get("SELLER_PACKAGE_WEIGHT"))
  if (comprimento) dims.comprimento = comprimento
  if (largura) dims.largura = largura
  if (altura) dims.altura = altura
  if (pesoBruto) dims.pesoBruto = pesoBruto
  return dims
}

// Completude: descrição, quatro medidas, ao menos uma foto (0 a 3).
export function completeness(catalog: MlCatalog): number {
  let score = 0
  if (catalog.description?.trim()) score += 1
  if (
    catalog.dims.comprimento &&
    catalog.dims.largura &&
    catalog.dims.altura &&
    catalog.dims.pesoBruto
  )
    score += 1
  if (catalog.pictures.length > 0) score += 1
  return score
}

// Entre anúncios do mesmo SKU: mais completo; depois mais vendido; depois menor id.
export function pickBestListing(catalogs: MlCatalog[]): MlCatalog | undefined {
  return [...catalogs].sort((a, b) => {
    const byScore = completeness(b) - completeness(a)
    if (byScore) return byScore
    const bySold = b.soldQuantity - a.soldQuantity
    if (bySold) return bySold
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0
  })[0]
}

export function descriptionToHtml(plain: string): string {
  return plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/\n/g, "<br>")
}

export type CatalogDelta = {
  descricaoComplementar?: string
  dimensoes?: Partial<Pick<TinyDimensoes, "largura" | "altura" | "comprimento" | "pesoBruto">>
  anexos?: string[]
}

export type SkipReason =
  | "olist_nao_encontrado"
  | "olist_inativo"
  | "olist_com_variacao"
  | "olist_sem_descricao"
  | "ml_com_variacao"

export function skipReasonFor(product: TinyProductFull): SkipReason | undefined {
  if (product.situacao && product.situacao !== "A") return "olist_inativo"
  if (product.tipo === "V") return "olist_com_variacao"
  if (product.tipoVariacao === "P" || product.tipoVariacao === "V") return "olist_com_variacao"
  if (Array.isArray(product.variacoes) && product.variacoes.length > 0) return "olist_com_variacao"
  if (!product.descricao?.trim()) return "olist_sem_descricao"
  return undefined
}

function isEmptyNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || !(Number(value) > 0)
}

export const MAX_PICTURES = 10

// Só preenche o que está vazio na Olist e existe no ML.
export function computeDelta(
  product: TinyProductFull,
  catalog: MlCatalog,
  anexosAtuais: Array<{ url?: string | null }> | null | undefined,
): CatalogDelta {
  const delta: CatalogDelta = {}

  if (!product.descricaoComplementar?.trim() && catalog.description?.trim()) {
    delta.descricaoComplementar = descriptionToHtml(catalog.description)
  }

  const dims: NonNullable<CatalogDelta["dimensoes"]> = {}
  const current = product.dimensoes ?? {}
  for (const key of ["largura", "altura", "comprimento", "pesoBruto"] as const) {
    const fromMl = catalog.dims[key]
    if (fromMl && isEmptyNumber(current[key])) dims[key] = fromMl
  }
  if (Object.keys(dims).length) delta.dimensoes = dims

  const hasAnexos = (anexosAtuais ?? []).some((a) => a.url?.trim())
  if (!hasAnexos && catalog.pictures.length) {
    delta.anexos = catalog.pictures.slice(0, MAX_PICTURES)
  }

  return delta
}

export function isDeltaEmpty(delta: CatalogDelta): boolean {
  return !delta.descricaoComplementar && !delta.dimensoes && !delta.anexos
}

const PUT_FIELDS = [
  "sku",
  "descricao",
  "descricaoComplementar",
  "unidade",
  "unidadePorCaixa",
  "ncm",
  "gtin",
  "origem",
  "codigoEspecificadorSubstituicaoTributaria",
  "garantia",
  "observacoes",
  "tributacao",
  "seo",
] as const

// Corpo do PUT: reenvia o que o GET devolveu (só campos que o PUT aceita) com o delta por cima.
// Marca/categoria/fornecedores viram { id } porque o PUT recebe só o id.
export function buildPutBody(product: TinyProductFull, delta: CatalogDelta): Record<string, unknown> {
  if (!product.descricao?.trim()) throw new Error("Produto sem descricao: PUT exige descricao.")

  const body: Record<string, unknown> = {}
  for (const key of PUT_FIELDS) {
    const value = product[key]
    if (value !== undefined && value !== null) body[key] = value
  }
  if (product.marca?.id) body.marca = { id: product.marca.id }
  if (product.categoria?.id) body.categoria = { id: product.categoria.id }
  // O GET não devolve `padrao`, mas o PUT exige boolean: o primeiro da lista vira padrão.
  if (product.fornecedores?.length) {
    body.fornecedores = product.fornecedores
      .filter((f) => f.id)
      .map((f, index) => ({
        id: f.id,
        codigoProdutoNoFornecedor: f.codigoProdutoNoFornecedor ?? "",
        padrao: typeof f.padrao === "boolean" ? f.padrao : index === 0,
      }))
  }
  // O GET devolve `origem` como string ("0"); o PUT espera inteiro.
  if (product.origem !== undefined && product.origem !== null && product.origem !== "") {
    body.origem = Number(product.origem)
  }
  if (product.precos) {
    const { preco, precoPromocional, precoCusto } = product.precos
    body.precos = stripNil({ preco, precoPromocional, precoCusto })
  }
  if (product.estoque) {
    const { controlar, sobEncomenda, minimo, maximo, diasPreparacao, localizacao } = product.estoque
    body.estoque = stripNil({ controlar, sobEncomenda, minimo, maximo, diasPreparacao, localizacao })
  }

  const dimensoes = stripNil({ ...(product.dimensoes ?? {}), ...(delta.dimensoes ?? {}) })
  delete (dimensoes as Record<string, unknown>).embalagem
  delete (dimensoes as Record<string, unknown>).quantidadeVolumes
  if (Object.keys(dimensoes).length) body.dimensoes = dimensoes

  if (delta.descricaoComplementar) body.descricaoComplementar = delta.descricaoComplementar
  return body
}

function stripNil<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  return out
}
