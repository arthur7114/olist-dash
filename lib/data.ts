// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------

export type Canal = string

export type FormaPagamento =
  | "Pix"
  | "Cartão de crédito"
  | "Boleto"
  | "Cartão de débito"

export type StatusPagamento = "Pago" | "Pendente" | "Estornado" | "Parcial" | "Cancelado"

export type ClasseABC = "A" | "B" | "C"

export interface Produto {
  sku: string
  nome: string
  custoMedio: number
}

export interface ItemPedido {
  sku: string
  descricao: string
  quantidade: number
  valorUnitario: number
  custoUnitario: number
}

export interface Pedido {
  id: string
  numeroPedido: string
  numeroNF: string
  sku: string
  produto: string
  canal: Canal
  vendedor: string
  formaPagamento: FormaPagamento
  valorVenda: number
  valorFrete: number
  devolucao: number
  taxaComissao: number // taxa/comissão em R$ aplicada (ML, vendedores); 0 = não capturado da Olist
  custoTotal: number // custo dos produtos vendidos
  valorNota?: number // valor da NF emitida (R$); undefined = sem NF / não capturado
  dataNota?: string // data de emissão da NF (ISO); undefined = sem NF / não capturada
  quantidade: number // qtd total de itens do pedido
  statusPagamento: StatusPagamento
  data: string // ISO date
  itens?: ItemPedido[]
  custoMlReal?: boolean // taxa/frete vieram da API do Mercado Livre (Task 15)
}

// ----------------------------------------------------------------------------
// Catálogo de produtos
// ----------------------------------------------------------------------------

export const PRODUTOS: Produto[] = [
  { sku: "ELT-1001", nome: "Fone Bluetooth Pro Max", custoMedio: 89.9 },
  { sku: "ELT-1002", nome: "Smartwatch Fit 5", custoMedio: 142.5 },
  { sku: "ELT-1003", nome: "Caixa de Som Portátil 20W", custoMedio: 64.0 },
  { sku: "CAS-2001", nome: "Cafeteira Elétrica Inox", custoMedio: 118.0 },
  { sku: "CAS-2002", nome: "Liquidificador Turbo 1200W", custoMedio: 96.3 },
  { sku: "CAS-2003", nome: "Air Fryer Digital 5L", custoMedio: 210.0 },
  { sku: "BEL-3001", nome: "Secador de Cabelo Íons", custoMedio: 72.4 },
  { sku: "BEL-3002", nome: "Kit Skincare Vitamina C", custoMedio: 38.9 },
  { sku: "ESP-4001", nome: "Tênis Running Ultra", custoMedio: 134.0 },
  { sku: "ESP-4002", nome: "Garrafa Térmica 1L", custoMedio: 28.5 },
  { sku: "PET-5001", nome: "Ração Premium 15kg", custoMedio: 88.0 },
  { sku: "FER-6001", nome: "Furadeira de Impacto 750W", custoMedio: 156.7 },
]

export const CANAIS: Canal[] = [
  "Mercado Livre",
  "Site",
  "WhatsApp",
  "Vendedor interno",
  "Vendedor externo",
]

export const FORMAS_PAGAMENTO: FormaPagamento[] = [
  "Pix",
  "Cartão de crédito",
  "Boleto",
  "Cartão de débito",
]

export const VENDEDORES_POR_CANAL: Record<Canal, string[]> = {
  "Mercado Livre": ["Loja Oficial ML"],
  Site: ["Loja Site"],
  WhatsApp: ["Atendimento WhatsApp"],
  "Vendedor interno": ["Ana Souza", "Carlos Lima", "Bruna Reis"],
  "Vendedor externo": ["Marcos Dias", "Patrícia Gomes"],
}

// taxa/comissão por canal (percentual sobre o valor da venda)
const TAXA_CANAL: Record<Canal, number> = {
  "Mercado Livre": 0.16,
  Site: 0,
  WhatsApp: 0,
  "Vendedor interno": 0.03,
  "Vendedor externo": 0.05,
}

const STATUS: StatusPagamento[] = ["Pago", "Pago", "Pago", "Pendente", "Estornado", "Parcial"]

// ----------------------------------------------------------------------------
// Gerador determinístico (mock realista e estável entre renders)
// ----------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gerarPedidos(): Pedido[] {
  const rand = mulberry32(20260530)
  const pedidos: Pedido[] = []
  const total = 64
  const hoje = new Date("2026-05-30")

  for (let i = 0; i < total; i++) {
    const produto = PRODUTOS[Math.floor(rand() * PRODUTOS.length)]
    const canal = CANAIS[Math.floor(rand() * CANAIS.length)]
    const vendedoresCanal = VENDEDORES_POR_CANAL[canal]
    const vendedor = vendedoresCanal[Math.floor(rand() * vendedoresCanal.length)]
    const formaPagamento = FORMAS_PAGAMENTO[Math.floor(rand() * FORMAS_PAGAMENTO.length)]

    const quantidade = 1 + Math.floor(rand() * 4)
    // markup entre 1.45x e 2.3x sobre o custo
    const markupFator = 1.45 + rand() * 0.85
    const precoUnit = Math.round(produto.custoMedio * markupFator * 100) / 100
    const valorVenda = Math.round(precoUnit * quantidade * 100) / 100
    const custoTotal = Math.round(produto.custoMedio * quantidade * 100) / 100

    const valorFrete = Math.round((12 + rand() * 38) * 100) / 100
    const temDevolucao = rand() < 0.12
    const devolucao = temDevolucao ? Math.round(precoUnit * 100) / 100 : 0
    const taxaComissao = Math.round(valorVenda * TAXA_CANAL[canal] * 100) / 100

    const status = STATUS[Math.floor(rand() * STATUS.length)]

    const diasAtras = Math.floor(rand() * 30)
    const data = new Date(hoje)
    data.setDate(hoje.getDate() - diasAtras)

    pedidos.push({
      id: `p-${i + 1}`,
      numeroPedido: `PED-${(10458 + i).toString()}`,
      numeroNF: `NF-${(204781 + i).toString()}`,
      sku: produto.sku,
      produto: produto.nome,
      canal,
      vendedor,
      formaPagamento,
      valorVenda,
      valorFrete,
      devolucao,
      taxaComissao,
      custoTotal,
      quantidade,
      statusPagamento: status,
      data: data.toISOString().slice(0, 10),
    })
  }

  return pedidos.sort((a, b) => (a.data < b.data ? 1 : -1))
}

export const PEDIDOS: Pedido[] = gerarPedidos()

// ----------------------------------------------------------------------------
// Regras de cálculo
// ----------------------------------------------------------------------------

// % de comissão por canal — fallback usado quando a Olist NÃO traz o valor real da
// tarifa no pedido (o valor exato costuma vir só no Repasse, no mês seguinte).
// Vendas locais e canais não listados = 0%. Ajuste conforme seu plano/categoria.
// Override opcional em build via NEXT_PUBLIC_COMISSAO_ML / NEXT_PUBLIC_COMISSAO_SHOPEE.
function pctEnv(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const COMISSAO_POR_CANAL: { match: string; taxa: number }[] = [
  { match: "mercado livre", taxa: pctEnv(process.env.NEXT_PUBLIC_COMISSAO_ML, 0.16) },
  { match: "mercadolivre", taxa: pctEnv(process.env.NEXT_PUBLIC_COMISSAO_ML, 0.16) },
  { match: "shopee", taxa: pctEnv(process.env.NEXT_PUBLIC_COMISSAO_SHOPEE, 0.2) },
]

function comissaoEstimada(p: Pedido): number {
  const canal = p.canal.toLowerCase()
  const regra = COMISSAO_POR_CANAL.find((r) => canal.includes(r.match))
  if (!regra) return 0
  return Math.round(p.valorVenda * regra.taxa * 100) / 100
}

// Taxa/comissão efetiva do pedido: usa o valor real da Olist quando houver (>0);
// senão cai para a estimativa por canal. Garante que a M.C. nunca fique
// superestimada por falta da tarifa do marketplace.
export function taxaComissaoEfetiva(p: Pedido): number {
  return p.taxaComissao > 0 ? p.taxaComissao : comissaoEstimada(p)
}

// Margem de contribuição do pedido (R$): receita − custos/despesas variáveis
// (CMV + frete + devolução + comissão/taxa de marketplace).
// NB: o nome `lucroBruto` é mantido internamente, mas conceitualmente isto é a M.C.
export function lucroBrutoPedido(p: Pedido): number {
  return p.valorVenda - p.custoTotal - p.valorFrete - p.devolucao - taxaComissaoEfetiva(p)
}

export interface KPIs {
  faturamentoBruto: number
  faturamentoLiquido: number // bruto − devoluções (base da margem)
  quantidadePedidos: number
  totalFrete: number
  totalDevolucoes: number
  totalComissao: number // soma das taxas/comissões efetivas
  lucroBruto: number // = margem de contribuição (R$)
  ticketMedio: number
  margemMedia: number // = margem de contribuição (%) sobre a receita líquida
  markupMedio: number
  pedidosSemCusto: number // pedidos com venda > 0 e custo 0 (M.C. otimista nesses)
}

export function calcularKPIs(pedidos: Pedido[]): KPIs {
  const faturamentoBruto = pedidos.reduce((s, p) => s + p.valorVenda, 0)
  const totalFrete = pedidos.reduce((s, p) => s + p.valorFrete, 0)
  const totalDevolucoes = pedidos.reduce((s, p) => s + p.devolucao, 0)
  const totalComissao = pedidos.reduce((s, p) => s + taxaComissaoEfetiva(p), 0)
  const custoTotal = pedidos.reduce((s, p) => s + p.custoTotal, 0)
  const lucroBruto = pedidos.reduce((s, p) => s + lucroBrutoPedido(p), 0)
  const quantidadePedidos = pedidos.length
  const pedidosSemCusto = pedidos.filter((p) => p.valorVenda > 0 && p.custoTotal === 0).length

  const faturamentoLiquido = faturamentoBruto - totalDevolucoes
  const ticketMedio = quantidadePedidos ? faturamentoBruto / quantidadePedidos : 0
  const margemMedia = faturamentoLiquido ? lucroBruto / faturamentoLiquido : 0
  const markupMedio = custoTotal ? faturamentoBruto / custoTotal : 0

  return {
    faturamentoBruto,
    faturamentoLiquido,
    quantidadePedidos,
    totalFrete,
    totalDevolucoes,
    totalComissao,
    lucroBruto,
    ticketMedio,
    margemMedia,
    markupMedio,
    pedidosSemCusto,
  }
}

// Faturamento e lucro por dia (para gráfico de série temporal)
export interface PontoDiario {
  data: string
  faturamento: number
  lucro: number
}

export function serieDiaria(pedidos: Pedido[]): PontoDiario[] {
  const mapa = new Map<string, PontoDiario>()
  for (const p of pedidos) {
    const atual = mapa.get(p.data) ?? { data: p.data, faturamento: 0, lucro: 0 }
    atual.faturamento += p.valorVenda
    atual.lucro += lucroBrutoPedido(p)
    mapa.set(p.data, atual)
  }
  return Array.from(mapa.values()).sort((a, b) => (a.data < b.data ? -1 : 1))
}

// ----------------------------------------------------------------------------
// Agregações: Canais e Vendedores
// ----------------------------------------------------------------------------

export interface LinhaCanalVendedor {
  canal: Canal
  vendedor: string
  quantidadeVendas: number
  faturamento: number
  ticketMedio: number
  taxaMarketplace: number // soma das taxas/comissões efetivas (ML, Shopee, etc.)
  margem: number // M.C. % sobre a receita líquida
  lucroBruto: number // M.C. (R$)
}

export function agregarPorCanalVendedor(pedidos: Pedido[]): LinhaCanalVendedor[] {
  const mapa = new Map<string, LinhaCanalVendedor & { devolucoes: number }>()
  for (const p of pedidos) {
    const chave = `${p.canal}|${p.vendedor}`
    const atual =
      mapa.get(chave) ??
      {
        canal: p.canal,
        vendedor: p.vendedor,
        quantidadeVendas: 0,
        faturamento: 0,
        ticketMedio: 0,
        taxaMarketplace: 0,
        margem: 0,
        lucroBruto: 0,
        devolucoes: 0,
      }

    atual.quantidadeVendas += 1
    atual.faturamento += p.valorVenda
    atual.lucroBruto += lucroBrutoPedido(p)
    atual.taxaMarketplace += taxaComissaoEfetiva(p)
    atual.devolucoes += p.devolucao
    mapa.set(chave, atual)
  }

  return Array.from(mapa.values())
    .map(({ devolucoes, ...l }) => {
      const receitaLiquida = l.faturamento - devolucoes
      return {
        ...l,
        ticketMedio: l.quantidadeVendas ? l.faturamento / l.quantidadeVendas : 0,
        margem: receitaLiquida ? l.lucroBruto / receitaLiquida : 0,
      }
    })
    .sort((a, b) => b.faturamento - a.faturamento)
}

export interface ResumoCanal {
  canal: Canal
  faturamento: number
  lucroBruto: number
  ticketMedio: number
  quantidadeVendas: number
}

export function agregarPorCanal(pedidos: Pedido[]): ResumoCanal[] {
  const mapa = new Map<Canal, ResumoCanal>()
  for (const p of pedidos) {
    const atual =
      mapa.get(p.canal) ??
      ({ canal: p.canal, faturamento: 0, lucroBruto: 0, ticketMedio: 0, quantidadeVendas: 0 } as ResumoCanal)
    atual.faturamento += p.valorVenda
    atual.lucroBruto += lucroBrutoPedido(p)
    atual.quantidadeVendas += 1
    mapa.set(p.canal, atual)
  }
  return Array.from(mapa.values())
    .map((c) => ({ ...c, ticketMedio: c.quantidadeVendas ? c.faturamento / c.quantidadeVendas : 0 }))
    .sort((a, b) => b.faturamento - a.faturamento)
}

// ----------------------------------------------------------------------------
// Curva ABC de Produtos
// ----------------------------------------------------------------------------

export interface LinhaABC {
  classe: ClasseABC
  sku: string
  produto: string
  quantidadeVendida: number
  valorVendido: number
  custoMedio: number
  custoTotal: number
  margem: number
  lucroBruto: number
  markup: number
  participacao: number // participação individual no faturamento
  participacaoAcumulada: number
}

export function calcularCurvaABC(pedidos: Pedido[]): LinhaABC[] {
  const mapa = new Map<
    string,
    { sku: string; produto: string; quantidade: number; valor: number; custo: number; lucro: number; devolucoes: number }
  >()

  for (const p of pedidos) {
    const atual =
      mapa.get(p.sku) ?? { sku: p.sku, produto: p.produto, quantidade: 0, valor: 0, custo: 0, lucro: 0, devolucoes: 0 }
    atual.quantidade += Math.max(1, p.quantidade) // qtd real do pedido (somada por SKU)
    atual.valor += p.valorVenda
    atual.custo += p.custoTotal
    atual.lucro += lucroBrutoPedido(p)
    atual.devolucoes += p.devolucao
    mapa.set(p.sku, atual)
  }

  const ordenado = Array.from(mapa.values()).sort((a, b) => b.valor - a.valor)
  const faturamentoTotal = ordenado.reduce((s, x) => s + x.valor, 0)

  let acumulado = 0
  return ordenado.map((x) => {
    const participacao = faturamentoTotal ? x.valor / faturamentoTotal : 0
    acumulado += participacao
    let classe: ClasseABC = "C"
    if (acumulado <= 0.8) classe = "A"
    else if (acumulado <= 0.95) classe = "B"

    const custoUnit = x.quantidade ? x.custo / x.quantidade : 0
    const receitaLiquida = x.valor - x.devolucoes
    return {
      classe,
      sku: x.sku,
      produto: x.produto,
      quantidadeVendida: x.quantidade,
      valorVendido: x.valor,
      custoMedio: custoUnit,
      custoTotal: x.custo,
      margem: receitaLiquida ? x.lucro / receitaLiquida : 0,
      lucroBruto: x.lucro,
      markup: x.custo ? x.valor / x.custo : 0,
      participacao,
      participacaoAcumulada: acumulado,
    }
  })
}

// ----------------------------------------------------------------------------
// Formatação
// ----------------------------------------------------------------------------

export function formatBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

export function formatBRLCompacto(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  })
}

export function formatPercent(valor: number, casas = 1): string {
  return valor.toLocaleString("pt-BR", {
    style: "percent",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

export function formatNumero(valor: number): string {
  return valor.toLocaleString("pt-BR")
}

export function formatData(iso: string): string {
  const [ano, mes, dia] = iso.split("-")
  return `${dia}/${mes}/${ano}`
}

export function formatMarkup(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
}

// Variação % vs. período anterior. undefined = sem base de comparação (oculta no card).
export function variacaoPct(atual: number, anterior: number): number | undefined {
  if (!Number.isFinite(anterior) || anterior === 0) return undefined
  return (atual - anterior) / Math.abs(anterior)
}

// Situações Olist/Tiny: 0 Em aberto, 1 Faturado, 2 Cancelado, 3 Aprovado,
// 4 Preparando envio, 5 Enviado, 6 Entregue, 7 Pronto p/ envio, 8 Dados incompletos.
export const SITUACAO_LABEL: Record<number, string> = {
  0: "Em aberto",
  1: "Faturado",
  2: "Cancelado",
  3: "Aprovado",
  4: "Preparando envio",
  5: "Enviado",
  6: "Entregue",
  7: "Pronto p/ envio",
  8: "Dados incompletos",
}

export const SITUACAO_CANCELADO = 2
export const SITUACAO_ENTREGUE = 6
export const SITUACOES_PAGAS = new Set([1, 3, 4, 5, 6, 7])

export function statusPorSituacao(
  situacao: number | null | undefined,
  fallback: StatusPagamento,
): StatusPagamento {
  if (situacao === null || situacao === undefined) return fallback
  if (situacao === 2) return "Estornado"
  if (SITUACOES_PAGAS.has(situacao)) return "Pago"
  return "Pendente"
}

// Base de valor usada nos números do dashboard: valor de venda (padrão) ou valor da NF.
export type BaseValor = "venda" | "nota"

// Troca a base monetária "na fonte": em modo "nota" o recorte é "só faturados" —
// pedidos SEM NF são descartados por inteiro (não são venda realizada ainda) e os
// demais passam a expor o valor da NF em valorVenda. Descartar o pedido inteiro (em
// vez de só zerar a receita) evita o prejuízo fantasma de somar o custo de um pedido
// cuja receita foi zerada. Assim TODA agregação que lê valorVenda (KPIs, séries,
// curva ABC, devoluções) reflete a nova base sem alteração própria.
export function aplicarBaseValor(pedidos: Pedido[], base: BaseValor): Pedido[] {
  if (base === "venda") return pedidos
  return pedidos
    .filter((p) => p.valorNota != null && Boolean(p.dataNota))
    .map((p) => ({ ...p, valorVenda: p.valorNota as number, data: p.dataNota as string }))
}
