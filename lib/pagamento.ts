// Corrige mojibake (UTF-8 lido como Latin-1) vindo de registros antigos do banco
// e padroniza vazio como "Não informado".
const MOJIBAKE: Array<[string, string]> = [
  ["Ã£", "ã"], ["Ã©", "é"], ["Ã³", "ó"], ["Ã­", "í"], ["Ãª", "ê"],
  ["Ã¡", "á"], ["Ã§", "ç"], ["Ãµ", "õ"], ["Ã¢", "â"], ["Ãº", "ú"],
]

export function normalizarFormaPagamento(nome: string | null | undefined): string {
  const bruto = (nome ?? "").trim()
  if (!bruto) return "Não informado"
  let limpo = bruto
  for (const [errado, certo] of MOJIBAKE) limpo = limpo.split(errado).join(certo)
  return limpo
}
