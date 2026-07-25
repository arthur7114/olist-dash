import { SITUACAO_CANCELADO, SITUACAO_ENTREGUE, SITUACAO_LABEL, SITUACOES_PAGAS } from "@/lib/data"
import { toNumber, type TinyOrderDetail } from "@/lib/olist-v3"

// ----------------------------------------------------------------------------
// Reconciliação dash × Olist
//
// Quando os números do dash não batem com a tela da Olist, a pergunta é sempre
// "batem com QUAL definição?". A Olist expõe vários totais por pedido e o dash
// escolhe um deles (hoje: valorTotalProdutos — ver getValorVenda em olist-v3.ts).
// Este relatório soma a MESMA janela sob todas as definições, quebrado por
// situação, para identificar a divergência por comparação direta em vez de
// palpite. É só leitura — não corrige nada.
// ----------------------------------------------------------------------------

export type ReconcileRow = {
  olistId: string
  data: string
  situacao: number | null
  valorVenda: number // base atual do dash (coluna valor_venda)
  valorNota: number | null
  updatedAt: string // ISO — última vez que o sync tocou o pedido
  raw: unknown
}

// Um pedido "liquidado" não muda mais na Olist; qualquer outro ainda pode ganhar NF,
// trocar de situação ou mudar de valor. Mesma regra da cláusula de liquidação em
// getBackfillSkipIds (orders.ts) — se mudar lá, mude aqui.
export function pedidoLiquidado(row: Pick<ReconcileRow, "situacao" | "valorNota">): boolean {
  if (row.situacao === SITUACAO_CANCELADO) return true
  return row.situacao === SITUACAO_ENTREGUE && row.valorNota != null
}

// Frescor dos dados da janela. Existe porque a divergência com a Olist já foi causada
// por pedido congelado: o sync gravava o pedido uma vez e o backfill o pulava para
// sempre, então situação/valor/NF paravam no estado de ~48h de idade.
export type Frescor = {
  naoLiquidados: number // ainda podem mudar na Olist
  congelados: number // não liquidados e sem sync há mais de `diasCongelado` dias
  diasCongelado: number
  updatedAtMin: string | null
  updatedAtMax: string | null
}

// Cada campo é uma definição candidata de "faturamento" do período.
export type Totais = {
  pedidos: number
  valorVenda: number // o que o dash soma hoje
  valorTotalProdutos: number // subtotal dos produtos, sem frete/desconto
  valorTotalPedido: number // total do pedido — o que a tela da Olist mostra
  valorListagem: number // campo `valor` da listagem de pedidos
  valorNota: number // soma das NFs emitidas (base do toggle "valor de NF")
  frete: number
  desconto: number
  outrasDespesas: number
  semRaw: number // pedidos sem detalhe salvo (só valorVenda é confiável)
  semNota: number // pedidos sem valor de NF (subcontam o modo "valor de NF")
}

export type LinhaSituacao = {
  situacao: number | null
  label: string
  pedidos: number
  valorVenda: number
  valorTotalPedido: number
}

export type Divergencia = {
  olistId: string
  data: string
  situacao: number | null
  valorVenda: number
  valorTotalPedido: number
  frete: number
  desconto: number
  diferenca: number // valorTotalPedido − valorVenda
}

export type ReconcileReport = {
  janela: { de: string; ate: string }
  dataMin: string | null
  dataMax: string | null
  frescor: Frescor
  // Todos os pedidos da janela — o recorte que o dash usa hoje.
  totais: Totais
  // Recortes alternativos: relatórios da Olist normalmente excluem cancelados.
  totaisSemCancelados: Totais
  totaisFaturados: Totais
  porSituacao: LinhaSituacao[]
  // Pedidos em que a base do dash difere do total do pedido da Olist.
  divergencias: {
    pedidos: number
    soma: number
    exemplos: Divergencia[]
  }
}

const TOLERANCIA = 0.01

function totaisVazios(): Totais {
  return {
    pedidos: 0,
    valorVenda: 0,
    valorTotalProdutos: 0,
    valorTotalPedido: 0,
    valorListagem: 0,
    valorNota: 0,
    frete: 0,
    desconto: 0,
    outrasDespesas: 0,
    semRaw: 0,
    semNota: 0,
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

function arredondarTotais(t: Totais): Totais {
  return {
    ...t,
    valorVenda: round(t.valorVenda),
    valorTotalProdutos: round(t.valorTotalProdutos),
    valorTotalPedido: round(t.valorTotalPedido),
    valorListagem: round(t.valorListagem),
    valorNota: round(t.valorNota),
    frete: round(t.frete),
    desconto: round(t.desconto),
    outrasDespesas: round(t.outrasDespesas),
  }
}

function acumular(t: Totais, row: ReconcileRow): void {
  const raw = (row.raw ?? null) as TinyOrderDetail | null
  t.pedidos += 1
  t.valorVenda += row.valorVenda
  if (row.valorNota == null) t.semNota += 1
  else t.valorNota += row.valorNota

  if (!raw) {
    t.semRaw += 1
    return
  }
  t.valorTotalProdutos += toNumber(raw.valorTotalProdutos)
  t.valorTotalPedido += toNumber(raw.valorTotalPedido)
  t.valorListagem += toNumber(raw.valor)
  t.frete += toNumber(raw.valorFrete)
  t.desconto += toNumber(raw.valorDesconto)
  t.outrasDespesas += toNumber(raw.valorOutrasDespesas)
}

function labelSituacao(situacao: number | null): string {
  if (situacao == null) return "sem situação"
  return SITUACAO_LABEL[situacao] ?? `desconhecida (${situacao})`
}

export function reconciliar(
  rows: ReconcileRow[],
  janela: { de: string; ate: string },
  maxExemplos = 20,
  // Referência de "agora" e limite de idade — injetados para o relatório ser determinístico.
  agora: Date = new Date(),
  diasCongelado = 3,
): ReconcileReport {
  const frescor: Frescor = {
    naoLiquidados: 0,
    congelados: 0,
    diasCongelado,
    updatedAtMin: null,
    updatedAtMax: null,
  }
  const limiteCongelado = agora.getTime() - diasCongelado * 86_400_000

  const totais = totaisVazios()
  const totaisSemCancelados = totaisVazios()
  const totaisFaturados = totaisVazios()
  const porSituacao = new Map<number | null, LinhaSituacao>()
  const divergencias: Divergencia[] = []
  let somaDivergencia = 0
  let dataMin: string | null = null
  let dataMax: string | null = null

  for (const row of rows) {
    acumular(totais, row)
    if (row.situacao !== SITUACAO_CANCELADO) acumular(totaisSemCancelados, row)
    if (row.situacao != null && SITUACOES_PAGAS.has(row.situacao)) acumular(totaisFaturados, row)

    if (dataMin === null || row.data < dataMin) dataMin = row.data
    if (dataMax === null || row.data > dataMax) dataMax = row.data

    if (frescor.updatedAtMin === null || row.updatedAt < frescor.updatedAtMin) frescor.updatedAtMin = row.updatedAt
    if (frescor.updatedAtMax === null || row.updatedAt > frescor.updatedAtMax) frescor.updatedAtMax = row.updatedAt
    if (!pedidoLiquidado(row)) {
      frescor.naoLiquidados += 1
      if (Date.parse(row.updatedAt) < limiteCongelado) frescor.congelados += 1
    }

    const raw = (row.raw ?? null) as TinyOrderDetail | null
    const totalPedido = raw ? toNumber(raw.valorTotalPedido) : 0
    const linha =
      porSituacao.get(row.situacao) ??
      {
        situacao: row.situacao,
        label: labelSituacao(row.situacao),
        pedidos: 0,
        valorVenda: 0,
        valorTotalPedido: 0,
      }
    linha.pedidos += 1
    linha.valorVenda += row.valorVenda
    linha.valorTotalPedido += totalPedido
    porSituacao.set(row.situacao, linha)

    // Só compara quando há detalhe salvo e a Olist informou o total do pedido;
    // sem isso a "diferença" seria contra zero e poluiria o relatório.
    if (raw && totalPedido > 0) {
      const diferenca = totalPedido - row.valorVenda
      if (Math.abs(diferenca) > TOLERANCIA) {
        somaDivergencia += diferenca
        divergencias.push({
          olistId: row.olistId,
          data: row.data,
          situacao: row.situacao,
          valorVenda: round(row.valorVenda),
          valorTotalPedido: round(totalPedido),
          frete: round(toNumber(raw.valorFrete)),
          desconto: round(toNumber(raw.valorDesconto)),
          diferenca: round(diferenca),
        })
      }
    }
  }

  return {
    janela,
    dataMin,
    dataMax,
    frescor,
    totais: arredondarTotais(totais),
    totaisSemCancelados: arredondarTotais(totaisSemCancelados),
    totaisFaturados: arredondarTotais(totaisFaturados),
    porSituacao: Array.from(porSituacao.values())
      .map((l) => ({ ...l, valorVenda: round(l.valorVenda), valorTotalPedido: round(l.valorTotalPedido) }))
      .sort((a, b) => b.valorVenda - a.valorVenda),
    divergencias: {
      pedidos: divergencias.length,
      soma: round(somaDivergencia),
      // Maiores diferenças absolutas primeiro — é onde a causa fica visível.
      exemplos: divergencias
        .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
        .slice(0, maxExemplos),
    },
  }
}
