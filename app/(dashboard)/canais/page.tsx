"use client"

import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { CanalBarChart } from "@/components/dashboard/overview-charts"
import { MargemCanalChart, TicketPorCanalChart } from "@/components/dashboard/canais-charts"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useFiltros } from "@/lib/filters"
import { agregarPorCanalVendedor, formatBRL, formatNumero, formatPercent } from "@/lib/data"

export default function CanaisPage() {
  const { pedidosFiltrados } = useFiltros()
  const linhas = agregarPorCanalVendedor(pedidosFiltrados)

  return (
    <>
      <PageTitle
        titulo="Canais e Vendedores"
        descricao="Desempenho por canal de venda e por vendedor, com comissões, taxas e margens."
      />

      <GlobalFilters />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CanalBarChart pedidos={pedidosFiltrados} />
        <TicketPorCanalChart pedidos={pedidosFiltrados} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MargemCanalChart pedidos={pedidosFiltrados} />

        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-b border-border p-4">
            <h2 className="text-sm font-semibold text-foreground">Resumo por canal e vendedor</h2>
            <p className="text-xs text-muted-foreground">Ordenado por faturamento</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Canal</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead className="text-right">Taxa marketplace</TableHead>
                  <TableHead className="text-right">% M.C.</TableHead>
                  <TableHead className="text-right">M.C. (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={`${l.canal}-${l.vendedor}`}>
                    <TableCell className="font-medium text-foreground">{l.canal}</TableCell>
                    <TableCell className="text-muted-foreground">{l.vendedor}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumero(l.quantidadeVendas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(l.ticketMedio)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.taxaMarketplace > 0 ? formatBRL(l.taxaMarketplace) : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums font-medium",
                        l.margem >= 0.2 ? "text-success" : "text-warning-foreground",
                      )}
                    >
                      {formatPercent(l.margem)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatBRL(l.lucroBruto)}</TableCell>
                  </TableRow>
                ))}
                {linhas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Nenhum dado para os filtros selecionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </section>
    </>
  )
}
