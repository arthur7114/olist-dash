// Regras puras do script scripts/olist-custos.ts: custo de kit a partir dos componentes
// e leitura do custo digitado na planilha de compras.

// Soma componente × quantidade. Qualquer componente sem custo (ou quantidade inválida)
// zera o kit: custo parcial passaria por margem que não existe.
export function kitCostFromComponents(parts: Array<{ custo: number; quantidade: number }>): number {
  if (!parts.length) return 0
  let total = 0
  for (const { custo, quantidade } of parts) {
    if (!(custo > 0) || !(quantidade > 0)) return 0
    total += custo * quantidade
  }
  return Math.round(total * 100) / 100
}

// O cadastro do kit precisa ser regravado quando a soma fecha e difere do que está lá.
export function kitNeedsUpdate(precoCustoAtual: number | null | undefined, soma: number): boolean {
  if (!(soma > 0)) return false
  return Math.abs((Number(precoCustoAtual) || 0) - soma) > 0.005
}

export type CustoPlanilha = { ok: true; custo: number } | { ok: false; motivo: string } | { ok: "vazio" }

// Aceita número do Excel ou texto no formato brasileiro ("R$ 1.234,56", "89,9") ou com
// ponto decimal ("89.90"). Vazio não é erro: é linha que compras ainda não preencheu.
export function parseCustoPlanilha(value: unknown): CustoPlanilha {
  if (value === null || value === undefined) return { ok: "vazio" }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? { ok: true, custo: Math.round(value * 100) / 100 }
      : { ok: false, motivo: `custo inválido: ${value}` }
  }
  const raw = String(value).trim()
  if (!raw) return { ok: "vazio" }
  let s = raw.replace(/r\$/i, "").replace(/\s/g, "")
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "")
  const n = Number(s)
  if (!/^\d+(\.\d+)?$/.test(s) || !(n > 0)) return { ok: false, motivo: `custo inválido: "${raw}"` }
  return { ok: true, custo: Math.round(n * 100) / 100 }
}
