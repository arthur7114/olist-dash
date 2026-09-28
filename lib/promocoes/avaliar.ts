import { buscarOfertas, custosPorSku, historicoDesconto, medidosPorSku, promocoesSemPreco } from "./consultas"
import { avaliarOferta, ordenarAvaliadas, type Classe, type OfertaAvaliada } from "./margem"

export type ResultadoAvaliacao = {
  ofertas: OfertaAvaliada[]
  resumo: Partial<Record<Classe, number>>
  // Quando o nome existe mas o ML não propõe preço por anúncio (cupom etc.).
  semPrecoPorAnuncio: { rotulo: string; anuncios: number }[]
}

export async function avaliarPromocoes(f: { nome?: string; sku?: string; itemId?: string } = {}): Promise<ResultadoAvaliacao> {
  const linhas = await buscarOfertas(f)
  if (!linhas.length) {
    return { ofertas: [], resumo: {}, semPrecoPorAnuncio: f.nome ? await promocoesSemPreco(f.nome) : [] }
  }
  const skus = [...new Set(linhas.map((l) => l.sku).filter((s): s is string => Boolean(s)))]
  const [custos, medidos, historico] = await Promise.all([custosPorSku(skus), medidosPorSku(skus), historicoDesconto(skus)])
  const ofertas = ordenarAvaliadas(
    linhas.map((l) =>
      avaliarOferta(l, {
        custo: l.sku ? (custos[l.sku] ?? null) : null,
        medido: l.sku ? medidos[l.sku] : null,
        historico: l.sku ? historico[l.sku] : null,
      }),
    ),
  )
  const resumo: Partial<Record<Classe, number>> = {}
  for (const o of ofertas) resumo[o.classe] = (resumo[o.classe] ?? 0) + 1
  return { ofertas, resumo, semPrecoPorAnuncio: [] }
}
