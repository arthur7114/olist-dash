import { NextResponse } from "next/server"
import { buildAuthorizationUrl, OLIST_STATE_COOKIE } from "@/lib/olist-v3"

export async function GET(request: Request) {
  const state = crypto.randomUUID()
  const response = NextResponse.redirect(buildAuthorizationUrl(request, state))
  const secure = new URL(request.url).protocol === "https:"

  response.cookies.set(OLIST_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  })

  return response
}
