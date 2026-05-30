"use client"

import { useMemo, useState } from "react"
import { Search, ShoppingCart, DollarSign, Truck, Undo2 } from "lucide-react"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { StatusPagamentoBadge } from "@/components/dashboard/badges"
import { SortableHead, useOrdenacao } from "@/components/dashboard/sortable"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useFiltros } from "@/lib/filters"
import { formatBRL, formatData, formatNumero } from "@/lib/data"

type CampoPedido =
  | "numeroPedido"
  | "numeroNF"
  | "sku"
  | "produto"
  | "formaPagamento"
  | "valorVenda"
  | "valorFrete"
  | "devolucao"
  | "statusPagamento"
  | "data"

export default function PedidosPage() {
  const { pedidosFiltrados } = useFiltros()
  const [busca, setBusca] = useState("")

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return pedidosFiltrados
    return pedidosFiltrados.filter((p) =>
      [p.numeroPedido, p.numeroNF, p.sku, p.produto, p.formaPagamento, p.vendedor]
        .join(" ")
        .toLowerCase()
        .includes(termo),
    )
  }, [pedidosFiltrados, busca])

  const { ordenadas, ordenacao } = useOrdenacao(
    linhas,
    (p, campo: CampoPedido) => {
      switch (campo) {
        case "numeroPedido":
          return p.numeroPedido
        case "numeroNF":
          return p.numeroNF
        case "sku":
          return p.sku
        case "produto":
          return p.produto
        case "formaPagamento":
          return p.formaPagamento
        case "valorVenda":
          return p.valorVenda
        case "valorFrete":
          return p.valorFrete
        case "devolucao":
          return p.devolucao
        case "statusPagamento":
          return p.statusPagamento
        case "data":
          return p.data
        default:
          return ""
      }
    },
    "data" as CampoPedido,
  )

  const subtotais = useMemo(
    () => ({
      pedidos: linhas.length,
      faturamento: linhas.reduce((s, p) => s + p.valorVenda, 0),
      frete: linhas.reduce((s, p) => s + p.valorFrete, 0),
      devolucoes: linhas.reduce((s, p) => s + p.devolucao, 0),
    }),
    [linhas],
  )

  const resumo = [
    { titulo: "Quantidade de pedidos", valor: formatNumero(subtotais.pedidos), icone: ShoppingCart },
    { titulo: "Faturamento bruto", valor: formatBRL(subtotais.faturamento), icone: DollarSign },
    { titulo: "Total de frete", valor: formatBRL(subtotais.frete), icone: Truck },
    { titulo: "Total de devoluções", valor: formatBRL(subtotais.devolucoes), icone: Undo2 },
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
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Relatório de pedidos</h2>
            <p className="text-xs text-muted-foreground">{formatNumero(linhas.length)} registros encontrados</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pedido, NF, SKU ou produto"
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <SortableHead campo="numeroPedido" ordenacao={ordenacao}>Nº pedido</SortableHead>
                <SortableHead campo="numeroNF" ordenacao={ordenacao}>Nº NF</SortableHead>
                <SortableHead campo="sku" ordenacao={ordenacao}>SKU</SortableHead>
                <SortableHead campo="produto" ordenacao={ordenacao} className="min-w-[180px]">Produto</SortableHead>
                <SortableHead campo="formaPagamento" ordenacao={ordenacao}>Pagamento</SortableHead>
                <SortableHead campo="valorVenda" ordenacao={ordenacao} alinhar="right">Valor da venda</SortableHead>
                <SortableHead campo="valorFrete" ordenacao={ordenacao} alinhar="right">Frete</SortableHead>
                <SortableHead campo="devolucao" ordenacao={ordenacao} alinhar="right">Devoluções</SortableHead>
                <SortableHead campo="statusPagamento" ordenacao={ordenacao}>Status</SortableHead>
                <SortableHead campo="data" ordenacao={ordenacao} alinhar="right">Data</SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenadas.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">{p.numeroPedido}</TableCell>
                  <TableCell className="text-muted-foreground">{p.numeroNF}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                  <TableCell className="text-foreground">{p.produto}</TableCell>
                  <TableCell className="text-muted-foreground">{p.formaPagamento}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatBRL(p.valorVenda)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatBRL(p.valorFrete)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {p.devolucao > 0 ? formatBRL(p.devolucao) : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusPagamentoBadge status={p.statusPagamento} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatData(p.data)}</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                    Nenhum pedido encontrado para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {linhas.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 border-t border-border bg-muted/30 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Pedidos: <span className="font-semibold text-foreground">{formatNumero(subtotais.pedidos)}</span>
            </span>
            <span className="text-muted-foreground">
              Faturamento: <span className="font-semibold text-foreground tabular-nums">{formatBRL(subtotais.faturamento)}</span>
            </span>
            <span className="text-muted-foreground">
              Frete: <span className="font-semibold text-foreground tabular-nums">{formatBRL(subtotais.frete)}</span>
            </span>
            <span className="text-muted-foreground">
              Devoluções: <span className="font-semibold text-foreground tabular-nums">{formatBRL(subtotais.devolucoes)}</span>
            </span>
          </div>
        )}
      </Card>
    </>
  )
}
