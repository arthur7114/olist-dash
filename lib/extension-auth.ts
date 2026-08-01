import { createHash, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

export function isExtensionAuthorized(request: Request, expected = process.env.EXTENSION_API_KEY): boolean {
  if (!expected) return false
  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return false
  const provided = authorization.slice(7)
  const left = createHash("sha256").update(provided).digest()
  const right = createHash("sha256").update(expected).digest()
  return timingSafeEqual(left, right)
}

export function requireExtensionAuthorization(request: Request): NextResponse | null {
  if (!process.env.EXTENSION_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "EXTENSION_API_KEY não configurada." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  if (!isExtensionAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Não autorizado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    )
  }
  return null
}

export function privateJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers)
  headers.set("Cache-Control", "no-store")
  return NextResponse.json(body, { ...init, headers })
}
