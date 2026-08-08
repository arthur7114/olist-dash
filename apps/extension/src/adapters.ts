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
const PRICE_PATTERN = /R\$\s*([\d.]+(?:,\d{1,2})?)/i
const CANDIDATE_SELECTOR = "[data-item-id], [data-testid*='item'], [data-id*='MLB'], a[href*='MLB']"
const ANCHOR_SELECTOR = "[data-item-id], article, li, tr, section"
const MAX_ANCHOR_HOPS = 6

export function isSupportedCommercialPage(url: URL): boolean {
  const path = `${url.pathname}${url.search}`.toLowerCase()
  return ["promoc", "anuncio", "publica", "preco", "price"].some((part) => path.includes(part))
}

export function findCommercialTargets(root: ParentNode = document): CommercialTarget[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR))
  const targets = new Map<string, CommercialTarget>()
  for (const candidate of candidates) {
    const itemId = extractItemId(candidate)
    if (!itemId) continue
    const anchor = resolveAnchor(candidate)
    const promotionId = readAttribute(candidate, anchor, ["data-promotion-id", "data-campaign-id"])
    const promotionType = readAttribute(candidate, anchor, ["data-promotion-type", "data-campaign-type"])
    const offerId = readAttribute(candidate, anchor, ["data-offer-id"])
    const priceCents = extractPrice(candidate, anchor)
    const identity = [itemId, promotionType, promotionId, offerId].filter((value) => value != null && value !== "").join(":")
    // O mesmo anúncio aparece em cards auxiliares (recomendações, tarefas) que
    // não exibem preço nenhum. Fica com o candidato que enxerga o preço.
    const known = targets.get(identity)
    if (known && (known.priceCents != null || priceCents == null)) continue
    const key = [identity, priceCents].filter((value) => value != null && value !== "").join(":")
    targets.set(identity, { key, itemId, promotionId, promotionType, offerId, priceCents, anchor })
  }
  return Array.from(targets.values()).slice(0, 50)
}

// Sobe até o ancestral mais próximo que exiba um preço, parando antes de
// alcançar um container que agrupe vários anúncios — lá o primeiro R$ seria de
// outro item. Sem isso a pílula ancora no card errado e fica sem preço.
function resolveAnchor(candidate: HTMLElement): HTMLElement {
  const fallback = candidate.closest<HTMLElement>(ANCHOR_SELECTOR) ?? candidate.parentElement ?? candidate
  let current: HTMLElement | null = candidate
  for (let hop = 0; hop < MAX_ANCHOR_HOPS && current && current.tagName !== "BODY"; hop++) {
    if (countItemIds(current) > 1) break
    if (PRICE_PATTERN.test(current.textContent ?? "") || current.getAttribute("data-price")) return current
    current = current.parentElement
  }
  return fallback
}

function countItemIds(element: HTMLElement): number {
  const ids = new Set<string>()
  const own = extractItemId(element)
  if (own) ids.add(own)
  for (const node of element.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
    const id = extractItemId(node)
    if (id) ids.add(id)
  }
  return ids.size
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
  const match = text.match(PRICE_PATTERN)
  return match ? parseMoney(match[1]) : null
}

function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".")
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}
