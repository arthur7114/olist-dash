import { cookies } from "next/headers"
import { paginaAutorizacao as pagina } from "@/lib/pagina-autorizacao"
import { mlCredentialStoreFor } from "@/lib/db/mlUserCredentials"
import { ML_CONTAS, ML_STATE_COOKIE, completeMlAuthorization, mlRedirectUri, parseMlConta } from "@/lib/ml-user-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Retorno do login do Mercado Livre (URI cadastrada no devcenter). Quem chega aqui é
// quem clicou em Autorizar, então a resposta é uma página em português, não JSON.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const erro = url.searchParams.get("error")
  const cookieStore = await cookies()
  // Cookie no formato "<conta>.<state>"; um cookie antigo, só com o state, vale para a conta atual.
  const cookie = cookieStore.get(ML_STATE_COOKIE)?.value
  const [contaBruta, expected] = cookie?.includes(".") ? cookie.split(".", 2) : [null, cookie]
  const conta = parseMlConta(contaBruta)

  if (erro) return pagina(false, "A autorização foi cancelada na tela do Mercado Livre.")
  if (!code) return pagina(false, "O Mercado Livre não devolveu o código de autorização.")
  if (!conta || !expected || url.searchParams.get("state") !== expected) {
    return pagina(false, "Esse link de retorno é de outra tentativa ou expirou. Comece de novo pelo botão Autorizar.")
  }

  try {
    await completeMlAuthorization({ code, redirectUri: mlRedirectUri(), store: mlCredentialStoreFor(conta), conta })
  } catch (e) {
    console.error("Falha ao concluir autorização do Mercado Livre:", e)
    return pagina(false, e instanceof Error ? e.message : "Não foi possível concluir a autorização.")
  }
  cookieStore.delete(ML_STATE_COOKIE)
  return pagina(true, `A conta ${ML_CONTAS[conta].nome} está autorizada no painel. A autorização se renova sozinha.`)
}
