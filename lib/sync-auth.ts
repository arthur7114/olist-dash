import { timingSafeEqual } from "crypto"

// Rotas de job/admin: Bearer OLIST_SYNC_SECRET ou ?key=. Comparação em tempo constante.
export function isSyncAuthorized(request: Request): boolean {
  const secret = process.env.OLIST_SYNC_SECRET
  if (!secret) return false
  const auth = request.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("key") ?? ""
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}
