"use client"

import { useMemo, useState } from "react"
import { Boxes, PackageX, Receipt, RotateCcw, Undo2, Percent } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Card } from "@/components/ui/card"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { DataTable } from "@/components/dashboard/data-table"
import { PedidoDrawer } from "@/components/dashboard/pedido-drawer"
import { DevolucaoMensalChart, DevolucaoPorCanalChart } from "@/components/dashboard/devolucao-charts"
import { TopSkusChart } from "@/components/dashboard/sku-charts"
import { useFiltros } from "@/lib/filters"
import { agregarPorSku } from "@/lib/sku-analytics"
import { calcularKpisDevolucao, devolucaoPorCanal, devolucaoPorMes } from "@/lib/devolucao-analytics"
import { formatBRL, formatData, formatNumero, formatPercent, type Pedido } from "@/lib/data"

export default function DevolucoesPage() {
  const { pedidosFiltrados } = useFiltros()
  const kpis = useMemo(() => calcularKpisDevolucao(pedidosFiltrados), [pedidosFiltrados])
  const meses = useMemo(() => devolucaoPorMes(pedidosFiltrados), [pedidosFiltrados])
  const canais = useMemo(() => devolucaoPorCanal(pedidosFiltrados), [pedidosFiltrados])
  const linhasSku = useMemo(() => agregarPorSku(pedidosFiltrados), [pedidosFiltrados])
  const devolvidos = useMemo(() => pedidosFiltrados.filter((p) => p.devolucao > 0), [pedidosFiltrados])
  const [selecionado, setSelecionado] = useState<Pedido | null>(null)

  const cards = [
    { titulo: "Devoluções", valor: formatNumero(kpis.pedidosDevolvidos), icone: Undo2, destaque: "alerta" as const, tooltip: "Pedido cancelado na Olist conta como devolução total. O valor aparece no mês da venda original, não no mês do cancelamento." },
    { titulo: "Itens devolvidos", valor: formatNumero(kpis.itensDevolvidos), icone: PackageX, destaque: "default" as const, tooltip: "Quantidade total de unidades nos pedidos devolvidos. Um pedido pode ter mais de um item." },
    { titulo: "SKUs devolvidos", valor: formatNumero(kpis.skusDevolvidos), icone: Boxes, destaque: "default" as const, tooltip: "Quantos códigos de produto diferentes apareceram em devoluções no período." },
    { titulo: "Valor devolvido", valor: formatBRL(kpis.valorDevolvido), icone: RotateCcw, destaque: "alerta" as const, tooltip: "Soma do valor dos pedidos devolvidos no período." },
    { titulo: "Taxa de devolução", valor: formatPercent(kpis.taxaDevolucao), icone: Percent, destaque: "alerta" as const, tooltip: "Percentual do faturamento que voltou como devolução. Quanto maior, maior o impacto no resultado." },
    { titulo: "Ticket médio devolvido", valor: formatBRL(kpis.ticketMedioDevolucao), icone: Receipt, destaque: "default" as const, tooltip: "Valor médio por pedido devolvido no período." },
  ]

  const colunas: ColumnDef<Pedido, unknown>[] = [
    { accessorKey: "data", header: "Data", cell: ({ row }) => <span className="tabular-nums">{formatData(row.original.data)}</span> },
    { accessorKey: "numeroPedido", header: "Pedido", cell: ({ row }) => <span className="font-medium">{row.original.numeroPedido}</span> },
    { accessorKey: "numeroNF", header: "NF", cell: ({ row }) => <span className="text-muted-foreground">{row.original.numeroNF}</span> },
    { accessorKey: "canal", header: "Canal" },
    { accessorKey: "vendedor", header: "Vendedor", cell: ({ row }) => <span className="text-muted-foreground">{row.original.vendedor}</span> },
    { accessorKey: "produto", header: "Produto", cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.produto}</span> },
    { accessorKey: "quantidade", header: "Itens", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.quantidade)}</span> },
    { accessorKey: "devolucao", header: "Valor devolvido", cell: ({ row }) => <span className="tabular-nums font-medium text-destructive">{formatBRL(row.original.devolucao)}</span> },
  ]

  return (
    <>
      <PageTitle
        titulo="Devoluções"
        descricao="Impacto das devoluções por mês, canal e SKU — clique em um pedido para ver o detalhe."
      />
      <GlobalFilters />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <KpiCard key={c.titulo} {...c} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DevolucaoMensalChart meses={meses} />
        <DevolucaoPorCanalChart canais={canais} />
      </section>

      <TopSkusChart linhas={linhasSku} titulo="Top SKUs devolvidos" descricao="10 maiores valores devolvidos no período" metrica="devolucaoValor" />

      <Card className="gap-0 overflow-hidden p-0">
        <DataTable
          columns={colunas}
          data={devolvidos}
          buscaPlaceholder="Buscar pedido, NF, produto..."
          onRowClick={setSelecionado}
          vazio="Nenhuma devolução no período — bom sinal 👍"
          csv={{
            nome: "devolucoes",
            linhas: (rows) =>
              rows.map((p) => ({
                Data: p.data, Pedido: p.numeroPedido, NF: p.numeroNF, Canal: p.canal,
                Vendedor: p.vendedor, Produto: p.produto, SKU: p.sku,
                Itens: p.quantidade, "Valor vendido": p.valorVenda, "Valor devolvido": p.devolucao,
              })),
          }}
          rodape={(rows) => (
            <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
              <span className="text-muted-foreground">
                Pedidos: <span className="font-semibold text-foreground">{formatNumero(rows.length)}</span>
              </span>
              <span className="text-muted-foreground">
                Valor devolvido: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, p) => s + p.devolucao, 0))}</span>
              </span>
            </div>
          )}
        />
      </Card>

      <PedidoDrawer pedido={selecionado} aberto={Boolean(selecionado)} onClose={() => setSelecionado(null)} />
    </>
  )
}
