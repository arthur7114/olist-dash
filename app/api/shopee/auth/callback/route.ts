import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { exchangeShopeeCode } from "@/lib/shopee-api"
import { saveShopeeCredentials } from "@/lib/db/shopee"

export const runtime = "nodejs"

const SHOPEE_STATE_COOKIE = "shopee_oauth_state"

// A Shopee volta com ?code=&shop_id= (e o state que pusemos no redirect).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const shopId = Number(url.searchParams.get("shop_id"))
  const state = url.searchParams.get("state")
  const expected = (await cookies()).get(SHOPEE_STATE_COOKIE)?.value

  if (!expected || state !== expected) return done(request, { shopee: "invalid_state" })
  if (!code || !shopId) return done(request, { shopee: "missing_code" })

  try {
    const token = await exchangeShopeeCode(code, shopId)
    await saveShopeeCredentials(shopId, token)
    const response = done(request, { shopee: "connected" })
    response.cookies.delete(SHOPEE_STATE_COOKIE)
    return response
  } catch (err) {
    return done(request, { shopee: "token_error", message: err instanceof Error ? err.message : String(err) })
  }
}

function done(request: Request, params: Record<string, string>) {
  const target = new URL("/", request.url)
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
  return NextResponse.redirect(target)
}
