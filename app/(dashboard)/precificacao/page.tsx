"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { PricingEvaluation, PricingOverride, PricingSettings } from "@oem/contracts"
import { AlertTriangle, Calculator, CheckCircle2, Download, RefreshCw, Save, Tags } from "lucide-react"
import { PageTitle } from "@/components/dashboard/page-title"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type CatalogItem = {
  itemId: string
  sellerSku: string | null
  title: string
  currentPriceCents: number | null
  status: string
  syncedAt: string
}

type CatalogPromotion = {
  key: string
  itemId: string
  promotionId: string
  offerId: string | null
  type: string
  status: string
  name: string
  originalPriceCents: number | null
  candidatePriceCents: number | null
  feeReductionCents: number
  syncedAt: string
}

const EMPTY_SETTINGS: PricingSettings = {
  taxRateBps: null,
  adsRateBps: 0,
  fixedCostCents: 0,
  minimumMarginBps: null,
  targetMarginBps: null,
}

const EMPTY_OVERRIDE: PricingOverride = {
  itemId: "",
  sellerSku: null,
  productCostCents: null,
  shippingCostCents: null,
  taxRateBps: null,
  adsRateBps: null,
  fixedCostCents: null,
  minimumMarginBps: null,
  targetMarginBps: null,
}

export default function PrecificacaoPage() {
  const [apiKey, setApiKey] = useState("")
  const [draftKey, setDraftKey] = useState("")
  const [items, setItems] = useState<CatalogItem[]>([])
  const [promotions, setPromotions] = useState<CatalogPromotion[]>([])
  const [settings, setSettings] = useState<PricingSettings>(EMPTY_SETTINGS)
  const [selectedItemId, setSelectedItemId] = useState("")
  const [candidatePrice, setCandidatePrice] = useState("")
  const [evaluation, setEvaluation] = useState<PricingEvaluation | null>(null)
  const [promotionResults, setPromotionResults] = useState<Record<string, PricingEvaluation>>({})
  const [promotionBaselines, setPromotionBaselines] = useState<Record<string, PricingEvaluation>>({})
  const [promotionSearch, setPromotionSearch] = useState("")
  const [promotionStatus, setPromotionStatus] = useState("all")
  const [promotionRecommendation, setPromotionRecommendation] = useState("all")
  const [override, setOverride] = useState<PricingOverride>(EMPTY_OVERRIDE)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [coverage, setCoverage] = useState({ totalItems: 0, itemsWithCost: 0 })

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    })
    const data = await response.json()
    if (!response.ok || data.ok === false) throw new Error(data.error ?? "Não foi possível concluir a operação.")
    return data
  }, [apiKey])

  const loadOverride = useCallback(async (itemId: string, sellerSku?: string | null) => {
    try {
      const data = await request(`/api/extension/settings?itemId=${encodeURIComponent(itemId)}`)
      setOverride({ ...EMPTY_OVERRIDE, itemId, sellerSku: sellerSku ?? null, ...(data.override ?? {}) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [request])

  const load = useCallback(async () => {
    if (!apiKey) return
    setLoading(true)
    setError("")
    try {
      const [bootstrap, catalog] = await Promise.all([request("/api/extension/bootstrap"), request("/api/extension/catalog")])
      setSettings(bootstrap.settings)
      setLastSync(bootstrap.lastSync)
      setCoverage(bootstrap.coverage)
      setItems(catalog.items)
      setPromotions(catalog.promotions)
      if (!selectedItemId && catalog.items[0]) {
        setSelectedItemId(catalog.items[0].itemId)
        setCandidatePrice(centsToInput(catalog.items[0].currentPriceCents))
      }
      if (!override.itemId && catalog.items[0]) {
        await loadOverride(catalog.items[0].itemId, catalog.items[0].sellerSku)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [apiKey, loadOverride, override.itemId, request, selectedItemId])

  useEffect(() => {
    const saved = sessionStorage.getItem("oem-extension-api-key") ?? ""
    setApiKey(saved)
    setDraftKey(saved)
  }, [])

  useEffect(() => { void load() }, [load])

  const selectedItem = useMemo(() => items.find((item) => item.itemId === selectedItemId), [items, selectedItemId])
  const promotionStatuses = useMemo(() => Array.from(new Set(promotions.map((promotion) => promotion.status))).sort(), [promotions])
  const filteredPromotions = useMemo(() => promotions.filter((promotion) => {
    const item = items.find((row) => row.itemId === promotion.itemId)
    const haystack = `${promotion.name} ${promotion.type} ${promotion.itemId} ${item?.sellerSku ?? ""} ${item?.title ?? ""}`.toLowerCase()
    if (promotionSearch && !haystack.includes(promotionSearch.toLowerCase())) return false
    if (promotionStatus !== "all" && promotion.status !== promotionStatus) return false
    const recommendation = promotionResults[promotion.key]?.recommendation
    return promotionRecommendation === "all" || recommendation === promotionRecommendation
  }), [items, promotionRecommendation, promotionResults, promotionSearch, promotionStatus, promotions])

  function connect() {
    const key = draftKey.trim()
    sessionStorage.setItem("oem-extension-api-key", key)
    setApiKey(key)
  }

  async function simulate() {
    const cents = inputToCents(candidatePrice)
    if (!selectedItemId || cents == null || cents <= 0) return setError("Selecione um anúncio e informe um preço válido.")
    setLoading(true)
    setError("")
    try {
      const data = await request("/api/extension/pricing/simulate", {
        method: "POST",
        body: JSON.stringify({ itemId: selectedItemId, candidatePriceCents: cents }),
      })
      setEvaluation(data.evaluation)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setLoading(false) }
  }

  async function saveSettings() {
    setLoading(true)
    setError("")
    try {
      const normalized = { ...settings, adsRateBps: settings.adsRateBps ?? 0, fixedCostCents: settings.fixedCostCents ?? 0 }
      await request("/api/extension/settings", { method: "PUT", body: JSON.stringify({ settings: normalized }) })
      setSettings(normalized)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  async function saveOverride() {
    if (!override.itemId) return setError("Selecione um anúncio para salvar o override.")
    setLoading(true)
    setError("")
    try {
      await request("/api/extension/settings", { method: "PUT", body: JSON.stringify({ override }) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  async function evaluatePromotions() {
    const batch = filteredPromotions.filter((promotion) => promotion.candidatePriceCents != null).slice(0, 50)
    if (!batch.length) return setError("Nenhuma promoção com preço candidato está disponível.")
    setLoading(true)
    setError("")
    try {
      const data = await request("/api/extension/promotions/evaluate", {
        method: "POST",
        body: JSON.stringify({ entries: batch.map(({ itemId, promotionId, type, offerId }) => ({ itemId, promotionId, type, offerId })) }),
      })
      const next: Record<string, PricingEvaluation> = {}
      const baselines: Record<string, PricingEvaluation> = {}
      data.results.forEach((result: { entry: { itemId: string; promotionId: string; type: string }; ok: boolean; evaluation?: PricingEvaluation; currentEvaluation?: PricingEvaluation | null }) => {
        if (!result.ok || !result.evaluation) return
        const promotion = batch.find((row) => row.itemId === result.entry.itemId && row.promotionId === result.entry.promotionId && row.type === result.entry.type)
        if (promotion) {
          next[promotion.key] = result.evaluation
          if (result.currentEvaluation) baselines[promotion.key] = result.currentEvaluation
        }
      })
      setPromotionResults(next)
      setPromotionBaselines(baselines)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  async function refreshVisible() {
    const itemIds = Array.from(new Set(filteredPromotions.slice(0, 50).map((promotion) => promotion.itemId)))
    if (!itemIds.length) return
    setLoading(true)
    setError("")
    try {
      await request("/api/extension/refresh", { method: "POST", body: JSON.stringify({ itemIds }) })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  function exportPromotions() {
    const header = ["item_id", "sku", "titulo", "campanha", "tipo", "status", "preco_original", "preco_promocional", "margem_atual_bps", "recomendacao", "margem_promocional_centavos", "margem_promocional_bps", "motivos"]
    const rows = filteredPromotions.map((promotion) => {
      const item = items.find((row) => row.itemId === promotion.itemId)
      const result = promotionResults[promotion.key]
      const baseline = promotionBaselines[promotion.key]
      return [promotion.itemId, item?.sellerSku, item?.title, promotion.name, promotion.type, promotion.status,
        promotion.originalPriceCents, promotion.candidatePriceCents, baseline?.marginBps, result?.recommendation, result?.marginCents,
        result?.marginBps, result?.blockedReasons.join(" | ")].map(csvCell).join(",")
    })
    const blob = new Blob([`\uFEFF${header.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `promocoes-ml-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageTitle titulo="Precificação e promoções" descricao="Simule preços e avalie campanhas do Mercado Livre antes de decidir." />

      {!apiKey && (
        <Card className="max-w-xl">
          <CardHeader><CardTitle>Conectar ferramenta interna</CardTitle><CardDescription>A chave fica somente nesta sessão do navegador.</CardDescription></CardHeader>
          <CardContent className="flex gap-2">
            <Input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="EXTENSION_API_KEY" />
            <Button onClick={connect}>Conectar</Button>
          </CardContent>
        </Card>
      )}

      {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      {apiKey && (
        <Tabs defaultValue="calculator" className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="calculator"><Calculator /> Calculadora</TabsTrigger>
              <TabsTrigger value="promotions"><Tags /> Promoções</TabsTrigger>
              <TabsTrigger value="settings">Configurações</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Último sync: {lastSync ? new Date(lastSync).toLocaleString("pt-BR") : "não executado"}</span><Button size="sm" variant="ghost" onClick={() => { sessionStorage.removeItem("oem-extension-api-key"); setApiKey("") }}>Trocar chave</Button></div>
          </div>

          <TabsContent value="calculator">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
              <Card><CardHeader><CardTitle>Simular preço</CardTitle><CardDescription>As tarifas e o frete são cotados para o valor informado.</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2"><Label>Anúncio</Label>
                    <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedItemId} onChange={(event) => {
                      setSelectedItemId(event.target.value)
                      const item = items.find((row) => row.itemId === event.target.value)
                      setCandidatePrice(centsToInput(item?.currentPriceCents ?? null))
                      setEvaluation(null)
                    }}>
                      {items.map((item) => <option key={item.itemId} value={item.itemId}>{item.sellerSku ?? item.itemId} · {item.title}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2"><Label>Preço candidato (R$)</Label><Input inputMode="decimal" value={candidatePrice} onChange={(event) => setCandidatePrice(event.target.value)} /></div>
                  <Button onClick={simulate} disabled={loading || !selectedItem}><Calculator /> Simular</Button>
                </CardContent>
              </Card>
              <EvaluationCard evaluation={evaluation} />
            </div>
          </TabsContent>

          <TabsContent value="promotions">
            <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Promoções disponíveis</CardTitle><CardDescription>Até 50 campanhas por avaliação, sem aderir automaticamente.</CardDescription></div>
              <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={exportPromotions} disabled={!filteredPromotions.length}><Download /> Exportar CSV</Button><Button variant="outline" onClick={refreshVisible} disabled={loading}><RefreshCw /> Atualizar</Button><Button onClick={evaluatePromotions} disabled={loading}>Avaliar promoções</Button></div>
            </CardHeader><CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <Input value={promotionSearch} onChange={(event) => setPromotionSearch(event.target.value)} placeholder="Buscar SKU, item, título ou campanha" />
                <select className="h-10 rounded-md border bg-background px-3 text-sm" value={promotionStatus} onChange={(event) => setPromotionStatus(event.target.value)}><option value="all">Todos os status</option>{promotionStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>
                <select className="h-10 rounded-md border bg-background px-3 text-sm" value={promotionRecommendation} onChange={(event) => setPromotionRecommendation(event.target.value)}><option value="all">Todas as recomendações</option><option value="recommended">Recomendado</option><option value="review">Revisar</option><option value="avoid">Evitar</option><option value="incomplete">Dados incompletos</option></select>
              </div>
              {promotions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma promoção sincronizada.</p>}
              {promotions.length > 0 && filteredPromotions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma promoção corresponde aos filtros.</p>}
              {filteredPromotions.slice(0, 50).map((promotion) => {
                const item = items.find((row) => row.itemId === promotion.itemId)
                const result = promotionResults[promotion.key]
                const baseline = promotionBaselines[promotion.key]
                return <div key={promotion.key} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div><div className="font-medium">{item?.sellerSku ?? promotion.itemId} · {item?.title ?? (promotion.name || promotion.type)}</div><div className="text-xs text-muted-foreground">{promotion.type} · {promotion.status} · atualizado {new Date(promotion.syncedAt).toLocaleString("pt-BR")}</div>{result?.blockedReasons.length ? <div className="mt-1 text-xs text-amber-700">{result.blockedReasons.join(" ")}</div> : null}</div>
                  <div className="text-right text-sm tabular-nums"><div>{formatMoney(promotion.originalPriceCents)} → <strong>{formatMoney(promotion.candidatePriceCents)}</strong></div>{result && <div className="text-xs text-muted-foreground">Margem {formatPercent(baseline?.marginBps)} → {formatPercent(result.marginBps)} · contribuição {formatMoney(result.marginCents)}</div>}</div>
                  {result ? <RecommendationBadge evaluation={result} /> : <Badge variant="outline">Não avaliada</Badge>}
                </div>
              })}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="settings"><div className="grid gap-4 xl:grid-cols-2"><SettingsCard settings={settings} coverage={coverage} onChange={setSettings} onSave={saveSettings} loading={loading} /><OverrideCard items={items} value={override} onSelect={(itemId) => {
            const item = items.find((row) => row.itemId === itemId)
            void loadOverride(itemId, item?.sellerSku)
          }} onChange={setOverride} onSave={saveOverride} loading={loading} /></div></TabsContent>
        </Tabs>
      )}
    </>
  )
}

function EvaluationCard({ evaluation }: { evaluation: PricingEvaluation | null }) {
  if (!evaluation) return <Card><CardHeader><CardTitle>Resultado</CardTitle><CardDescription>Faça uma simulação para ver a composição.</CardDescription></CardHeader></Card>
  const lines = [
    ["Receita", evaluation.breakdown.revenueCents], ["Tarifa", -evaluation.breakdown.saleFeeCents],
    ["Redução de tarifa ML", evaluation.breakdown.feeReductionCents], ["Frete", -evaluation.breakdown.shippingCents],
    ["Produto", -evaluation.breakdown.productCostCents], ["Impostos", -evaluation.breakdown.taxCents],
    ["Ads", -evaluation.breakdown.adsCents], ["Custo variável", -evaluation.breakdown.fixedCostCents],
  ] as const
  return <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Resultado</CardTitle><CardDescription>{evaluation.item.itemId}</CardDescription></div><RecommendationBadge evaluation={evaluation} /></CardHeader>
    <CardContent className="space-y-3">{evaluation.blockedReasons.length > 0 && <Alert><AlertTriangle /><AlertDescription>{evaluation.blockedReasons.join(" ")}</AlertDescription></Alert>}
      <div className="rounded-lg border">{lines.map(([label, value]) => <div key={label} className="flex justify-between border-b px-3 py-2 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{formatMoney(value)}</span></div>)}</div>
      <div className="grid grid-cols-3 gap-2 text-center"><Metric label="Margem" value={formatMoney(evaluation.marginCents)} /><Metric label="Preço mínimo" value={formatMoney(evaluation.minimumPriceCents)} /><Metric label="Preço-alvo" value={formatMoney(evaluation.targetPriceCents)} /></div>
      <div className="text-xs text-muted-foreground">Calculado em {new Date(evaluation.calculatedAt).toLocaleString("pt-BR")}. Fontes: {evaluation.sources.map((source) => `${source.field} (${source.source})`).join(", ")}.</div>
    </CardContent></Card>
}

function SettingsCard({ settings, coverage, onChange, onSave, loading }: { settings: PricingSettings; coverage: { totalItems: number; itemsWithCost: number }; onChange: (value: PricingSettings) => void; onSave: () => void; loading: boolean }) {
  const fields: Array<[keyof PricingSettings, string, "rate" | "money"]> = [
    ["taxRateBps", "Imposto padrão (%)", "rate"], ["adsRateBps", "Ads (%)", "rate"],
    ["fixedCostCents", "Custo variável fixo (R$)", "money"], ["minimumMarginBps", "Margem mínima (%)", "rate"],
    ["targetMarginBps", "Margem-alvo (%)", "rate"],
  ]
  return <Card className="max-w-3xl"><CardHeader><CardTitle>Parâmetros financeiros</CardTitle><CardDescription>Imposto e metas são obrigatórios. Ads e custo variável podem permanecer em zero.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
    <div className="rounded-lg bg-muted p-3 text-sm sm:col-span-2"><strong>Cobertura de custos:</strong> {coverage.itemsWithCost} de {coverage.totalItems} anúncios ({coverage.totalItems ? Math.round(coverage.itemsWithCost * 100 / coverage.totalItems) : 0}%). Itens sem custo ficam bloqueados.</div>
    {fields.map(([key, label, kind]) => <div key={key} className="space-y-2"><Label>{label}</Label><Input inputMode="decimal" value={kind === "rate" ? bpsToInput(settings[key] as number | null) : centsToInput(settings[key] as number | null)} onChange={(event) => onChange({ ...settings, [key]: kind === "rate" ? inputToBps(event.target.value) : inputToCents(event.target.value) })} /></div>)}
    <div className="sm:col-span-2"><Button onClick={onSave} disabled={loading}><Save /> Salvar configurações</Button></div>
  </CardContent></Card>
}

function OverrideCard({ items, value, onSelect, onChange, onSave, loading }: { items: CatalogItem[]; value: PricingOverride; onSelect: (itemId: string) => void; onChange: (value: PricingOverride) => void; onSave: () => void; loading: boolean }) {
  const fields: Array<[keyof PricingOverride, string, "rate" | "money"]> = [
    ["productCostCents", "Custo do produto (R$)", "money"], ["shippingCostCents", "Frete do vendedor (R$)", "money"],
    ["taxRateBps", "Imposto (%)", "rate"], ["adsRateBps", "Ads (%)", "rate"],
    ["fixedCostCents", "Custo variável fixo (R$)", "money"], ["minimumMarginBps", "Margem mínima (%)", "rate"],
    ["targetMarginBps", "Margem-alvo (%)", "rate"],
  ]
  return <Card><CardHeader><CardTitle>Overrides por anúncio</CardTitle><CardDescription>Campos vazios herdam os padrões ou os dados sincronizados.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2 sm:col-span-2"><Label>Anúncio</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value.itemId} onChange={(event) => onSelect(event.target.value)}>{items.map((item) => <option key={item.itemId} value={item.itemId}>{item.sellerSku ?? item.itemId} · {item.title}</option>)}</select></div>
    {fields.map(([key, label, kind]) => <div key={key} className="space-y-2"><Label>{label}</Label><Input inputMode="decimal" value={kind === "rate" ? bpsToInput(value[key] as number | null | undefined) : centsToInput(value[key] as number | null | undefined)} onChange={(event) => onChange({ ...value, [key]: kind === "rate" ? inputToBps(event.target.value) : inputToCents(event.target.value) })} /></div>)}
    <div className="sm:col-span-2"><Button onClick={onSave} disabled={loading || !value.itemId}><Save /> Salvar override</Button></div>
  </CardContent></Card>
}

function RecommendationBadge({ evaluation }: { evaluation: PricingEvaluation }) {
  const labels = { recommended: "Recomendado", review: "Revisar", avoid: "Evitar", incomplete: "Dados incompletos" }
  const variant = evaluation.recommendation === "recommended" ? "default" : evaluation.recommendation === "incomplete" ? "outline" : "secondary"
  return <Badge variant={variant}>{evaluation.recommendation === "recommended" && <CheckCircle2 />} {labels[evaluation.recommendation]}{evaluation.marginBps != null ? ` · ${(evaluation.marginBps / 100).toFixed(1)}%` : ""}</Badge>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold tabular-nums">{value}</div></div> }
function formatMoney(cents: number | null) { return cents == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100) }
function formatPercent(bps: number | null | undefined) { return bps == null ? "—" : `${(bps / 100).toFixed(1).replace(".", ",")}%` }
function centsToInput(cents: number | null | undefined) { return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",") }
function bpsToInput(bps: number | null | undefined) { return bps == null ? "" : (bps / 100).toFixed(2).replace(".", ",") }
function inputToCents(value: string) { if (!value.trim()) return null; const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) ? Math.round(parsed * 100) : null }
function inputToBps(value: string) { if (!value.trim()) return null; const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) ? Math.round(parsed * 100) : null }
function csvCell(value: unknown) { const content = value == null ? "" : String(value); return /[",\n]/.test(content) ? `"${content.replaceAll('"', '""')}"` : content }
