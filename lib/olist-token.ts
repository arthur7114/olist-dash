import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { refreshAccessToken } from "@/lib/olist-v3"
import type { OlistConta } from "@/lib/olist-contas"

// Usa o access token armazenado enquanto válido; só faz refresh (com rotação)
// quando expirou — evita corrida de rotação com o sync que roda a cada 4h.
export async function getOlistAccessToken(conta: OlistConta = "atual"): Promise<string> {
  const creds = await getStoredCredentials(conta)
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  if (creds.accessToken && creds.accessExpiresAt && creds.accessExpiresAt.getTime() > Date.now() + 120_000) {
    return creds.accessToken
  }
  const refreshed = await refreshAccessToken(creds.refreshToken, conta)
  await saveCredentials(refreshed, conta)
  return refreshed.access_token
}
