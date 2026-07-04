"use client"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusPagamentoBadge } from "@/components/dashboard/badges"
import { InfoTooltip } from "@/components/dashboard/info-tooltip"
import {
  formatBRL,
  formatData,
  formatNumero,
  lucroBrutoPedido,
  taxaComissaoEfetiva,
  type Pedido,
} from "@/lib/data"

export function PedidoDrawer({
  pedido,
  aberto,
  onClose,
}: {
  pedido: Pedido | null
  aberto: boolean
  onClose: () => void
}) {
  if (!pedido) return null

  const taxa = taxaComissaoEfetiva(pedido)
  const composicao = [
    { rotulo: "Valor da venda", valor: pedido.valorVenda },
    { rotulo: "(−) Devolução", valor: -pedido.devolucao },
    { rotulo: "(−) Custo do produto", valor: -pedido.custoTotal },
    { rotulo: `(−) Taxa marketplace${pedido.custoMlReal ? " (real ML)" : " (estimada)"}`, valor: -taxa },
    { rotulo: `(−) Frete${pedido.custoMlReal ? " (real ML)" : ""}`, valor: -pedido.valorFrete },
    { rotulo: "= Margem de contribuição", valor: lucroBrutoPedido(pedido) },
  ]

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Pedido {pedido.numeroPedido}</SheetTitle>
          <SheetDescription>
            {formatData(pedido.data)} · {pedido.canal} · {pedido.vendedor}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPagamentoBadge status={pedido.statusPagamento} />
            {pedido.numeroNF !== "-" && <Badge variant="secondary">NF {pedido.numeroNF}</Badge>}
            {pedido.devolucao > 0 && (
              <Badge variant="outline" className="border-destructive/50 bg-destructive/10 text-destructive">
                Devolvido
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="px-4">
          <h3 className="mb-2 text-sm font-semibold">Itens</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Valor un.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pedido.itens?.length ? pedido.itens : [{ sku: pedido.sku, descricao: pedido.produto, quantidade: pedido.quantidade, valorUnitario: pedido.valorVenda / Math.max(1, pedido.quantidade), custoUnitario: 0 }]).map((item, i) => (
                <TableRow key={`${item.sku}:${i}`}>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="max-w-48 truncate">{item.descricao}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(item.quantidade)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(item.valorUnitario)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Separator className="my-2" />

        <div className="px-4 pb-6">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Composição da margem
            {pedido.devolucao > 0 && (
              <InfoTooltip texto="Em pedidos devolvidos, a tarifa e o frete podem ter sido reembolsados pelo Mercado Livre — a margem aqui é o cenário mais conservador." />
            )}
          </h3>
          <div className="rounded-lg border border-border">
            {composicao.map((c, i) => (
              <div
                key={c.rotulo}
                className={`flex items-center justify-between px-3 py-2 text-sm ${i === composicao.length - 1 ? "bg-muted/40 font-semibold" : ""} ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="text-muted-foreground">{c.rotulo}</span>
                <span className="tabular-nums">{formatBRL(c.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
