// Margem de contribuição real de uma oferta do Mercado Livre e a decisão de entrar ou não.
// Porte de oem-pricing/scripts/avaliar-promocao.mjs + lib.mjs, sem acesso a banco.

import { REGRAS } from "./regras"

export type Classe = "recomendada" | "recomendada com alerta" | "só com objetivo" | "recusar" | "bloqueada"

export type OfertaLinha = {
  itemId: string
  sku: string | null
  titulo: string
  tipoAnuncio: string | null
  logistica: string | null
  precoAtual: number
  precoPromo: number
  precoOriginal: number | null
  // Redução de tarifa bancada pelo ML, em R$ por unidade.
  reducaoTarifa: number
  estoque: number | null
  vendas14d: number
  tipo: string
  nome: string
  situacao: string
  fim: string | null
}

export type CustoSku = { custo: number; data: string | null }
export type MedidoSku = { pedidos: number; tarifaPct: number; frete: number }
export type HistoricoSku = { veredito: string; faixas: FaixaHistorico[]; base: FaixaHistorico | null }
export type FaixaHistorico = { chave: FaixaChave; faixa: string; un: number; mcDia: number }

export type OfertaAvaliada = {
  itemId: string
  sku: string | null
  titulo: string
  promocao: string
  situacao: string
  fim: string | null
  tipoAnuncio: string
  precoAtual: number
  precoPromo: number
  desconto: number | null
  custo: number | null
  tarifaPct: number
  frete: number
  mcAtualPct: number | null
  mcPromo: number | null
  mcPromoPct: number | null
  estoque: number | null
  vendas14d: number
  historico: string
  classe: Classe
  motivo: string
}

// ---- Rótulos que a pessoa reconhece ----
// PRICE_DISCOUNT e LIGHTNING não têm nome de campanha no ML: são ofertas por anúncio.
export const ROTULOS_PROMOCAO: Record<string, string> = {
  DEAL: "Campanha",
  SELLER_CAMPAIGN: "Campanha da loja",
  SELLER_COUPON_CAMPAIGN: "Cupom",
  PRICE_DISCOUNT: "Desconto no preço (sem campanha)",
  LIGHTNING: "Oferta relâmpago (sem campanha)",
  UNHEALTHY_STOCK: "Estoque parado no Full",
  SMART: "Oferta inteligente",
  MARKETPLACE_CAMPAIGN: "Campanha do Mercado Livre",
}

export function rotuloPromocao(tipo: string, nome: string | null | undefined): string {
  const n = (nome ?? "").trim()
  return n || ROTULOS_PROMOCAO[tipo] || tipo
}

// ---- Conta ----
export function tarifaPorTipo(tipoAnuncio: string | null): number {
  return (tipoAnuncio ? REGRAS.tarifaPorTipo[tipoAnuncio] : undefined) ?? REGRAS.tarifaPorTipo.gold_pro
}

export function freteFaixa(preco: number, full: boolean): number {
  const f = REGRAS.fretePorFaixa.find((b) => preco >= b.min && (b.max == null || preco < b.max)) ?? REGRAS.fretePorFaixa.at(-1)!
  return full ? f.full : f.padrao
}

export function mcReal(p: { preco: number; custo: number; tarifa: number; frete: number }): { mc: number; mcPct: number | null } {
  const mc = p.preco - p.custo - p.preco * p.tarifa - p.frete - p.preco * REGRAS.icmsVenda
  return { mc, mcPct: p.preco > 0 ? mc / p.preco : null }
}

const pct = (v: number, casas = 1) =>
  (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%"
const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

export function classificarPromocao(mcPct: number | null): { classe: Classe; motivo: string } {
  const P = REGRAS.patamares
  if (mcPct == null) return { classe: "bloqueada", motivo: "sem custo ou dado essencial" }
  if (mcPct < P.estrategico) return { classe: "recusar", motivo: `MC ${pct(mcPct)} abaixo de ${pct(P.estrategico, 0)}` }
  if (mcPct < P.saudavel) {
    return {
      classe: "só com objetivo",
      motivo: `MC ${pct(mcPct)}: patamar estratégico, aprovação do gestor, até ${REGRAS.limites.estrategicoDiasMax} dias`,
    }
  }
  return { classe: "recomendada", motivo: `MC ${pct(mcPct)} ≥ ${pct(P.saudavel, 0)}` }
}

// ---- Faixas de desconto (histórico) ----
export type FaixaChave = "sem" | "leve" | "media" | "forte"
export const FAIXAS_DESCONTO: { k: FaixaChave; rot: string; lo: number; hi: number }[] = [
  { k: "sem", rot: "Sem desconto", lo: -1, hi: 0.02 },
  { k: "leve", rot: "2 a 10%", lo: 0.02, hi: 0.1 },
  { k: "media", rot: "10 a 20%", lo: 0.1, hi: 0.2 },
  { k: "forte", rot: "acima de 20%", lo: 0.2, hi: 9 },
]
export const faixaDesconto = (d: number) => FAIXAS_DESCONTO.find((f) => d >= f.lo && d < f.hi) ?? FAIXAS_DESCONTO[0]

// ---- Decisão por oferta ----
export function avaliarOferta(
  o: OfertaLinha,
  ctx: { custo: CustoSku | null; medido?: MedidoSku | null; historico?: HistoricoSku | null; agora?: Date },
): OfertaAvaliada {
  const L = REGRAS.limites
  const full = o.logistica === "fulfillment"
  const usaMedido = ctx.medido != null && ctx.medido.pedidos >= REGRAS.medicao.minPedidos
  const tarifa = usaMedido ? ctx.medido!.tarifaPct : tarifaPorTipo(o.tipoAnuncio)
  const frete = usaMedido ? ctx.medido!.frete : freteFaixa(o.precoPromo, full)
  const desconto = o.precoOriginal ? 1 - o.precoPromo / o.precoOriginal : null
  const agora = ctx.agora ?? new Date()

  const base: OfertaAvaliada = {
    itemId: o.itemId,
    sku: o.sku,
    titulo: o.titulo,
    promocao: rotuloPromocao(o.tipo, o.nome),
    situacao: o.situacao,
    fim: o.fim,
    tipoAnuncio: (REGRAS.rotuloTipo[o.tipoAnuncio ?? ""] ?? o.tipoAnuncio ?? "—") + (full ? " · Full" : ""),
    precoAtual: o.precoAtual,
    precoPromo: o.precoPromo,
    desconto,
    custo: ctx.custo?.custo ?? null,
    tarifaPct: tarifa,
    frete,
    mcAtualPct: null,
    mcPromo: null,
    mcPromoPct: null,
    estoque: o.estoque,
    vendas14d: o.vendas14d,
    historico: "—",
    classe: "bloqueada",
    motivo: "sem custo na Olist",
  }
  if (!ctx.custo) return base

  const c = ctx.custo.custo
  const atual = mcReal({ preco: o.precoAtual, custo: c, tarifa, frete })
  const promoMc = mcReal({ preco: o.precoPromo, custo: c, tarifa, frete }).mc + o.reducaoTarifa
  base.mcAtualPct = atual.mcPct
  base.mcPromo = promoMc
  base.mcPromoPct = promoMc / o.precoPromo

  const cls = classificarPromocao(base.mcPromoPct)
  const alertas: string[] = []
  if (o.estoque != null && o.estoque < L.estoqueMinUnidadesPromocao) alertas.push(`estoque ${o.estoque} < ${L.estoqueMinUnidadesPromocao}`)
  if ((o.vendas14d / 14) * L.estoqueMinDiasVenda > (o.estoque ?? 0)) alertas.push("estoque menor que a venda de 14 dias")
  if (ctx.custo.data && (agora.getTime() - new Date(ctx.custo.data).getTime()) / 86_400_000 > L.custoMaxDias) {
    alertas.push(`custo de ${ctx.custo.data} (> ${L.custoMaxDias} dias)`)
  }
  base.classe = alertas.length && cls.classe === "recomendada" ? "recomendada com alerta" : cls.classe
  base.motivo = [cls.motivo, ...alertas].join("; ")

  const h = ctx.historico
  if (h && desconto != null) {
    const alvo = faixaDesconto(desconto)
    const naFaixa = h.faixas.find((f) => f.chave === alvo.k)
    const cheio = h.base && h.base.chave !== naFaixa?.chave ? ` · cheio ${brl0(h.base.mcDia)}/dia` : ""
    base.historico = naFaixa
      ? `${naFaixa.faixa}: ${brl0(naFaixa.mcDia)}/dia em ${naFaixa.un} un${cheio}`
      : `nunca vendeu com ${pct(desconto, 0)}${h.base ? ` · cheio ${brl0(h.base.mcDia)}/dia` : ""}`
    if (h.veredito === "desconto não compensa" && alvo.k !== "sem" && base.classe === "recomendada") {
      base.classe = "recomendada com alerta"
      base.motivo += "; histórico diz que preço cheio rende mais"
    }
  }
  return base
}

const ORDEM: Record<Classe, number> = { recomendada: 0, "recomendada com alerta": 1, "só com objetivo": 2, recusar: 3, bloqueada: 4 }
export function ordenarAvaliadas(xs: OfertaAvaliada[]): OfertaAvaliada[] {
  return [...xs].sort((a, b) => ORDEM[a.classe] - ORDEM[b.classe] || (b.mcPromo ?? -1) - (a.mcPromo ?? -1))
}
