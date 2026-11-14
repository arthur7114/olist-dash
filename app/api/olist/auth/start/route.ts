import { NextResponse } from "next/server"
import { buildAuthorizationUrl, OLIST_STATE_COOKIE } from "@/lib/olist-v3"
import { parseOlistConta } from "@/lib/olist-contas"

// ?conta=sp conecta a Olist de SP (aplicativo próprio, OLIST_SP_*); sem parâmetro, a atual.
export async function GET(request: Request) {
  const conta = parseOlistConta(new URL(request.url).searchParams.get("conta"))
  if (!conta) return new Response("Conta desconhecida. Use ?conta=sp ou nenhum parâmetro.", { status: 400 })

  const state = crypto.randomUUID()
  const response = NextResponse.redirect(buildAuthorizationUrl(request, state, conta))
  const secure = new URL(request.url).protocol === "https:"

  // O cookie leva a conta junto do state: o callback sabe onde guardar sem confiar na URL de volta.
  response.cookies.set(OLIST_STATE_COOKIE, `${conta}.${state}`, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  })

  return response
}
