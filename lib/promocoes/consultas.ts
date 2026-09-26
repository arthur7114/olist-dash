// Consultas ao banco do painel para promoções. SQL portado de oem-pricing/scripts
// (avaliar-promocao.mjs e lib.mjs), com parâmetros em vez de texto concatenado.

import { neon } from "@neondatabase/serverless"
import { REGRAS } from "./regras"
import {
  FAIXAS_DESCONTO,
  ROTULOS_PROMOCAO,
  faixaDesconto,
  type CustoSku,
  type FaixaHistorico,
  type HistoricoSku,
  type MedidoSku,
  type OfertaLinha,
} from "./margem"

type Row = Record<string, unknown>
let cached: ReturnType<typeof neon> | null = null
async function rows<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL não configurado.")
  cached ??= neon(url)
  return (await cached.query(text, params)) as T[]
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
const SEM_ACENTO_SQL = (col: string) =>
  `translate(${col}, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')`

// Filtro pelo nome que a pessoa usa ("9.9", "saldão", "cupom"): casa no nome da campanha
// ou no rótulo do tipo. Devolve o trecho SQL e empurra os parâmetros em `params`.
function filtroPorNome(termo: string, params: unknown[]): string | null {
  const t = termo.trim()
  if (!t) return null
  const alvo = semAcento(t).toLowerCase()
  const tipos = Object.entries(ROTULOS_PROMOCAO)
    .filter(([, r]) => semAcento(r).toLowerCase().includes(alvo))
    .map(([k]) => k)
  if (/^[A-Z_]+$/.test(t)) tipos.push(t)
  params.push(`%${semAcento(t)}%`)
  const partes = [`${SEM_ACENTO_SQL("p.name")} ilike $${params.length}`]
  if (tipos.length) {
    params.push(tipos)
    partes.push(`p.type = any($${params.length}::text[])`)
  }
  return `(${partes.join(" or ")})`
}

const SITUACOES_PADRAO = ["candidate", "pending"]

export type Campanha = { tipo: string; nome: string; situacao: string; anuncios: number; fim: string | null; descontoMedio: number | null }

export async function listarCampanhas(situacoes: string[] | null = SITUACOES_PADRAO): Promise<Campanha[]> {
  const params: unknown[] = []
  let filtro = ""
  if (situacoes) {
    params.push(situacoes)
    filtro = `and p.status = any($1::text[])`
  }
  const rs = await rows<{ type: string; nome: string; status: string; anuncios: number; fim: string | null; desconto_medio: number | null }>(
    `select p.type, coalesce(nullif(btrim(p.name), ''), '') nome, p.status, count(*)::int anuncios,
            max(p.ends_at)::date::text fim,
            round(avg(1 - p.candidate_price / nullif(p.original_price, 0))::numeric, 3)::float desconto_medio
     from ml_promotions p join ml_items i on i.item_id = p.item_id
     where i.status = 'active' and p.candidate_price is not null ${filtro}
     group by p.type, nome, p.status order by anuncios desc`,
    params,
  )
  return rs.map((r) => ({ tipo: r.type, nome: r.nome, situacao: r.status, anuncios: r.anuncios, fim: r.fim, descontoMedio: r.desconto_medio }))
}

export async function buscarOfertas(f: { nome?: string; sku?: string; itemId?: string; situacoes?: string[] | null }): Promise<OfertaLinha[]> {
  const params: unknown[] = []
  const where = ["i.status = 'active'", "p.candidate_price is not null"]
  const situacoes = f.situacoes === undefined ? SITUACOES_PADRAO : f.situacoes
  if (situacoes) {
    params.push(situacoes)
    where.push(`p.status = any($${params.length}::text[])`)
  }
  if (f.sku) {
    params.push(f.sku)
    where.push(`i.seller_sku = $${params.length}`)
  }
  if (f.itemId) {
    params.push(f.itemId)
    where.push(`p.item_id = $${params.length}`)
  }
  if (f.nome) {
    const filtro = filtroPorNome(f.nome, params)
    if (filtro) where.push(filtro)
  }
  const rs = await rows<Row>(
    `select p.item_id, i.seller_sku sku, i.title, i.listing_type_id lt, i.logistic_type log, i.current_price::float preco_atual,
            (i.raw->'item'->>'available_quantity')::int estoque,
            p.type, p.status, p.name, p.original_price::float original, p.candidate_price::float candidato,
            p.fee_reduction::float fee_red, p.ends_at::date::text fim,
            coalesce(v.un14, 0)::int un14
     from ml_promotions p join ml_items i on i.item_id = p.item_id
     left join lateral (
       select sum(case when o.data >= current_date - 14 then oi.quantidade else 0 end) un14, sum(oi.quantidade) un90
       from order_items oi join orders o on o.olist_id = oi.olist_id
       where oi.sku = i.seller_sku and o.canal ilike '%mercado%' and o.situacao <> 2 and o.data >= current_date - 90) v on true
     where ${where.join(" and ")}
     order by v.un90 desc nulls last, p.item_id`,
    params,
  )
  return rs.map((r) => ({
    itemId: String(r.item_id),
    sku: (r.sku as string | null) ?? null,
    titulo: String(r.title ?? ""),
    tipoAnuncio: (r.lt as string | null) ?? null,
    logistica: (r.log as string | null) ?? null,
    precoAtual: Number(r.preco_atual),
    precoPromo: Number(r.candidato),
    precoOriginal: r.original == null ? null : Number(r.original),
    reducaoTarifa: Number(r.fee_red ?? 0),
    estoque: r.estoque == null ? null : Number(r.estoque),
    vendas14d: Number(r.un14 ?? 0),
    tipo: String(r.type),
    nome: String(r.name ?? ""),
    situacao: String(r.status),
    fim: (r.fim as string | null) ?? null,
  }))
}

// Nomes parecidos sem preço proposto por anúncio (cupom, campanha sem candidato).
export async function promocoesSemPreco(nome: string): Promise<{ rotulo: string; anuncios: number }[]> {
  const params: unknown[] = []
  const filtro = filtroPorNome(nome, params)
  if (!filtro) return []
  const rs = await rows<{ type: string; nome: string; n: number }>(
    `select p.type, coalesce(nullif(btrim(p.name), ''), '') nome, count(*)::int n
     from ml_promotions p where ${filtro} group by 1, 2 order by n desc limit 5`,
    params,
  )
  return rs.map((r) => ({ rotulo: r.nome || ROTULOS_PROMOCAO[r.type] || r.type, anuncios: r.n }))
}

// Custo unitário: último custo nos pedidos (180 dias); se não houver, o cache product_costs.
export async function custosPorSku(skus: string[]): Promise<Record<string, CustoSku | null>> {
  if (!skus.length) return {}
  const rs = await rows<{ sku: string; custo: number | null; data: string | null }>(
    `with ult as (
       select distinct on (oi.sku) oi.sku, oi.custo_unitario::numeric custo, o.data
       from order_items oi join orders o on o.olist_id = oi.olist_id
       where oi.sku = any($1::text[]) and oi.custo_unitario > 0 and o.data >= current_date - 180
       order by oi.sku, o.data desc),
     cache as (
       select replace(ref, 'sku:', '') sku, custo::numeric custo, updated_at::date data
       from product_costs where ref = any($2::text[]) and custo > 0)
     select s.sku, coalesce(u.custo, c.custo)::float custo, coalesce(u.data::text, c.data::text) data
     from unnest($1::text[]) s(sku) left join ult u on u.sku = s.sku left join cache c on c.sku = s.sku`,
    [skus, skus.map((s) => `sku:${s}`)],
  )
  return Object.fromEntries(rs.map((r) => [r.sku, r.custo == null ? null : { custo: Number(r.custo), data: r.data }]))
}

// Tarifa % e frete R$ medidos por SKU (pedidos de 1 item, janela de 90 dias).
export async function medidosPorSku(skus: string[]): Promise<Record<string, MedidoSku>> {
  if (!skus.length) return {}
  const rs = await rows<{ sku: string; n: number; fee_pct: number; frete: number }>(
    `select oi.sku, count(*)::int n,
            percentile_cont(0.5) within group (order by (c.sale_fee / o.valor_venda)::float) fee_pct,
            avg(c.shipping_cost)::float frete
     from orders o join ml_order_costs c on c.olist_id = o.olist_id
     join order_items oi on oi.olist_id = o.olist_id
     where oi.sku = any($1::text[]) and o.situacao <> 2 and o.valor_venda > 0 and c.sale_fee > 0
       and o.data >= current_date - $2::int
       and (select count(*) from order_items x where x.olist_id = o.olist_id) = 1
     group by oi.sku`,
    [skus, REGRAS.medicao.janelaDias],
  )
  return Object.fromEntries(rs.map((r) => [r.sku, { pedidos: Number(r.n), tarifaPct: Number(r.fee_pct), frete: Number(r.frete) }]))
}

// Histórico de desconto por SKU, reconstruído das vendas do ML: preço de lista (gross_price)
// contra o preço pago, agrupado por faixa de desconto. Responde "desconto já funcionou aqui?".
export async function historicoDesconto(skus: string[], dias = 180): Promise<Record<string, HistoricoSku>> {
  if (!skus.length) return {}
  const vendas = await rows<{ sku: string; d: string; qtd: number; pago: number; lista: number; custo: number; fee: number | null; frete: number | null }>(
    `with it as (
       select o.olist_id, o.data::text d, oi.sku, oi.quantidade qtd,
              oi.valor_unitario::numeric pago, oi.custo_unitario::numeric custo,
              (c.raw->'order_items'->0->>'gross_price')::numeric lista,
              c.sale_fee::numeric fee, c.shipping_cost::numeric frete,
              (select count(*) from order_items x where x.olist_id = o.olist_id) itens
       from order_items oi join orders o on o.olist_id = oi.olist_id join ml_order_costs c on c.olist_id = o.olist_id
       where o.canal ilike '%mercado%' and o.situacao <> 2 and o.data >= current_date - $2::int
         and oi.valor_unitario > 1 and c.sale_fee > 0 and oi.sku = any($1::text[]))
     select sku, d, sum(qtd)::float qtd, avg(pago)::float pago, avg(lista)::float lista,
            avg(custo)::float custo, avg(fee / nullif(itens, 0))::float fee, avg(frete / nullif(itens, 0))::float frete
     from it where lista is not null and lista > 0 group by sku, d order by sku, d`,
    [skus, dias],
  )
  return resumirHistorico(vendas)
}

export function resumirHistorico(
  vendas: { sku: string; d: string; qtd: number; pago: number; lista: number; custo: number; fee: number | null; frete: number | null }[],
): Record<string, HistoricoSku> {
  type Banda = { un: number; mc: number; dias: Set<string> }
  const porSku = new Map<string, Map<string, Banda>>()
  for (const v of vendas) {
    const f = faixaDesconto(v.lista > 0 ? 1 - v.pago / v.lista : 0)
    const bandas = porSku.get(v.sku) ?? new Map<string, Banda>()
    porSku.set(v.sku, bandas)
    const b = bandas.get(f.k) ?? { un: 0, mc: 0, dias: new Set<string>() }
    bandas.set(f.k, b)
    const rec = v.pago * v.qtd
    b.un += v.qtd
    b.mc += rec - v.custo * v.qtd - (v.fee || 0) - (v.frete || 0) - rec * REGRAS.icmsVenda
    b.dias.add(v.d)
  }
  const out: Record<string, HistoricoSku> = {}
  for (const [sku, bandas] of porSku) {
    const faixas: FaixaHistorico[] = FAIXAS_DESCONTO.flatMap((f) => {
      const b = bandas.get(f.k)
      return b ? [{ chave: f.k, faixa: f.rot, un: b.un, mcDia: b.mc / b.dias.size }] : []
    })
    const base = faixas.find((f) => f.chave === "sem") ?? null
    const melhor = [...faixas].sort((x, y) => y.mcDia - x.mcDia)[0]
    const comDesc = faixas.filter((f) => f.chave !== "sem")
    let veredito: string
    if (!base && comDesc.length) veredito = "sempre com desconto"
    else if (!comDesc.length) veredito = "nunca testado"
    else if (melhor.chave === "sem") veredito = "desconto não compensa"
    else veredito = melhor.mcDia / base!.mcDia - 1 > 0.15 ? "desconto funciona" : "empatado"
    out[sku] = { veredito, faixas, base }
  }
  return out
}
