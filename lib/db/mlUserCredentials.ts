import { eq } from "drizzle-orm"
import { getDb } from "./client"
import { mlUserCredentials } from "./schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import type { MlCredentialStore, MlUserCredentials } from "@/lib/ml-user-token"

export const mlCredentialStore: MlCredentialStore = {
  async load(): Promise<MlUserCredentials | null> {
    const [row] = await getDb().select().from(mlUserCredentials).where(eq(mlUserCredentials.id, 1)).limit(1)
    if (!row) return null
    return {
      userId: row.mlUserId,
      accessToken: decryptSecret(row.accessToken),
      refreshToken: decryptSecret(row.refreshToken),
      accessExpiresAt: row.accessExpiresAt,
      scope: row.scope,
    }
  },

  async save(c: MlUserCredentials): Promise<void> {
    const values = {
      id: 1,
      mlUserId: c.userId,
      accessToken: encryptSecret(c.accessToken),
      refreshToken: encryptSecret(c.refreshToken),
      accessExpiresAt: c.accessExpiresAt,
      scope: c.scope,
      updatedAt: new Date(),
    }
    await getDb().insert(mlUserCredentials).values(values).onConflictDoUpdate({ target: mlUserCredentials.id, set: values })
  },
}
