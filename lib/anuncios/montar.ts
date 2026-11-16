// Funções puras: da ficha do SKU ao anúncio pronto para o POST /items do Mercado Livre.
// Regra do Samuel: código OEM, similares, medidas e anos nunca são inventados.

import type { Formato, Molde } from "./molde"

export type Aplicacao = { marca: string; modelo: string; anoInicio: number; anoFim?: number | null }

export type Ficha = {
  sku: string
  oem: string
  aplicacoes: Aplicacao[]
  comprimentoAbertoCm?: number | null
  comprimentoFechadoCm?: number | null
  forcaKgf?: number | null
  embalagem?: { larguraCm?: number | null; alturaCm?: number | null; comprimentoCm?: number | null; pesoKg?: number | null } | null
  similares?: { cofap?: string | null; nakata?: string | null } | null
  fotos?: { carro?: string | null; carroPar?: string | null; medidas?: string | null; aplicacao?: string | null } | null
}

export type ChecagemFicha = { travas: string[]; perguntas: string[] }

const positivo = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n > 0
const url = (s: string | null | undefined) => typeof s === "string" && /^https?:\/\/\S+$/.test(s.trim())

// Travas impedem gerar o rascunho; perguntas são o que o Claude pede à pessoa antes de seguir.
export function checarFicha(f: Ficha, anoAtual = new Date().getFullYear()): ChecagemFicha {
  const travas: string[] = []
  const perguntas: string[] = []
  if (!f.sku?.trim()) travas.push("SKU")
  if (!f.oem?.trim()) travas.push("código OEM original")
  if (!f.aplicacoes?.length) travas.push("aplicação (marca, modelo e ano inicial)")
  for (const [i, a] of (f.aplicacoes ?? []).entries()) {
    const n = f.aplicacoes.length > 1 ? ` ${i + 1}` : ""
    if (!a.marca?.trim() || !a.modelo?.trim()) travas.push(`marca e modelo da aplicação${n}`)
    if (!Number.isInteger(a.anoInicio) || a.anoInicio < 1980 || a.anoInicio > anoAtual + 1) travas.push(`ano inicial da aplicação${n}`)
    if (a.anoFim != null && (!Number.isInteger(a.anoFim) || a.anoFim < a.anoInicio)) travas.push(`ano final da aplicação${n}`)
  }
  if (!positivo(f.comprimentoAbertoCm)) perguntas.push("comprimento aberto (cm)")
  if (!positivo(f.comprimentoFechadoCm)) perguntas.push("comprimento fechado (cm)")
  if (positivo(f.comprimentoAbertoCm) && positivo(f.comprimentoFechadoCm) && f.comprimentoFechadoCm! >= f.comprimentoAbertoCm!) {
    perguntas.push("o comprimento fechado ficou maior que o aberto; confirme as duas medidas")
  }
  const e = f.embalagem ?? {}
  if (!positivo(e.larguraCm) || !positivo(e.alturaCm) || !positivo(e.comprimentoCm)) perguntas.push("embalagem da unidade: largura × altura × profundidade (cm)")
  if (!positivo(e.pesoKg)) perguntas.push("peso da embalagem da unidade (kg)")
  const fotos = f.fotos ?? {}
  if (!url(fotos.carro)) travas.push("foto do carro com 1 amortecedor (link)")
  if (!url(fotos.carroPar)) travas.push("foto do carro com o par (link)")
  if (!url(fotos.medidas)) travas.push("foto das medidas (link)")
  if (!url(fotos.aplicacao)) travas.push('card "Se liga na aplicação" (link)')
  return { travas, perguntas }
}

const capitalizar = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")

// "Peugeot 206 207" quando todas as aplicações são da mesma marca; senão "Peugeot 206 Citroen C3".
export function veiculosTexto(aplicacoes: Aplicacao[], modelos = aplicacoes.length): string {
  const usadas = aplicacoes.slice(0, modelos)
  const marcas = new Set(usadas.map((a) => a.marca.trim().toLowerCase()))
  if (marcas.size === 1) return capitalizar([usadas[0].marca, ...usadas.map((a) => a.modelo)].join(" "))
  return usadas.map((a) => capitalizar(`${a.marca} ${a.modelo}`)).join(" ")
}

export const TITULO_MAX = 60

// O OEM sempre vai no título. Encurta o prefixo, depois tira modelos do fim; se ainda não couber, null.
export function montarTitulo(molde: Molde, formato: Formato, ficha: Ficha): string | null {
  const oem = ficha.oem.trim()
  for (let modelos = ficha.aplicacoes.length; modelos >= 1; modelos--) {
    for (const prefixo of molde.formatos[formato].tituloPrefixos) {
      const t = `${prefixo} ${veiculosTexto(ficha.aplicacoes, modelos)} ${oem}`.replace(/\s+/g, " ").trim()
      if (t.length <= TITULO_MAX) return t
    }
  }
  return null
}

const anos = (a: Aplicacao) => (a.anoFim ? `${a.anoInicio} a ${a.anoFim}` : `${a.anoInicio} em diante`)

// Troca só o bloco de cima; a cauda é o texto padrão da loja.
export function montarDescricao(molde: Molde, formato: Formato, ficha: Ficha): string {
  const f = molde.formatos[formato]
  const oem = ficha.oem.trim()
  const veiculos = veiculosTexto(ficha.aplicacoes).toUpperCase()
  const similares = [
    ficha.similares?.cofap?.trim() ? `COFAP - ${ficha.similares.cofap.trim()}` : null,
    ficha.similares?.nakata?.trim() ? `NAKATA - ${ficha.similares.nakata.trim()}` : null,
    `${ficha.aplicacoes[0].marca.trim().toUpperCase()} - ${oem}`,
  ].filter(Boolean)
  return [
    `${f.descricaoPrefixo} ${veiculos} ${oem}`,
    "",
    "APLICAÇÕES",
    ...ficha.aplicacoes.map((a) => `- ${capitalizar(`${a.marca} ${a.modelo}`).toUpperCase()} ${anos(a)}`),
    "",
    "SIMILARES:",
    ...similares,
    "",
    `***${f.descricaoPrefixo.replace("PORTA MALA TRASEIRA", "PORTA MALA TAMPA TRASEIRA")}***`,
    "",
    molde.caudaDescricao,
  ].join("\n")
}

export type Embalagem = { larguraCm: number; alturaCm: number; comprimentoCm: number; pesoKg: number }

// Par: dobra largura e peso; altura e profundidade não mudam (SW0856: 5×2×36, 0,172 → 10×2×36, 0,344).
export function embalagemDoFormato(formato: Formato, ficha: Ficha): Embalagem {
  const e = ficha.embalagem ?? {}
  const base = { larguraCm: e.larguraCm ?? 0, alturaCm: e.alturaCm ?? 0, comprimentoCm: e.comprimentoCm ?? 0, pesoKg: e.pesoKg ?? 0 }
  if (formato === "unidade") return base
  return { ...base, larguraCm: base.larguraCm * 2, pesoKg: Math.round(base.pesoKg * 2 * 1000) / 1000 }
}

export function fotosDoFormato(molde: Molde, formato: Formato, ficha: Ficha): string[] {
  const f = ficha.fotos ?? {}
  const carro = formato === "par" ? f.carroPar : f.carro
  return molde.formatos[formato].fotos
    .map((slot) => ("fixa" in slot ? slot.fixa : slot.tipo === "carro" ? carro : slot.tipo === "medidas" ? f.medidas : f.aplicacao))
    .filter((u): u is string => typeof u === "string" && u.length > 0)
}

export type DadosOlist = { sku: string; gtin: string | null; estoque: number }

export type ItemMl = {
  family_name: string
  category_id: string
  price: number
  currency_id: "BRL"
  available_quantity: number
  buying_mode: "buy_it_now"
  condition: "new"
  listing_type_id: string
  sale_terms: Array<{ id: string; value_name: string }>
  shipping: { mode: "me2"; free_shipping: boolean; local_pick_up: boolean }
  pictures: Array<{ source: string }>
  attributes: Array<{ id: string; value_name: string }>
}

const cm = (n: number) => `${Math.round(n * 10) / 10} cm`

export function montarItem(molde: Molde, formato: Formato, ficha: Ficha, olist: DadosOlist, titulo: string): ItemMl {
  const f = molde.formatos[formato]
  const emb = embalagemDoFormato(formato, ficha)
  const oem = ficha.oem.trim()
  const modelo = `${molde.modeloPrefixo} ${veiculosTexto(ficha.aplicacoes)}`
  const partNumber = [oem, ficha.similares?.cofap?.trim()].filter(Boolean).join(" ")
  const attrs: Array<[string, string | null | undefined]> = [
    ["BRAND", molde.marcaPeca],
    ["MODEL", modelo],
    ["OEM", oem],
    ["PART_NUMBER", partNumber],
    ["AUTOMOTIVE_PLACEMENT_TYPE", molde.posicaoAutomotiva],
    ["EXTENDED_LENGTH", ficha.comprimentoAbertoCm ? cm(ficha.comprimentoAbertoCm) : null],
    ["COMPRESSED_LENGTH", ficha.comprimentoFechadoCm ? cm(ficha.comprimentoFechadoCm) : null],
    ["ITEM_CONDITION", "Novo"],
    ["ORIGIN", "Brasil"],
    ["SALE_FORMAT", f.saleFormat],
    ["UNITS_PER_PACK", String(f.unidadesPorPack)],
    ["VEHICLE_TYPE", "Carro/Caminhonete"],
    ["SELLER_SKU", olist.sku],
    ["SELLER_PACKAGE_LENGTH", cm(emb.comprimentoCm)],
    ["SELLER_PACKAGE_WIDTH", cm(emb.larguraCm)],
    ["SELLER_PACKAGE_HEIGHT", cm(emb.alturaCm)],
    ["SELLER_PACKAGE_WEIGHT", `${Math.round(emb.pesoKg * 1000)} g`],
    f.gtin === "olist" && olist.gtin
      ? ["GTIN", olist.gtin]
      : ["EMPTY_GTIN_REASON", f.unidadesPorPack > 1 ? "O produto é um kit ou pack" : "O produto não tem código cadastrado"],
  ]
  return {
    family_name: titulo,
    category_id: molde.categoriaId,
    price: f.preco,
    currency_id: "BRL",
    available_quantity: Math.max(0, Math.floor(olist.estoque)),
    buying_mode: "buy_it_now",
    condition: "new",
    listing_type_id: molde.tipoAnuncio,
    sale_terms: [
      { id: "WARRANTY_TYPE", value_name: "Garantia do vendedor" },
      { id: "WARRANTY_TIME", value_name: "30 dias" },
    ],
    shipping: { mode: "me2", free_shipping: true, local_pick_up: false },
    pictures: fotosDoFormato(molde, formato, ficha).map((source) => ({ source })),
    attributes: attrs.filter((a): a is [string, string] => typeof a[1] === "string" && a[1].length > 0).map(([id, value_name]) => ({ id, value_name })),
  }
}

export type FamiliaVeiculo = { marca: string; modelo: string; ano: number }

// Um ano por família de veículos (BRAND + MODEL + VEHICLE_YEAR); sem ano final, vai até o ano que vem.
export function familiasDeVeiculo(aplicacoes: Aplicacao[], anoAtual = new Date().getFullYear()): FamiliaVeiculo[] {
  const out: FamiliaVeiculo[] = []
  for (const a of aplicacoes) {
    const fim = a.anoFim ?? anoAtual + 1
    for (let ano = a.anoInicio; ano <= fim; ano++) out.push({ marca: a.marca.trim(), modelo: a.modelo.trim(), ano })
  }
  return out
}

// Agrupa famílias em chamadas de até 10 famílias e 200 veículos (limites do ML).
export function lotesDeCompatibilidade<T extends { veiculos: number }>(familias: T[], maxFamilias = 10, maxVeiculos = 200): T[][] {
  const lotes: T[][] = []
  let atual: T[] = []
  let soma = 0
  for (const fam of familias) {
    if (fam.veiculos === 0) continue
    if (atual.length && (atual.length >= maxFamilias || soma + fam.veiculos > maxVeiculos)) {
      lotes.push(atual)
      atual = []
      soma = 0
    }
    atual.push(fam)
    soma += fam.veiculos
  }
  if (atual.length) lotes.push(atual)
  return lotes
}
