import { describe, expect, it, vi } from "vitest"
import { fetchMlCommercialJson, normalizePromotion } from "@/lib/ml-commercial"

describe("normalizePromotion", () => {
  it("preserva apenas a redução explícita de tarifa e converte preços para centavos", () => {
    const result = normalizePromotion("MLB123", {
      id: "P-1",
      ref_id: "OFFER-1",
      type: "MARKETPLACE_CAMPAIGN",
      status: "candidate",
      name: "Campanha",
      original_price: 100,
      suggested_discounted_price: 85.5,
      discount_meli_boost_amount: 3.25,
      start_date: "2026-08-02T00:00:00Z",
    })

    expect(result).toMatchObject({
      key: "MLB123:MARKETPLACE_CAMPAIGN:P-1:OFFER-1",
      originalPriceCents: 10_000,
      candidatePriceCents: 8_550,
      feeReductionCents: 325,
      startsAt: "2026-08-02T00:00:00.000Z",
    })
  })

  it("não infere cofinanciamento quando a API não informa valor", () => {
    const result = normalizePromotion("MLB123", {
      id: "P-2",
      type: "DEAL",
      status: "candidate",
      name: "Cofinanciada pelo texto",
      price: 90,
      original_price: 100,
    })

    expect(result.feeReductionCents).toBe(0)
  })
})

describe("fetchMlCommercialJson", () => {
  it("não repete erros permanentes de autenticação", async () => {
    const fetchFn = vi.fn(async () => new Response("unauthorized", { status: 401 }))

    await expect(fetchMlCommercialJson("/items/MLB1", "token", undefined, fetchFn)).rejects.toThrow("401")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("repete 429 e preserva a resposta de uma tentativa posterior", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ id: "MLB1" }))

    await expect(fetchMlCommercialJson<{ id: string }>("/items/MLB1", "token", undefined, fetchFn)).resolves.toEqual({ id: "MLB1" })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it("interrompe uma tentativa que excede o timeout", async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}))
    const pending = fetchMlCommercialJson("/items/MLB1", "token", undefined, fetchFn, 25)
    const expectation = expect(pending).rejects.toThrow("tempo limite")
    await vi.advanceTimersByTimeAsync(100)

    await expectation
    vi.useRealTimers()
  })
})
