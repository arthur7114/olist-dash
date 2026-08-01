import { refreshItemsRequestSchema } from "@oem/contracts"
import { requireExtensionAuthorization, privateJson } from "@/lib/extension-auth"
import { syncMlCommercialData } from "@/lib/ml-commercial-sync"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const denied = requireExtensionAuthorization(request)
  if (denied) return denied
  const parsed = refreshItemsRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return privateJson({ ok: false, error: "Itens inválidos.", issues: parsed.error.issues }, { status: 422 })
  return privateJson(await syncMlCommercialData(parsed.data.itemIds))
}
