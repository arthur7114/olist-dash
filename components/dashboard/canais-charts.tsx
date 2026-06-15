"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import {
  agregarPorCanal,
  agregarPorCanalVendedor,
  formatBRLCompacto,
  formatPercent,
  type Pedido,
} from "@/lib/data"

const ticketConfig = {
  ticketMedio: { label: "Ticket médio", color: "var(--chart-1)" },
} satisfies ChartConfig

const margemConfig = {
  margem: { label: "M.C.", color: "var(--chart-2)" },
} satisfies ChartConfig

export function TicketPorCanalChart({ pedidos }: { pedidos: Pedido[] }) {
  const mapa = new Map<string, { canal: string; faturamento: number; qtd: number }>()
  for (const l of agregarPorCanalVendedor(pedidos)) {
    const atual = mapa.get(l.canal) ?? { canal: l.canal, faturamento: 0, qtd: 0 }
    atual.faturamento += l.faturamento
    atual.qtd += l.quantidadeVendas
    mapa.set(l.canal, atual)
  }
  const dados = Array.from(mapa.values())
    .map((c) => ({ canal: c.canal.replace("Vendedor ", "Vend. "), ticketMedio: c.qtd ? Math.round(c.faturamento / c.qtd) : 0 }))
    .sort((a, b) => b.ticketMedio - a.ticketMedio)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket médio por canal</CardTitle>
        <CardDescription>Valor médio por venda em cada canal</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={ticketConfig} className="aspect-auto h-[260px] w-full">
          <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis type="category" dataKey="canal" tickLine={false} axisLine={false} width={90} fontSize={11} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => <span className="font-medium">{formatBRLCompacto(Number(v))}</span>} />}
            />
            <Bar dataKey="ticketMedio" fill="var(--color-ticketMedio)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function MargemCanalChart({ pedidos }: { pedidos: Pedido[] }) {
  const dados = agregarPorCanal(pedidos)
    .map((c) => ({
      canal: c.canal.replace("Vendedor ", "Vend. "),
      margem: c.faturamento ? Math.round((c.lucroBruto / c.faturamento) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.margem - a.margem)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Margem de contribuição por canal</CardTitle>
        <CardDescription>M.C. percentual praticada em cada canal</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={margemConfig} className="aspect-auto h-[260px] w-full">
          <BarChart data={dados} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="canal" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={0} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => formatPercent(Number(v), 0)} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => <span className="font-medium">{formatPercent(Number(v))}</span>} />}
            />
            <Bar dataKey="margem" radius={[4, 4, 0, 0]}>
              {dados.map((d, i) => (
                <Cell key={i} fill={d.margem >= 0.25 ? "var(--chart-1)" : "var(--chart-3)"} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
