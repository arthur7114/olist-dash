// Empresas da OEM na Olist. Cada uma tem o próprio aplicativo API (criado dentro da conta
// dela) e guarda o próprio token numa linha de olist_credentials (rowId).
// "atual" é a linha 1 de sempre, com OLIST_CLIENT_ID/SECRET.

export type OlistConta = "atual" | "sp"

export const OLIST_CONTAS: Record<OlistConta, { rowId: number; envPrefix: string; nome: string; cnpj: string | null }> = {
  atual: { rowId: 1, envPrefix: "OLIST", nome: "Olist atual", cnpj: null },
  // CNPJ conferido no login: no multiempresa a mesma pessoa entra nas duas empresas.
  sp: { rowId: 2, envPrefix: "OLIST_SP", nome: "Olist SP", cnpj: process.env.OLIST_SP_CNPJ ?? "69810113000159" },
}

// Sem parâmetro é a conta atual (links antigos continuam valendo); valor desconhecido é null.
export function parseOlistConta(valor: string | null | undefined): OlistConta | null {
  if (valor == null || valor === "" || valor === "atual") return "atual"
  return valor === "sp" ? "sp" : null
}

export function olistAppCredentials(
  conta: OlistConta = "atual",
  env: Record<string, string | undefined> = process.env,
): { clientId: string; clientSecret: string } {
  const prefix = OLIST_CONTAS[conta].envPrefix
  const clientId = env[`${prefix}_CLIENT_ID`]
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]
  if (!clientId || !clientSecret) {
    throw new Error(`${prefix}_CLIENT_ID e ${prefix}_CLIENT_SECRET precisam estar configurados.`)
  }
  return { clientId, clientSecret }
}

// Compara só os dígitos: a API pode devolver o CNPJ com ou sem pontuação.
export function cnpjConfere(conta: OlistConta, cpfCnpj: string | null | undefined): boolean {
  const esperado = OLIST_CONTAS[conta].cnpj
  if (!esperado) return true
  return (cpfCnpj ?? "").replace(/\D/g, "") === esperado.replace(/\D/g, "")
}

// Cookie do OAuth no formato "<conta>.<state>"; um cookie antigo, só com o state, é da conta atual.
export function lerCookieEstado(valor: string | undefined): { conta: OlistConta | null; state: string | undefined } {
  if (!valor) return { conta: null, state: undefined }
  if (!valor.includes(".")) return { conta: "atual", state: valor }
  const [conta, state] = valor.split(".", 2)
  return { conta: parseOlistConta(conta), state }
}
