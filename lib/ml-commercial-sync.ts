import { getMlAccessToken } from "@/lib/ml-api"
import {
  fetchCommercialItemSnapshot,
  fetchItemPromotions,
  fetchMlCommercialJson,
  fetchSellerCommercialItemIds,
} from "@/lib/ml-commercial"
import {
  getCommercialSyncState,
  replaceMlItemPromotions,
  saveCommercialSyncState,
  upsertMlItems,
} from "@/lib/db/pricing"

export interface CommercialSyncResult {
  ok: boolean
  itemsSynced: number
  promotionsSynced: number
  errors: Array<{ itemId: string; error: string }>
  completed: boolean
}

export async function syncMlCommercialData(itemIds?: string[]): Promise<CommercialSyncResult> {
  const accessToken = await getMlAccessToken()
  const me = await fetchMlCommercialJson<{ id: string | number }>("/users/me", accessToken)
  const sellerId = String(me.id)
  const targeted = Boolean(itemIds?.length)
  const allIds = targeted
    ? Array.from(new Set(itemIds)).slice(0, 50)
    : await fetchSellerCommercialItemIds(sellerId, accessToken)
  const previous = targeted ? null : await getCommercialSyncState()
  const requestedOffset = Number(previous?.cursor ?? 0)
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset < allIds.length ? requestedOffset : 0
  const ids = targeted ? allIds : allIds.slice(offset, offset + 50)
  const nextCursor = !targeted && offset + ids.length < allIds.length ? String(offset + ids.length) : null
  const errors: CommercialSyncResult["errors"] = []
  let itemsSynced = 0
  let promotionsSynced = 0
  let nextIndex = 0
  if (!targeted) await saveCommercialSyncState({ status: "running", lastRunAt: new Date(), lastError: null })

  const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
    for (;;) {
      const index = nextIndex++
      if (index >= ids.length) return
      const itemId = ids[index]
      try {
        const snapshot = await fetchCommercialItemSnapshot(itemId, accessToken)
        await upsertMlItems([snapshot])
        itemsSynced += 1
        try {
          const promotions = await fetchItemPromotions(itemId, accessToken)
          await replaceMlItemPromotions(itemId, promotions)
          promotionsSynced += promotions.length
        } catch (error) {
          errors.push({ itemId, error: `Promoções: ${error instanceof Error ? error.message : String(error)}` })
        }
      } catch (error) {
        errors.push({ itemId, error: error instanceof Error ? error.message : String(error) })
      }
    }
  })
  await Promise.all(workers)

  const completed = errors.length === 0 && (targeted || nextCursor == null)
  if (!targeted) {
    await saveCommercialSyncState({
      status: completed ? "success" : errors.length ? "partial" : "running",
      cursor: nextCursor,
      lastSuccessAt: completed ? new Date() : undefined,
      lastError: errors.length ? `${errors.length} etapa(s) falharam.` : null,
      itemsSynced,
      promotionsSynced,
    })
  }
  return { ok: itemsSynced > 0 || !ids.length, itemsSynced, promotionsSynced, errors, completed }
}
