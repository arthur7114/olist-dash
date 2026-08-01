import { useCallback, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { PricingEvaluation } from "@oem/contracts"
import { findCommercialTargets, isSupportedCommercialPage, type CommercialTarget } from "./adapters"
import type { ExtensionReply } from "./types"

const HOST_ATTRIBUTE = "data-oem-pricing-host"
const mounted = new Map<string, { host: HTMLElement; root: Root }>()
let scheduled = 0
let lastUrl = location.href

scan()
const observer = new MutationObserver(scheduleScan)
observer.observe(document.documentElement, { childList: true, subtree: true })
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    clearMounts()
    scheduleScan()
  }
}, 800)

function scheduleScan() {
  window.clearTimeout(scheduled)
  scheduled = window.setTimeout(scan, 250)
}

function scan() {
  if (!isSupportedCommercialPage(new URL(location.href))) return
  for (const [key, mount] of mounted) {
    if (mount.host.isConnected) continue
    mount.root.unmount()
    mounted.delete(key)
  }
  for (const target of findCommercialTargets()) {
    if (mounted.has(target.key)) continue
    mountTarget(target)
  }
}

function mountTarget(target: CommercialTarget) {
  const wrapper = target.anchor.tagName === "TR" ? document.createElement("td") : document.createElement("span")
  const host = document.createElement("span")
  host.setAttribute(HOST_ATTRIBUTE, target.key)
  wrapper.append(host)
  target.anchor.append(wrapper)
  const shadow = host.attachShadow({ mode: "open" })
  const root = document.createElement("span")
  const style = document.createElement("style")
  style.textContent = SHADOW_CSS
  shadow.append(style, root)
  const reactRoot = createRoot(root)
  reactRoot.render(<InjectedPricing target={target} />)
  mounted.set(target.key, { host, root: reactRoot })
}

function clearMounts() {
  for (const mount of mounted.values()) {
    mount.root.unmount()
    mount.host.parentElement?.remove()
  }
  mounted.clear()
}

function InjectedPricing({ target }: { target: CommercialTarget }) {
  const [evaluation, setEvaluation] = useState<PricingEvaluation | null>(null)
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const reply = target.promotionId && target.promotionType
      ? await send<{ results: Array<{ ok: boolean; evaluation?: PricingEvaluation; error?: string }> }>({
        type: "oem:request",
        path: "/api/extension/promotions/evaluate",
        init: { method: "POST", body: { entries: [{ itemId: target.itemId, promotionId: target.promotionId, type: target.promotionType, offerId: target.offerId }], includeTargetPrices: true } },
      })
      : target.priceCents
        ? await send<{ evaluation: PricingEvaluation }>({
          type: "oem:request",
          path: "/api/extension/pricing/simulate",
          init: { method: "POST", body: { itemId: target.itemId, candidatePriceCents: target.priceCents } },
        })
        : { ok: false as const, error: "Preço ou promoção não identificado nesta tela." }
    if (!reply.ok) setError(reply.error)
    else if ("results" in reply.data) {
      const result = reply.data.results[0]
      if (result?.ok && result.evaluation) setEvaluation(result.evaluation)
      else setError(result?.error ?? "Promoção não avaliada.")
    } else setEvaluation(reply.data.evaluation)
    setLoading(false)
  }, [target])

  useEffect(() => { void load() }, [load])

  async function refresh() {
    const reply = await send({ type: "oem:request", path: "/api/extension/refresh", init: { method: "POST", body: { itemIds: [target.itemId] } } })
    if (!reply.ok) return setError(reply.error)
    await load()
  }

  const status = loading ? "Carregando" : error ? "Dados incompletos" : recommendationLabel(evaluation)
  const tone = loading ? "neutral" : error || evaluation?.recommendation === "incomplete" ? "incomplete" : evaluation?.recommendation ?? "neutral"
  return <span className="oem-shell">
    <button className={`oem-badge ${tone}`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>OEM · {status}{evaluation?.marginBps != null ? ` · ${(evaluation.marginBps / 100).toFixed(1)}%` : ""}</button>
    {expanded && <span className="oem-popover">
      <strong>{target.itemId}</strong>
      {error ? <span className="oem-error">{error}</span> : evaluation && <>
        {evaluation.blockedReasons.length > 0 && <span className="oem-error">{evaluation.blockedReasons.join(" ")}</span>}
        <Line label="Preço analisado" value={money(evaluation.item.candidatePriceCents)} />
        <Line label="Tarifa" value={money(-evaluation.breakdown.saleFeeCents)} />
        <Line label="Frete" value={money(-evaluation.breakdown.shippingCents)} />
        <Line label="Produto" value={money(-evaluation.breakdown.productCostCents)} />
        <Line label="Impostos + Ads" value={money(-evaluation.breakdown.taxCents - evaluation.breakdown.adsCents)} />
        <Line label="Margem" value={money(evaluation.marginCents)} strong />
        {evaluation.minimumPriceCents != null && <Line label="Preço mínimo" value={money(evaluation.minimumPriceCents)} />}
        {evaluation.targetPriceCents != null && <Line label="Preço-alvo" value={money(evaluation.targetPriceCents)} />}
        <span className="oem-meta">Calculado em {new Date(evaluation.calculatedAt).toLocaleString("pt-BR")} · {evaluation.sources.map((source) => source.source).filter((source, index, all) => all.indexOf(source) === index).join(", ")}</span>
      </>}
      <button className="oem-refresh" onClick={refresh} disabled={loading}>Atualizar agora</button>
    </span>}
  </span>
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <span className={`oem-line ${strong ? "strong" : ""}`}><span>{label}</span><span>{value}</span></span>
}

function recommendationLabel(value: PricingEvaluation | null) {
  if (!value) return "Não avaliado"
  return { recommended: "Recomendado", review: "Revisar", avoid: "Evitar", incomplete: "Dados incompletos" }[value.recommendation]
}
function money(cents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100) }
function send<T = unknown>(message: unknown): Promise<ExtensionReply<T>> { return chrome.runtime.sendMessage(message) }

const SHADOW_CSS = `
  :host { position: relative; display: inline-flex; margin: 6px; font-family: Inter,Arial,sans-serif; z-index: 20; }
  * { box-sizing: border-box; }
  .oem-shell { position: relative; display: inline-flex; }
  .oem-badge { border: 0; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer; color: #344054; background: #f2f4f7; }
  .oem-badge.recommended { color: #067647; background: #ecfdf3; }
  .oem-badge.review { color: #b54708; background: #fffaeb; }
  .oem-badge.avoid { color: #b42318; background: #fef3f2; }
  .oem-badge.incomplete { color: #475467; background: #f2f4f7; border: 1px solid #d0d5dd; }
  .oem-popover { position: absolute; top: calc(100% + 8px); right: 0; display: grid; gap: 8px; width: 310px; padding: 14px; border: 1px solid #d0d5dd; border-radius: 12px; background: white; color: #101828; box-shadow: 0 12px 30px rgba(16,24,40,.18); font-size: 12px; }
  .oem-line { display: flex; justify-content: space-between; gap: 14px; color: #475467; }
  .oem-line.strong { color: #101828; font-weight: 800; padding-top: 7px; border-top: 1px solid #eaecf0; }
  .oem-error { color: #b42318; line-height: 1.4; }
  .oem-meta { color: #667085; font-size: 10px; line-height: 1.4; }
  .oem-refresh { border: 0; border-radius: 8px; background: #3b4cca; color: white; padding: 8px; font-weight: 700; cursor: pointer; }
`
