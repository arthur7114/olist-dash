import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { ML_STATE_COOKIE, mlAuthorizeUrl } from "@/lib/ml-user-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Início da autorização de escrita no Mercado Livre. Público de propósito: quem abrir
// precisa entrar com a conta da loja, e o callback recusa qualquer outra conta.
export async function GET(request: Request) {
  const state = randomBytes(16).toString("hex")
  const response = NextResponse.redirect(mlAuthorizeUrl(state))
  response.cookies.set(ML_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/ml",
    maxAge: 10 * 60,
  })
  return response
}
