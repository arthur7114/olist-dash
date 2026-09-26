import { NextResponse } from "next/server"
import { getBaseUrl } from "@/lib/olist-v3"
import { buildShopeeAuthUrl, hasShopeeConfig } from "@/lib/shopee-api"
import { isSyncAuthorized } from "@/lib/sync-auth"

export const runtime = "nodejs"

const SHOPEE_STATE_COOKIE = "shopee_oauth_state"

// Conecta a loja Shopee (uma vez). Protegido pelo OLIST_SYNC_SECRET: quem conecta decide
// de qual loja a conciliação lê. Abrir /api/shopee/auth/start?key=<segredo>.
export async function GET(request: Request) {
  if (!isSyncAuthorized(request)) return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  if (!hasShopeeConfig()) {
    return NextResponse.json({ ok: false, error: "SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY não configurados." }, { status: 500 })
  }
  const state = crypto.randomUUID()
  const redirect = `${getBaseUrl(request)}/api/shopee/auth/callback?state=${state}`
  const response = NextResponse.redirect(buildShopeeAuthUrl(redirect))
  response.cookies.set(SHOPEE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  })
  return response
}
