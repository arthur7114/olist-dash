import { eq } from "drizzle-orm"
import { getDb } from "./client"
import { olistCredentials } from "./schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import type { TinyTokenResponse } from "@/lib/olist-v3"

export type StoredCredentials = {
  refreshToken: string
  accessToken?: string
  accessExpiresAt?: Date
}

export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  const db = getDb()
  const [row] = await db.select().from(olistCredentials).where(eq(olistCredentials.id, 1)).limit(1)
  if (!row) return null
  return {
    refreshToken: decryptSecret(row.refreshToken),
    accessToken: row.accessToken ? decryptSecret(row.accessToken) : undefined,
    accessExpiresAt: row.accessExpiresAt ?? undefined,
  }
}

// Salva o access sempre; o refresh só quando vier um novo (rotação), para não apagar
// o refresh válido quando a Olist não reenvia um na resposta de refresh.
export async function saveCredentials(token: TinyTokenResponse): Promise<void> {
  const db = getDb()
  const accessExpiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null

  if (token.refresh_token) {
    const values = {
      id: 1,
      refreshToken: encryptSecret(token.refresh_token),
      accessToken: token.access_token ? encryptSecret(token.access_token) : null,
      accessExpiresAt,
      updatedAt: new Date(),
    }
    await db
      .insert(olistCredentials)
      .values(values)
      .onConflictDoUpdate({ target: olistCredentials.id, set: values })
    return
  }

  await db
    .update(olistCredentials)
    .set({
      accessToken: token.access_token ? encryptSecret(token.access_token) : null,
      accessExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(olistCredentials.id, 1))
}
