import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { ML_STATE_COOKIE, mlAuthorizeUrl, parseMlConta } from "@/lib/ml-user-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Início da autorização de escrita no Mercado Livre. Público de propósito: quem abrir
// precisa entrar com a conta da loja, e o callback recusa qualquer outra conta.
// ?conta=sp autoriza a conta de São Paulo; sem parâmetro, a conta atual.
export async function GET(request: Request) {
  const conta = parseMlConta(new URL(request.url).searchParams.get("conta"))
  if (!conta) return new Response("Conta desconhecida. Use ?conta=sp ou nenhum parâmetro.", { status: 400 })

  const state = randomBytes(16).toString("hex")
  const response = NextResponse.redirect(mlAuthorizeUrl(state))
  // O cookie leva a conta junto do state: o callback sabe onde guardar sem confiar na URL de volta.
  response.cookies.set(ML_STATE_COOKIE, `${conta}.${state}`, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/ml",
    maxAge: 10 * 60,
  })
  return response
}
