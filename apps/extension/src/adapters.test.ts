// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { findCommercialTargets, isSupportedCommercialPage } from "./adapters"

describe("adaptadores do Mercado Livre", () => {
  beforeEach(() => { document.body.innerHTML = "" })

  it("detecta páginas de promoção e precificação", () => {
    expect(isSupportedCommercialPage(new URL("https://www.mercadolivre.com.br/anuncios/promocoes"))).toBe(true)
    expect(isSupportedCommercialPage(new URL("https://www.mercadolivre.com.br/vendas/lista"))).toBe(false)
  })

  it("extrai uma promoção por card sem duplicar links internos", () => {
    document.body.innerHTML = `
      <article data-item-id="MLB123456789" data-promotion-id="P-1" data-promotion-type="DEAL" data-offer-id="OFFER-1">
        <a href="/anuncios/MLB123456789">SKU XPTO</a>
        <a href="/anuncios/MLB123456789">Editar</a>
        <span>Preço final R$ 149,90</span>
      </article>`

    const targets = findCommercialTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      itemId: "MLB123456789",
      promotionId: "P-1",
      promotionType: "DEAL",
      offerId: "OFFER-1",
      priceCents: 14_990,
    })
  })
})
