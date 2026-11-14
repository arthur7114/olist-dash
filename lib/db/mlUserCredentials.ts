import { eq } from "drizzle-orm"
import { getDb } from "./client"
import { mlUserCredentials } from "./schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { ML_CONTAS, type MlConta, type MlCredentialStore, type MlUserCredentials } from "@/lib/ml-user-token"

// Uma linha por conta (ML_CONTAS[conta].rowId). Sem migração: a tabela já tem id inteiro.
export function mlCredentialStoreFor(conta: MlConta): MlCredentialStore {
  const id = ML_CONTAS[conta].rowId
  return {
    async load(): Promise<MlUserCredentials | null> {
      const [row] = await getDb().select().from(mlUserCredentials).where(eq(mlUserCredentials.id, id)).limit(1)
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
        id,
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
}

// Conta atual, linha 1: o que já existia antes das duas contas.
export const mlCredentialStore: MlCredentialStore = mlCredentialStoreFor("atual")
