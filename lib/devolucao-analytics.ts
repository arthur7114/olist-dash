import type { Pedido } from "@/lib/data"

// Devolução = pedido cancelado na Olist (total). O valor cai no mês do PEDIDO,
// não no mês do cancelamento — não temos a data da devolução na fonte.

export interface KpisDevolucao {
  pedidosDevolvidos: number
  itensDevolvidos: number
  skusDevolvidos: number
  valorDevolvido: number
  taxaDevolucao: number
  ticketMedioDevolucao: number
}

export function calcularKpisDevolucao(pedidos: Pedido[]): KpisDevolucao {
  const devolvidos = pedidos.filter((p) => p.devolucao > 0)
  const skus = new Set<string>()
  let itens = 0
  for (const p of devolvidos) {
    itens += Math.max(1, p.quantidade)
    if (p.itens?.length) for (const i of p.itens) skus.add(i.sku)
    else skus.add(p.sku)
  }
  const valorDevolvido = devolvidos.reduce((s, p) => s + p.devolucao, 0)
  const faturamento = pedidos.reduce((s, p) => s + p.valorVenda, 0)
  return {
    pedidosDevolvidos: devolvidos.length,
    itensDevolvidos: itens,
    skusDevolvidos: skus.size,
    valorDevolvido,
    taxaDevolucao: faturamento > 0 ? valorDevolvido / faturamento : 0,
    ticketMedioDevolucao: devolvidos.length ? valorDevolvido / devolvidos.length : 0,
  }
}

export interface DevolucaoMensal {
  mes: string
  valorDevolvido: number
  faturamento: number
  taxa: number
}

export function devolucaoPorMes(pedidos: Pedido[]): DevolucaoMensal[] {
  const mapa = new Map<string, DevolucaoMensal>()
  for (const p of pedidos) {
    const mes = p.data.slice(0, 7)
    const acc = mapa.get(mes) ?? { mes, valorDevolvido: 0, faturamento: 0, taxa: 0 }
    acc.valorDevolvido += p.devolucao
    acc.faturamento += p.valorVenda
    mapa.set(mes, acc)
  }
  return Array.from(mapa.values())
    .map((m) => ({ ...m, taxa: m.faturamento > 0 ? m.valorDevolvido / m.faturamento : 0 }))
    .sort((a, b) => (a.mes < b.mes ? -1 : 1))
}

export interface DevolucaoCanal {
  canal: string
  pedidos: number
  valorDevolvido: number
  taxa: number
}

export function devolucaoPorCanal(pedidos: Pedido[]): DevolucaoCanal[] {
  const mapa = new Map<string, { canal: string; pedidos: number; valorDevolvido: number; faturamento: number }>()
  for (const p of pedidos) {
    const acc = mapa.get(p.canal) ?? { canal: p.canal, pedidos: 0, valorDevolvido: 0, faturamento: 0 }
    if (p.devolucao > 0) {
      acc.pedidos += 1
      acc.valorDevolvido += p.devolucao
    }
    acc.faturamento += p.valorVenda
    mapa.set(p.canal, acc)
  }
  return Array.from(mapa.values())
    .filter((c) => c.valorDevolvido > 0)
    .map(({ faturamento, ...c }) => ({ ...c, taxa: faturamento > 0 ? c.valorDevolvido / faturamento : 0 }))
    .sort((a, b) => b.valorDevolvido - a.valorDevolvido)
}
