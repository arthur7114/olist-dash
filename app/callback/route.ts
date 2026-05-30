import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  exchangeCodeForToken,
  OLIST_ACCESS_COOKIE,
  OLIST_REFRESH_COOKIE,
  OLIST_STATE_COOKIE,
} from "@/lib/olist-v3"
import { hasDatabase } from "@/lib/db/client"
import { saveCredentials } from "@/lib/db/credentials"

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
  const expectedState = cookieStore.get(OLIST_STATE_COOKIE)?.value

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

function redirectToDashboard(request: Request, params: Record<string, string>) {
  const redirectUrl = new URL("/", request.url)
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value)
  }
  return NextResponse.redirect(redirectUrl)
}
