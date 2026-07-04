"use client"

import { useMemo } from "react"
import { ShoppingCart, DollarSign, Truck, Undo2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { StatusPagamentoBadge } from "@/components/dashboard/badges"
import { DataTable } from "@/components/dashboard/data-table"
import { Card } from "@/components/ui/card"
import { useFiltros } from "@/lib/filters"
import { formatBRL, formatData, formatNumero, type Pedido } from "@/lib/data"

export default function PedidosPage() {
  const { pedidosFiltrados } = useFiltros()

  const subtotais = useMemo(
    () => ({
      pedidos: pedidosFiltrados.length,
      faturamento: pedidosFiltrados.reduce((s, p) => s + p.valorVenda, 0),
      frete: pedidosFiltrados.reduce((s, p) => s + p.valorFrete, 0),
      devolucoes: pedidosFiltrados.reduce((s, p) => s + p.devolucao, 0),
    }),
    [pedidosFiltrados],
  )

  const resumo = [
    { titulo: "Quantidade de pedidos", valor: formatNumero(subtotais.pedidos), icone: ShoppingCart },
    { titulo: "Faturamento bruto", valor: formatBRL(subtotais.faturamento), icone: DollarSign },
    { titulo: "Total de frete", valor: formatBRL(subtotais.frete), icone: Truck },
    { titulo: "Total de devoluções", valor: formatBRL(subtotais.devolucoes), icone: Undo2 },
  ]

  const colunas: ColumnDef<Pedido, unknown>[] = [
    { accessorKey: "numeroPedido", header: "Nº pedido", cell: ({ row }) => <span className="font-medium text-foreground">{row.original.numeroPedido}</span> },
    { accessorKey: "numeroNF", header: "Nº NF", cell: ({ row }) => <span className="text-muted-foreground">{row.original.numeroNF}</span> },
    { accessorKey: "sku", header: "SKU", cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span> },
    { accessorKey: "produto", header: "Produto", cell: ({ row }) => <span className="block min-w-[180px] text-foreground">{row.original.produto}</span> },
    { accessorKey: "formaPagamento", header: "Pagamento", meta: { filtro: "select" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.formaPagamento}</span> },
    { accessorKey: "valorVenda", header: "Valor da venda", meta: { alinhar: "right" }, cell: ({ row }) => <span className="tabular-nums font-medium">{formatBRL(row.original.valorVenda)}</span> },
    { accessorKey: "valorFrete", header: "Frete", meta: { alinhar: "right" }, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatBRL(row.original.valorFrete)}</span> },
    { accessorKey: "devolucao", header: "Devoluções", meta: { alinhar: "right" }, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.devolucao > 0 ? formatBRL(row.original.devolucao) : "—"}</span> },
    { accessorKey: "statusPagamento", header: "Status", meta: { filtro: "select", rotulo: "Status" }, cell: ({ row }) => <StatusPagamentoBadge status={row.original.statusPagamento} /> },
    { accessorKey: "data", header: "Data", meta: { alinhar: "right" }, cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{formatData(row.original.data)}</span> },
  ]

  return (
    <>
      <PageTitle
        titulo="Pedidos e Notas Fiscais"
        descricao="Conferência diária de vendas e confirmação de pagamentos por pedido e NF."
      />

      <GlobalFilters />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {resumo.map((r) => (
          <Card key={r.titulo} className="flex-row items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <r.icone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs text-muted-foreground">{r.titulo}</div>
              <div className="truncate text-lg font-semibold text-foreground">{r.valor}</div>
            </div>
          </Card>
        ))}
      </section>

      <Card className="gap-0 overflow-hidden p-0">
        <DataTable
          tableId="pedidos"
          columns={colunas}
          data={pedidosFiltrados}
          buscaPlaceholder="Buscar pedido, NF, SKU ou produto"
          vazio="Nenhum pedido encontrado para os filtros selecionados."
          csv={{
            nome: "pedidos",
            linhas: (rows) =>
              rows.map((p) => ({
                "Nº pedido": p.numeroPedido, "Nº NF": p.numeroNF, SKU: p.sku, Produto: p.produto,
                Canal: p.canal, Vendedor: p.vendedor, Pagamento: p.formaPagamento,
                "Valor da venda": p.valorVenda, Frete: p.valorFrete, Devoluções: p.devolucao,
                Status: p.statusPagamento, Data: p.data,
              })),
          }}
          rodape={(rows) => {
            const t = {
              pedidos: rows.length,
              faturamento: rows.reduce((s, p) => s + p.valorVenda, 0),
              frete: rows.reduce((s, p) => s + p.valorFrete, 0),
              devolucoes: rows.reduce((s, p) => s + p.devolucao, 0),
            }
            return (
              <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
                <span className="text-muted-foreground">
                  Pedidos: <span className="font-semibold text-foreground">{formatNumero(t.pedidos)}</span>
                </span>
                <span className="text-muted-foreground">
                  Faturamento: <span className="font-semibold text-foreground tabular-nums">{formatBRL(t.faturamento)}</span>
                </span>
                <span className="text-muted-foreground">
                  Frete: <span className="font-semibold text-foreground tabular-nums">{formatBRL(t.frete)}</span>
                </span>
                <span className="text-muted-foreground">
                  Devoluções: <span className="font-semibold text-foreground tabular-nums">{formatBRL(t.devolucoes)}</span>
                </span>
              </div>
            )
          }}
        />
      </Card>
    </>
  )
}
