// Leitura do catálogo de um anúncio do ML: descrição, fotos e medidas de embalagem.
// Somente leitura. Precisa de token (sem token o ML devolve 403 em /items e /description).

import { fetchMlJson } from "@/lib/ml-product-sync"
import { dimsFromAttributes, type MlCatalog } from "@/lib/olist-catalog-fill"

type MlItemForCatalog = {
  id?: string
  sold_quantity?: number
  pictures?: Array<{ secure_url?: string; url?: string }> | null
  attributes?: Array<{ id?: string; value_name?: string | null }> | null
  variations?: unknown[] | null
}

export type MlCatalogResult = { catalog: MlCatalog; hasVariations: boolean }

export async function fetchMlItemCatalog(
  itemId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlCatalogResult> {
  const item = await fetchMlJson<MlItemForCatalog>(
    `/items/${encodeURIComponent(itemId)}`,
    accessToken,
    { include_attributes: "all" },
    fetchFn,
  )

  let description: string | null = null
  try {
    const desc = await fetchMlJson<{ plain_text?: string | null }>(
      `/items/${encodeURIComponent(itemId)}/description`,
      accessToken,
      undefined,
      fetchFn,
    )
    description = desc.plain_text?.trim() || null
  } catch (error) {
    // Anúncio sem descrição devolve 404; qualquer outro erro sobe.
    if (!(error instanceof Error && /retornou 404/.test(error.message))) throw error
  }

  const pictures = (item.pictures ?? [])
    .map((p) => p.secure_url || p.url || "")
    .filter((url) => /^https:\/\//.test(url))

  return {
    catalog: {
      itemId,
      soldQuantity: Number(item.sold_quantity ?? 0) || 0,
      description,
      pictures,
      dims: dimsFromAttributes(item.attributes),
    },
    hasVariations: Array.isArray(item.variations) && item.variations.length > 0,
  }
}
