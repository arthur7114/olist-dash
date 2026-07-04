"use client"

import {
  DollarSign,
  ShoppingCart,
  Truck,
  Undo2,
  TrendingUp,
  Receipt,
  Percent,
  Layers,
  AlertTriangle,
} from "lucide-react"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { CanalBarChart, FaturamentoLucroChart } from "@/components/dashboard/overview-charts"
import { useFiltros } from "@/lib/filters"
import { calcularKPIs, formatBRL, formatMarkup, formatNumero, formatPercent, variacaoPct } from "@/lib/data"

export default function VisaoGeralPage() {
  const { pedidosFiltrados, pedidosPeriodoAnterior } = useFiltros()
  const kpi = calcularKPIs(pedidosFiltrados)
  const kpiAnterior = calcularKPIs(pedidosPeriodoAnterior)

  const cards = [
    { titulo: "Faturamento bruto", valor: formatBRL(kpi.faturamentoBruto), icone: DollarSign, variacao: variacaoPct(kpi.faturamentoBruto, kpiAnterior.faturamentoBruto), destaque: "positivo" as const, legenda: "vs. período anterior" },
    { titulo: "Quantidade de pedidos", valor: formatNumero(kpi.quantidadePedidos), icone: ShoppingCart, variacao: variacaoPct(kpi.quantidadePedidos, kpiAnterior.quantidadePedidos), destaque: "default" as const, legenda: "pedidos no período" },
    { titulo: "Valor total de frete", valor: formatBRL(kpi.totalFrete), icone: Truck, variacao: variacaoPct(kpi.totalFrete, kpiAnterior.totalFrete), destaque: "default" as const, legenda: "custo logístico" },
    { titulo: "Valor de devoluções", valor: formatBRL(kpi.totalDevolucoes), icone: Undo2, variacao: variacaoPct(kpi.totalDevolucoes, kpiAnterior.totalDevolucoes), destaque: "alerta" as const, legenda: "vs. período anterior" },
    { titulo: "Margem de contribuição", valor: formatBRL(kpi.lucroBruto), icone: TrendingUp, variacao: variacaoPct(kpi.lucroBruto, kpiAnterior.lucroBruto), destaque: "positivo" as const, legenda: "receita − custos/taxas variáveis" },
    { titulo: "Ticket médio", valor: formatBRL(kpi.ticketMedio), icone: Receipt, variacao: variacaoPct(kpi.ticketMedio, kpiAnterior.ticketMedio), destaque: "default" as const, legenda: "por pedido" },
    { titulo: "Margem de contribuição %", valor: formatPercent(kpi.margemMedia), icone: Percent, variacao: variacaoPct(kpi.margemMedia, kpiAnterior.margemMedia), destaque: "positivo" as const, legenda: "M.C. / receita líquida" },
    { titulo: "Markup médio", valor: formatMarkup(kpi.markupMedio), icone: Layers, variacao: variacaoPct(kpi.markupMedio, kpiAnterior.markupMedio), destaque: "default" as const, legenda: "venda / custo" },
  ]

  return (
    <>
      <PageTitle
        titulo="Visão Geral"
        descricao="Indicadores consolidados de vendas, margens e rentabilidade da operação."
      />

      <GlobalFilters />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.titulo} {...c} />
        ))}
      </section>

      {kpi.pedidosSemCusto > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {formatNumero(kpi.pedidosSemCusto)} pedido(s) sem custo de produto cadastrado — a
            margem de contribuição pode estar otimista nesses casos.
          </span>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FaturamentoLucroChart pedidos={pedidosFiltrados} />
        <CanalBarChart pedidos={pedidosFiltrados} />
      </section>
    </>
  )
}
