"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Boxes, PackageX, Percent, Trophy } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { DataTable } from "@/components/dashboard/data-table"
import { SkuDrawer } from "@/components/dashboard/sku-drawer"
import { MatrizFaturamentoMargemChart, TopSkusChart } from "@/components/dashboard/sku-charts"
import { useFiltros } from "@/lib/filters"
import { agregarPorSku, type LinhaSku } from "@/lib/sku-analytics"
import { formatBRL, formatMarkup, formatNumero, formatPercent } from "@/lib/data"

const ALERTA_CURTO: Record<string, string> = {
  "sem-custo": "Sem custo",
  "alta-devolucao": "Devolução",
  "margem-baixa": "Margem",
}

export default function ProdutosPage() {
  const { pedidosFiltrados } = useFiltros()
  const linhas = useMemo(() => agregarPorSku(pedidosFiltrados), [pedidosFiltrados])
  const [selecionado, setSelecionado] = useState<LinhaSku | null>(null)

  const skusDevolvidos = linhas.filter((l) => l.qtdDevolvida > 0)
  const semCusto = linhas.filter((l) => l.semCusto)
  const topFat = linhas[0]
  const topQtd = [...linhas].sort((a, b) => b.qtdVendida - a.qtdVendida)[0]
  const topMargem = [...linhas].sort((a, b) => b.margemValor - a.margemValor)[0]
  const topDev = [...skusDevolvidos].sort((a, b) => b.devolucaoValor - a.devolucaoValor)[0]
  const taxaMediaDev = linhas.length
    ? linhas.reduce((s, l) => s + l.devolucaoValor, 0) / Math.max(1, linhas.reduce((s, l) => s + l.faturamento, 0))
    : 0

  const cards = [
    { titulo: "SKUs vendidos", valor: formatNumero(linhas.length), icone: Boxes, destaque: "default" as const, tooltip: "Quantos códigos de produto diferentes tiveram venda no período." },
    { titulo: "SKUs com devolução", valor: formatNumero(skusDevolvidos.length), icone: PackageX, destaque: "alerta" as const, tooltip: "Quantos códigos de produto diferentes apareceram em devoluções no período." },
    { titulo: "SKUs sem custo", valor: formatNumero(semCusto.length), icone: AlertTriangle, destaque: "alerta" as const, tooltip: "Pedidos sem custo de produto cadastrado na Olist. A margem fica otimista nesses casos." },
    { titulo: "Taxa média de devolução", valor: formatPercent(taxaMediaDev), icone: Percent, destaque: "default" as const, tooltip: "Percentual do faturamento que voltou como devolução. Quanto maior, maior o impacto no resultado." },
    { titulo: "Top faturamento", valor: topFat?.sku ?? "—", icone: Trophy, destaque: "positivo" as const, legenda: topFat ? formatBRL(topFat.faturamento) : undefined },
    { titulo: "Top quantidade", valor: topQtd?.sku ?? "—", icone: Trophy, destaque: "default" as const, legenda: topQtd ? `${formatNumero(topQtd.qtdVendida)} un.` : undefined },
    { titulo: "Top margem", valor: topMargem?.sku ?? "—", icone: Trophy, destaque: "positivo" as const, legenda: topMargem ? formatBRL(topMargem.margemValor) : undefined },
    { titulo: "Top devolução", valor: topDev?.sku ?? "—", icone: Trophy, destaque: "alerta" as const, legenda: topDev ? formatBRL(topDev.devolucaoValor) : undefined },
  ]

  const colunas: ColumnDef<LinhaSku, unknown>[] = [
    { accessorKey: "sku", header: "SKU", cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span> },
    { accessorKey: "produto", header: "Produto", cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.produto}</span> },
    { accessorKey: "qtdVendida", header: "Qtd", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.qtdVendida)}</span> },
    { accessorKey: "qtdDevolvida", header: "Qtd dev.", cell: ({ row }) => <span className="tabular-nums">{row.original.qtdDevolvida || "—"}</span> },
    { accessorKey: "faturamento", header: "Faturamento", cell: ({ row }) => <span className="tabular-nums font-medium">{formatBRL(row.original.faturamento)}</span> },
    { accessorKey: "devolucaoValor", header: "Devolução", cell: ({ row }) => <span className="tabular-nums">{row.original.devolucaoValor ? formatBRL(row.original.devolucaoValor) : "—"}</span> },
    { accessorKey: "margemValor", header: "Margem R$", cell: ({ row }) => <span className="tabular-nums font-medium">{formatBRL(row.original.margemValor)}</span> },
    { accessorKey: "margemPct", header: "Margem %", cell: ({ row }) => <span className="tabular-nums">{formatPercent(row.original.margemPct)}</span> },
    { accessorKey: "markup", header: "Markup", cell: ({ row }) => <span className="tabular-nums">{formatMarkup(row.original.markup)}</span> },
    { accessorKey: "pedidos", header: "Pedidos", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.pedidos)}</span> },
    {
      id: "alertas",
      header: "Alertas",
      cell: ({ row }) =>
        row.original.alertas.length ? (
          <div className="flex gap-1">
            {row.original.alertas.map((a) => (
              <Badge key={a} variant="outline" className="border-warning/50 bg-warning/10 text-[10px] text-warning-foreground">
                {ALERTA_CURTO[a]}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <>
      <PageTitle
        titulo="Produtos e SKUs"
        descricao="Venda, devolução e margem por SKU — clique em uma linha para abrir o detalhe."
      />
      <GlobalFilters />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.titulo} {...c} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopSkusChart linhas={linhas} titulo="Top SKUs por faturamento" descricao="10 maiores no período" metrica="faturamento" />
        <TopSkusChart linhas={linhas} titulo="Top SKUs devolvidos" descricao="10 maiores valores devolvidos" metrica="devolucaoValor" />
      </section>

      <MatrizFaturamentoMargemChart linhas={linhas} />

      <Card className="gap-0 overflow-hidden p-0">
        <DataTable
          tableId="produtos"
          columns={colunas}
          data={linhas}
          buscaPlaceholder="Buscar SKU ou produto"
          onRowClick={setSelecionado}
          destacarLinha={(l) => l.alertas.length > 0}
          vazio="Nenhum SKU no período/filtros selecionados."
          csv={{
            nome: "produtos-skus",
            linhas: (rows) =>
              rows.map((l) => ({
                SKU: l.sku, Produto: l.produto, Canais: l.canais.join(", "),
                "Qtd vendida": l.qtdVendida, "Qtd devolvida": l.qtdDevolvida, Pedidos: l.pedidos,
                Faturamento: l.faturamento, "Devolução R$": l.devolucaoValor, "Faturamento líquido": l.faturamentoLiquido,
                Custo: l.custoTotal, "Taxas rateadas": l.taxaAlocada, "Frete rateado": l.freteAlocado,
                "Margem R$": l.margemValor, "Margem %": l.margemPct, Markup: l.markup,
                "Ticket médio": l.ticketMedio, "Taxa devolução": l.taxaDevolucao,
                Alertas: l.alertas.join("|"),
              })),
          }}
          rodape={(rows) => (
            <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
              <span className="text-muted-foreground">
                SKUs: <span className="font-semibold text-foreground">{formatNumero(rows.length)}</span>
              </span>
              <span className="text-muted-foreground">
                Faturamento: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, l) => s + l.faturamento, 0))}</span>
              </span>
              <span className="text-muted-foreground">
                Margem: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, l) => s + l.margemValor, 0))}</span>
              </span>
            </div>
          )}
        />
      </Card>

      <SkuDrawer linha={selecionado} pedidos={pedidosFiltrados} aberto={Boolean(selecionado)} onClose={() => setSelecionado(null)} />
    </>
  )
}
