"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { InfoTooltip } from "@/components/dashboard/info-tooltip"
import { formatBRL, formatBRLCompacto, formatData, formatMarkup, formatNumero, formatPercent, type Pedido } from "@/lib/data"
import { skuPorMes, type LinhaSku } from "@/lib/sku-analytics"

const ALERTA_LABEL: Record<string, string> = {
  "sem-custo": "Sem custo cadastrado",
  "alta-devolucao": "Alta devolução",
  "margem-baixa": "Margem baixa",
}

const mensalConfig = {
  faturamento: { label: "Faturamento", color: "var(--chart-1)" },
  devolucao: { label: "Devolução", color: "var(--chart-3)" },
} satisfies ChartConfig

export function SkuDrawer({
  linha,
  pedidos,
  aberto,
  onClose,
}: {
  linha: LinhaSku | null
  pedidos: Pedido[]
  aberto: boolean
  onClose: () => void
}) {
  if (!linha) return null

  const meses = skuPorMes(linha.sku, pedidos).map((m) => ({ ...m, label: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}` }))
  const pedidosDoSku = pedidos
    .filter((p) => p.sku === linha.sku || p.itens?.some((i) => i.sku === linha.sku))
    .slice(0, 20)

  const composicao = [
    { rotulo: "Faturamento bruto", valor: linha.faturamento },
    { rotulo: "(−) Devoluções", valor: -linha.devolucaoValor },
    { rotulo: "(−) Custo do produto", valor: -linha.custoTotal },
    { rotulo: "(−) Taxas de marketplace (rateadas)", valor: -linha.taxaAlocada },
    { rotulo: "(−) Frete (rateado)", valor: -linha.freteAlocado },
    { rotulo: "= Margem de contribuição", valor: linha.margemValor },
  ]

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{linha.sku}</SheetTitle>
          <SheetDescription className="text-pretty">{linha.produto}</SheetDescription>
          <div className="flex flex-wrap gap-1.5">
            {linha.canais.map((c) => (
              <Badge key={c} variant="secondary">{c}</Badge>
            ))}
            {linha.alertas.map((a) => (
              <Badge key={a} variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">
                {ALERTA_LABEL[a]}
              </Badge>
            ))}
          </div>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
          <Metrica rotulo="Faturamento" valor={formatBRL(linha.faturamento)} />
          <Metrica rotulo="Margem" valor={formatBRL(linha.margemValor)} />
          <Metrica rotulo="Margem %" valor={formatPercent(linha.margemPct)} />
          <Metrica rotulo="Qtd. vendida" valor={formatNumero(linha.qtdVendida)} />
          <Metrica rotulo="Qtd. devolvida" valor={formatNumero(linha.qtdDevolvida)} />
          <Metrica rotulo="Markup" valor={formatMarkup(linha.markup)} />
        </div>

        <Separator className="my-2" />

        <div className="px-4">
          <h3 className="mb-2 text-sm font-semibold">Vendas × devoluções por mês</h3>
          {meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem histórico no período carregado.</p>
          ) : (
            <ChartContainer config={mensalConfig} className="aspect-auto h-[180px] w-full">
              <BarChart data={meses}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={68} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatBRLCompacto(Number(v))} />} />
                <Bar dataKey="faturamento" fill="var(--color-faturamento)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="devolucao" fill="var(--color-devolucao)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </div>

        <Separator className="my-2" />

        <div className="px-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Composição do cálculo
            <InfoTooltip texto="Taxas e frete são rateados entre os itens de cada pedido proporcionalmente ao valor. Pedidos sem custo cadastrado entram com custo 0 (margem otimista)." />
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

        <Separator className="my-2" />

        <div className="px-4 pb-6">
          <h3 className="mb-2 text-sm font-semibold">Pedidos recentes com este SKU</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosDoSku.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.numeroPedido}</TableCell>
                  <TableCell className="text-muted-foreground">{formatData(p.data)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.canal}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(p.valorVenda)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-sm font-semibold tabular-nums">{valor}</div>
    </div>
  )
}
