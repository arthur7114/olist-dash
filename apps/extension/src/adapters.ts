export interface CommercialTarget {
  key: string
  itemId: string
  promotionId: string | null
  promotionType: string | null
  offerId: string | null
  priceCents: number | null
  anchor: HTMLElement
}

const ITEM_PATTERN = /MLB\d{6,}/i

export function isSupportedCommercialPage(url: URL): boolean {
  const path = `${url.pathname}${url.search}`.toLowerCase()
  return ["promoc", "anuncio", "publica", "preco", "price"].some((part) => path.includes(part))
}

export function findCommercialTargets(root: ParentNode = document): CommercialTarget[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    "[data-item-id], [data-testid*='item'], [data-id*='MLB'], a[href*='MLB']",
  ))
  const targets = new Map<string, CommercialTarget>()
  for (const candidate of candidates) {
    const itemId = extractItemId(candidate)
    if (!itemId) continue
    const anchor = candidate.closest<HTMLElement>("[data-item-id], article, li, tr, section") ?? candidate.parentElement ?? candidate
    const promotionId = readAttribute(candidate, anchor, ["data-promotion-id", "data-campaign-id"])
    const promotionType = readAttribute(candidate, anchor, ["data-promotion-type", "data-campaign-type"])
    const offerId = readAttribute(candidate, anchor, ["data-offer-id"])
    const priceCents = extractPrice(candidate, anchor)
    const key = [itemId, promotionType, promotionId, offerId].filter(Boolean).join(":")
    if (!targets.has(key)) targets.set(key, { key, itemId, promotionId, promotionType, offerId, priceCents, anchor })
  }
  return Array.from(targets.values()).slice(0, 50)
}

function extractItemId(element: HTMLElement): string | null {
  for (const value of [
    element.dataset.itemId,
    element.getAttribute("data-id"),
    element.getAttribute("href"),
    element.textContent,
  ]) {
    const match = String(value ?? "").match(ITEM_PATTERN)
    if (match) return match[0].toUpperCase()
  }
  return null
}

function readAttribute(element: HTMLElement, anchor: HTMLElement, names: string[]): string | null {
  for (const name of names) {
    const value = element.getAttribute(name) ?? anchor.getAttribute(name)
    if (value?.trim()) return value.trim()
  }
  return null
}

function extractPrice(element: HTMLElement, anchor: HTMLElement): number | null {
  const explicit = element.getAttribute("data-price") ?? anchor.getAttribute("data-price")
  if (explicit) return parseMoney(explicit)
  const text = anchor.textContent ?? element.textContent ?? ""
  const match = text.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i)
  return match ? parseMoney(match[1]) : null
}

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}
