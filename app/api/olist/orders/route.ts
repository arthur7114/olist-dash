import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { PEDIDOS } from "@/lib/data"
import {
  fetchTinyOrders,
  refreshAccessToken,
  OLIST_ACCESS_COOKIE,
  OLIST_REFRESH_COOKIE,
} from "@/lib/olist-v3"

// Uma carga "a frio" pode fazer centenas de chamadas espaçadas pelo throttle e levar
// alguns minutos. Garante o runtime Node e amplia o limite de execução da função.
export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const url = new URL(request.url)
  const periodo = url.searchParams.get("periodo") ?? "7d"
  const cookieStore = await cookies()
  let accessToken = cookieStore.get(OLIST_ACCESS_COOKIE)?.value
  const refreshToken = cookieStore.get(OLIST_REFRESH_COOKIE)?.value

  if (!accessToken && !refreshToken) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: "Conecte a Olist ERP API v3 para carregar dados reais.",
    })
  }

  let refreshedToken:
    | { access_token: string; refresh_token?: string; expires_in?: number }
    | null = null

  try {
    if (!accessToken && refreshToken) {
      const refreshed = await refreshAccessToken(refreshToken)
      refreshedToken = refreshed
      accessToken = refreshed.access_token
    }

    const pedidos = await fetchTinyOrders(accessToken as string, periodo)
    const response = NextResponse.json({
      source: "real",
      authenticated: true,
      pedidos,
      message: `${pedidos.length} linhas carregadas da Olist ERP API v3.`,
    })
    if (refreshedToken) setTokenCookies(request, response, refreshedToken)
    return response
  } catch (err) {
    if (refreshToken) {
      try {
        const refreshed = await refreshAccessToken(refreshToken)
        const pedidos = await fetchTinyOrders(refreshed.access_token, periodo)
        const retryResponse = NextResponse.json({
          source: "real",
          authenticated: true,
          pedidos,
          message: `${pedidos.length} linhas carregadas da Olist ERP API v3.`,
        })
        setTokenCookies(request, retryResponse, refreshed)
        return retryResponse
      } catch {
        // Fall through to the safe mock response below.
      }
    }

    return NextResponse.json(
      {
        source: "mock",
        authenticated: Boolean(refreshToken),
        pedidos: PEDIDOS,
        message:
          err instanceof Error
            ? err.message
            : "Não foi possível carregar pedidos reais da Olist ERP API v3.",
      },
      { status: 200 },
    )
  }
}

function setTokenCookies(
  request: Request,
  response: NextResponse,
  token: { access_token: string; refresh_token?: string; expires_in?: number },
) {
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
}
