// Parâmetros do modelo de margem de contribuição da OEM Parts.
// Cópia de oem-pricing/regras.json (versão 2026-09-05): mudou lá, muda aqui.

export const REGRAS = {
  versao: "2026-09-05",
  icmsVenda: 0.0604,
  tarifaPorTipo: { gold_pro: 0.17, gold_special: 0.12 } as Record<string, number>,
  rotuloTipo: { gold_pro: "Anúncio Premium", gold_special: "Anúncio Clássico" } as Record<string, string>,
  fretePorFaixa: [
    { min: 0, max: 79, padrao: 9.33, full: 11.58 },
    { min: 79, max: 200, padrao: 16.12, full: 15.94 },
    { min: 200, max: 500, padrao: 26.92, full: 34.19 },
    { min: 500, max: null, padrao: 35.73, full: 34.19 },
  ],
  patamares: { alvo: 0.25, saudavel: 0.15, estrategico: 0.05, empate: 0 },
  limites: {
    estrategicoDiasMax: 14,
    custoMaxDias: 30,
    estoqueMinDiasVenda: 14,
    estoqueMinUnidadesPromocao: 10,
  },
  medicao: { minPedidos: 3, janelaDias: 90 },
  sellerId: 587857974,
} as const
