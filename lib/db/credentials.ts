import { eq } from "drizzle-orm"
import { getDb } from "./client"
import { olistCredentials } from "./schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import type { TinyTokenResponse } from "@/lib/olist-v3"
import { OLIST_CONTAS, type OlistConta } from "@/lib/olist-contas"

export type StoredCredentials = {
  refreshToken: string
  accessToken?: string
  accessExpiresAt?: Date
}

// Uma linha por empresa (OLIST_CONTAS[conta].rowId); sem argumento é a conta atual, linha 1.
export async function getStoredCredentials(conta: OlistConta = "atual"): Promise<StoredCredentials | null> {
  const db = getDb()
  const [row] = await db.select().from(olistCredentials).where(eq(olistCredentials.id, OLIST_CONTAS[conta].rowId)).limit(1)
  if (!row) return null
  return {
    refreshToken: decryptSecret(row.refreshToken),
    accessToken: row.accessToken ? decryptSecret(row.accessToken) : undefined,
    accessExpiresAt: row.accessExpiresAt ?? undefined,
  }
}

// Salva o access sempre; o refresh só quando vier um novo (rotação), para não apagar
// o refresh válido quando a Olist não reenvia um na resposta de refresh.
export async function saveCredentials(token: TinyTokenResponse, conta: OlistConta = "atual"): Promise<void> {
  const id = OLIST_CONTAS[conta].rowId
  const db = getDb()
  const accessExpiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null

  if (token.refresh_token) {
    const values = {
      id,
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
    .where(eq(olistCredentials.id, id))
}
