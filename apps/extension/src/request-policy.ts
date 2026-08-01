const ALLOWED_REQUESTS: Record<string, readonly string[]> = {
  "/api/extension/bootstrap": ["GET"],
  "/api/extension/catalog": ["GET"],
  "/api/extension/settings": ["GET", "PUT"],
  "/api/extension/pricing/simulate": ["POST"],
  "/api/extension/promotions/evaluate": ["POST"],
  "/api/extension/refresh": ["POST"],
}

export function isAllowedApiRequest(path: string, method = "GET"): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false
  const pathname = path.split("?", 1)[0]
  return ALLOWED_REQUESTS[pathname]?.includes(method.toUpperCase()) ?? false
}
