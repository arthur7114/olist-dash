import { taxaComissaoEfetiva, type ItemPedido, type Pedido } from "@/lib/data"

// Análise por SKU: cada pedido é rateado entre seus itens proporcionalmente ao
// valor (taxa, frete e devolução seguem a participação do item no pedido).
// Pedidos sem itens carregados usam o próprio pedido como item único.

export type AlertaSku = "sem-custo" | "alta-devolucao" | "margem-baixa"

export const LIMIAR_MARGEM_BAIXA = 0.1
export const LIMIAR_DEVOLUCAO_ALTA = 0.05

export interface LinhaSku {
  sku: string
  produto: string
  canais: string[]
  pedidos: number
  qtdVendida: number
  qtdDevolvida: number
  faturamento: number
  devolucaoValor: number
  faturamentoLiquido: number
  custoTotal: number
  taxaAlocada: number
  freteAlocado: number
  margemValor: number
  margemPct: number
  markup: number
  ticketMedio: number
  taxaDevolucao: number
  semCusto: boolean
  alertas: AlertaSku[]
}

type Acumulador = Omit<LinhaSku, "margemPct" | "markup" | "ticketMedio" | "taxaDevolucao" | "alertas" | "canais" | "semCusto"> & {
  canais: Set<string>
  temVendaSemCusto: boolean
}

function itensDoPedido(p: Pedido): ItemPedido[] {
  if (p.itens?.length) return p.itens
  return [{ sku: p.sku, descricao: p.produto, quantidade: p.quantidade, valorUnitario: p.quantidade ? p.valorVenda / p.quantidade : p.valorVenda, custoUnitario: p.quantidade ? p.custoTotal / p.quantidade : p.custoTotal }]
}

export function agregarPorSku(pedidos: Pedido[]): LinhaSku[] {
  const mapa = new Map<string, Acumulador>()

  for (const p of pedidos) {
    const itens = itensDoPedido(p)
    const totalPedido = itens.reduce((s, i) => s + i.valorUnitario * i.quantidade, 0)
    const taxa = taxaComissaoEfetiva(p)
    const devolvido = p.devolucao > 0

    for (const item of itens) {
      const valorItem = item.valorUnitario * item.quantidade
      const share = totalPedido > 0 ? valorItem / totalPedido : 1 / itens.length
      const acc =
        mapa.get(item.sku) ??
        ({
          sku: item.sku, produto: item.descricao, canais: new Set<string>(), pedidos: 0,
          qtdVendida: 0, qtdDevolvida: 0, faturamento: 0, devolucaoValor: 0, faturamentoLiquido: 0,
          custoTotal: 0, taxaAlocada: 0, freteAlocado: 0, margemValor: 0, temVendaSemCusto: false,
        } as Acumulador)

      const custoItem = item.custoUnitario * item.quantidade
      const devolucaoItem = devolvido ? valorItem : 0

      acc.canais.add(p.canal)
      acc.pedidos += 1
      acc.qtdVendida += item.quantidade
      if (devolvido) acc.qtdDevolvida += item.quantidade
      acc.faturamento += valorItem
      acc.devolucaoValor += devolucaoItem
      acc.custoTotal += custoItem
      acc.taxaAlocada += taxa * share
      acc.freteAlocado += p.valorFrete * share
      acc.margemValor += valorItem - devolucaoItem - custoItem - taxa * share - p.valorFrete * share
      if (valorItem > 0 && custoItem === 0) acc.temVendaSemCusto = true
      mapa.set(item.sku, acc)
    }
  }

  return Array.from(mapa.values())
    .map((acc) => {
      const faturamentoLiquido = acc.faturamento - acc.devolucaoValor
      const margemPct = faturamentoLiquido > 0 ? acc.margemValor / faturamentoLiquido : 0
      const taxaDevolucao = acc.faturamento > 0 ? acc.devolucaoValor / acc.faturamento : 0
      const alertas: AlertaSku[] = []
      if (acc.temVendaSemCusto) alertas.push("sem-custo")
      if (taxaDevolucao > LIMIAR_DEVOLUCAO_ALTA) alertas.push("alta-devolucao")
      if (!acc.temVendaSemCusto && margemPct < LIMIAR_MARGEM_BAIXA) alertas.push("margem-baixa")
      return {
        ...acc,
        canais: Array.from(acc.canais).sort(),
        faturamentoLiquido,
        margemPct,
        markup: acc.custoTotal > 0 ? acc.faturamento / acc.custoTotal : 0,
        ticketMedio: acc.pedidos ? acc.faturamento / acc.pedidos : 0,
        taxaDevolucao,
        semCusto: acc.temVendaSemCusto,
        alertas,
      }
    })
    .sort((a, b) => b.faturamento - a.faturamento)
}

export interface SkuMensal {
  mes: string
  faturamento: number
  devolucao: number
  margem: number
  quantidade: number
}

export function skuPorMes(sku: string, pedidos: Pedido[]): SkuMensal[] {
  const linhasPorMes = new Map<string, SkuMensal>()
  for (const p of pedidos) {
    const itens = itensDoPedido(p).filter((i) => i.sku === sku)
    if (!itens.length) continue
    const totalPedido = itensDoPedido(p).reduce((s, i) => s + i.valorUnitario * i.quantidade, 0)
    const taxa = taxaComissaoEfetiva(p)
    const mes = p.data.slice(0, 7)
    const acc = linhasPorMes.get(mes) ?? { mes, faturamento: 0, devolucao: 0, margem: 0, quantidade: 0 }
    for (const item of itens) {
      const valorItem = item.valorUnitario * item.quantidade
      const share = totalPedido > 0 ? valorItem / totalPedido : 1
      const devolucaoItem = p.devolucao > 0 ? valorItem : 0
      acc.faturamento += valorItem
      acc.devolucao += devolucaoItem
      acc.quantidade += item.quantidade
      acc.margem += valorItem - devolucaoItem - item.custoUnitario * item.quantidade - taxa * share - p.valorFrete * share
    }
    linhasPorMes.set(mes, acc)
  }
  return Array.from(linhasPorMes.values()).sort((a, b) => (a.mes < b.mes ? -1 : 1))
}
