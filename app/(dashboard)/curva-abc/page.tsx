"use client"

import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { ClasseABCBadge } from "@/components/dashboard/badges"
import { DistribuicaoClassesChart, TopProdutosChart } from "@/components/dashboard/abc-charts"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useFiltros } from "@/lib/filters"
import { calcularCurvaABC, formatBRL, formatMarkup, formatNumero, formatPercent } from "@/lib/data"

const legendas = [
  { classe: "A" as const, texto: "Até 80% do faturamento acumulado" },
  { classe: "B" as const, texto: "Entre 80% e 95% acumulado" },
  { classe: "C" as const, texto: "Acima de 95% acumulado" },
]

export default function CurvaABCPage() {
  const { pedidosFiltrados } = useFiltros()
  const linhas = calcularCurvaABC(pedidosFiltrados)

  return (
    <>
      <PageTitle
        titulo="Curva ABC de Produtos"
        descricao="Classificação de produtos por participação no faturamento acumulado."
      />

      <GlobalFilters />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {legendas.map((l) => {
          const itens = linhas.filter((x) => x.classe === l.classe)
          const fat = itens.reduce((s, x) => s + x.valorVendido, 0)
          const totalFat = linhas.reduce((s, x) => s + x.valorVendido, 0)
          return (
            <Card key={l.classe} className="gap-2 p-4">
              <div className="flex items-center gap-2">
                <ClasseABCBadge classe={l.classe} />
                <span className="text-sm font-medium text-foreground">Classe {l.classe}</span>
              </div>
              <p className="text-xs text-muted-foreground">{l.texto}</p>
              <div className="mt-1 text-xl font-semibold text-foreground">{formatNumero(itens.length)} SKUs</div>
              <Progress value={totalFat ? (fat / totalFat) * 100 : 0} className="h-1.5" />
              <span className="text-xs text-muted-foreground">{formatPercent(totalFat ? fat / totalFat : 0)} do faturamento</span>
            </Card>
          )
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopProdutosChart linhas={linhas} />
        <DistribuicaoClassesChart linhas={linhas} />
      </section>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold text-foreground">Detalhamento da curva ABC</h2>
          <p className="text-xs text-muted-foreground">Produtos ordenados por valor vendido</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>Classe</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="min-w-[180px]">Produto</TableHead>
                <TableHead className="text-right">Qtd. vendida</TableHead>
                <TableHead className="text-right">Valor vendido</TableHead>
                <TableHead className="text-right">Custo médio</TableHead>
                <TableHead className="text-right">% M.C.</TableHead>
                <TableHead className="text-right">M.C. (R$)</TableHead>
                <TableHead className="text-right">Markup</TableHead>
                <TableHead className="text-right">% Acum.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.sku}>
                  <TableCell>
                    <ClasseABCBadge classe={l.classe} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{l.sku}</TableCell>
                  <TableCell className="text-foreground">{l.produto}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(l.quantidadeVendida)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatBRL(l.valorVendido)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatBRL(l.custoMedio)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(l.margem)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatBRL(l.lucroBruto)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatMarkup(l.markup)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatPercent(l.participacaoAcumulada)}</TableCell>
                </TableRow>
              ))}
              {linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                    Nenhum produto para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </>
  )
}
