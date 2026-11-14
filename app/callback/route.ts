import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  exchangeCodeForToken,
  fetchCompanyInfo,
  OLIST_ACCESS_COOKIE,
  OLIST_REFRESH_COOKIE,
  OLIST_STATE_COOKIE,
} from "@/lib/olist-v3"
import { hasDatabase } from "@/lib/db/client"
import { saveCredentials } from "@/lib/db/credentials"
import { cnpjConfere, lerCookieEstado, OLIST_CONTAS, type OlistConta } from "@/lib/olist-contas"
import { paginaAutorizacao } from "@/lib/pagina-autorizacao"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  if (error) {
    return redirectToDashboard(request, {
      olist: "error",
      message: errorDescription ?? error,
    })
  }

  if (!code) {
    return redirectToDashboard(request, {
      olist: "missing_code",
    })
  }

  const cookieStore = await cookies()
  const { conta, state: expectedState } = lerCookieEstado(cookieStore.get(OLIST_STATE_COOKIE)?.value)

  // Outra empresa (SP): fluxo próprio, que não mexe nos cookies de sessão da conta atual.
  if (conta && conta !== "atual") {
    if (!expectedState || state !== expectedState) {
      return paginaAutorizacao(false, "Esse link de retorno é de outra tentativa ou expirou. Comece de novo pelo botão Conectar.")
    }
    const resposta = await conectarOutraEmpresa(request, code, conta)
    resposta.headers.append("Set-Cookie", `${OLIST_STATE_COOKIE}=; Path=/; Max-Age=0`)
    return resposta
  }

  if (expectedState && state !== expectedState) {
    return redirectToDashboard(request, {
      olist: "invalid_state",
    })
  }

  try {
    const token = await exchangeCodeForToken(request, code)

    // Persiste o refresh token (cifrado) p/ o job de sync autenticar sem usuário. Best-effort.
    if (hasDatabase()) {
      try {
        await saveCredentials(token)
      } catch (e) {
        console.error("Falha ao persistir credencial Olist no banco:", e)
      }
    }

    const response = redirectToDashboard(request, { olist: "connected" })
    const secure = new URL(request.url).protocol === "https:"

    response.cookies.set(OLIST_ACCESS_COOKIE, token.access_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: token.expires_in ?? 60 * 60 * 4,
    })

    if (token.refresh_token) {
      response.cookies.set(OLIST_REFRESH_COOKIE, token.refresh_token, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24,
      })
    }

    response.cookies.delete(OLIST_STATE_COOKIE)
    return response
  } catch (err) {
    return redirectToDashboard(request, {
      olist: "token_error",
      message: err instanceof Error ? err.message : "Falha ao autenticar com a Olist ERP API v3.",
    })
  }
}

async function conectarOutraEmpresa(request: Request, code: string, conta: OlistConta): Promise<Response> {
  const nome = OLIST_CONTAS[conta].nome
  try {
    const token = await exchangeCodeForToken(request, code, conta)
    // No multiempresa a mesma pessoa entra nas duas empresas: só grava se o token for da empresa certa.
    const info = await fetchCompanyInfo(token.access_token).catch((e: unknown) => {
      if (e instanceof Error && /retornou 40[13]/.test(e.message)) {
        throw new Error(`O aplicativo da ${nome} precisa da permissão de leitura em "Dados da empresa". Marque, salve e conecte de novo.`)
      }
      throw e
    })
    if (!cnpjConfere(conta, info.cpfCnpj)) {
      return paginaAutorizacao(
        false,
        `Esse login é da empresa ${info.razaoSocial ?? info.cpfCnpj ?? "errada"}, não da ${nome}. Troque de empresa na Olist e tente de novo.`,
      )
    }
    if (!hasDatabase()) return paginaAutorizacao(false, "O painel está sem banco de dados configurado; nada foi gravado.")
    await saveCredentials(token, conta)
    return paginaAutorizacao(true, `A ${nome} (${info.razaoSocial ?? info.cpfCnpj}) está conectada ao painel. A autorização se renova sozinha.`)
  } catch (err) {
    console.error(`Falha ao conectar ${nome}:`, err)
    return paginaAutorizacao(false, err instanceof Error ? err.message : `Não foi possível conectar a ${nome}.`)
  }
}

function redirectToDashboard(request: Request, params: Record<string, string>) {
  const redirectUrl = new URL("/", request.url)
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value)
  }
  return NextResponse.redirect(redirectUrl)
}
