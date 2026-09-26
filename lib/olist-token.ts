import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { refreshAccessToken } from "@/lib/olist-v3"

// Usa o access token armazenado enquanto válido; só faz refresh (com rotação)
// quando expirou — evita corrida de rotação com o sync que roda a cada 4h.
export async function getOlistAccessToken(): Promise<string> {
  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  if (creds.accessToken && creds.accessExpiresAt && creds.accessExpiresAt.getTime() > Date.now() + 120_000) {
    return creds.accessToken
  }
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  return refreshed.access_token
}
