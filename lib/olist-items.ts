import { toNumber, type TinyOrderDetail } from "@/lib/olist-v3"

// Item de pedido pronto para persistir em order_items.
export type SyncOrderItem = {
  sku: string
  produtoOlistId: number | null
  descricao: string
  quantidade: number
  valorUnitario: number
  custoUnitario: number
}

// Extrai os itens do detalhe da Olist. `custoDe` resolve o custo unitário
// (cache product_costs) por id do produto e/ou sku — 0 quando desconhecido.
export function extractOrderItems(
  detail: TinyOrderDetail,
  custoDe: (id?: number, sku?: string) => number,
): SyncOrderItem[] {
  return (detail.itens ?? []).map((item) => {
    const sku = item.produto?.sku?.trim() || "sem-sku"
    const produtoOlistId = typeof item.produto?.id === "number" ? item.produto.id : null
    return {
      sku,
      produtoOlistId,
      descricao: item.produto?.descricao?.trim() ?? "",
      quantidade: Math.max(1, toNumber(item.quantidade)),
      valorUnitario: toNumber(item.valorUnitario),
      custoUnitario: custoDe(produtoOlistId ?? undefined, sku === "sem-sku" ? undefined : sku),
    }
  })
}
