import { eq } from "drizzle-orm"
import { getDb } from "./client"
import { syncState } from "./schema"

export type SyncStateRow = typeof syncState.$inferSelect

export async function getSyncState(): Promise<SyncStateRow | null> {
  const db = getDb()
  const [row] = await db.select().from(syncState).where(eq(syncState.id, 1)).limit(1)
  return row ?? null
}

export async function saveSyncState(patch: Partial<typeof syncState.$inferInsert>): Promise<void> {
  const db = getDb()
  await db
    .insert(syncState)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: syncState.id, set: patch })
}
