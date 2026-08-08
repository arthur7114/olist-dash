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

  it("detecta conteúdo carregado depois e muda a assinatura quando o preço muda", () => {
    expect(findCommercialTargets()).toHaveLength(0)
    document.body.innerHTML = `<article data-item-id="MLB987654321"><span>R$ 99,90</span></article>`
    const first = findCommercialTargets()
    document.querySelector("span")!.textContent = "R$ 109,90"
    const second = findCommercialTargets()

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0].priceCents).toBe(9_990)
    expect(second[0].priceCents).toBe(10_990)
    expect(second[0].key).not.toBe(first[0].key)
  })

  it("sobe até o bloco que tem preço quando o id está num card sem R$", () => {
    document.body.innerHTML = `
      <li>
        <span>R$ 1.920,23</span>
        <section>
          <a href="/anuncios/MLB6443601210">Ofereça envios no mesmo dia</a>
          <button>Oferecer envio</button>
        </section>
      </li>`

    const targets = findCommercialTargets()

    expect(targets).toHaveLength(1)
    expect(targets[0].priceCents).toBe(192_023)
    expect(targets[0].anchor.tagName).toBe("LI")
  })

  it("não sobe até um container que agrupe vários anúncios", () => {
    document.body.innerHTML = `
      <div>
        <li><a href="/anuncios/MLB111111111">Primeiro</a></li>
        <li><a href="/anuncios/MLB222222222">Segundo</a></li>
        <span>R$ 500,00</span>
      </div>`

    const targets = findCommercialTargets()

    expect(targets).toHaveLength(2)
    expect(targets.map((target) => target.priceCents)).toEqual([null, null])
  })

  it("monta um alvo só quando o anúncio aparece em dois blocos", () => {
    document.body.innerHTML = `
      <li>
        <section><a href="/anuncios/MLB6443601210">Tarefa pendente</a></section>
        <div><a href="/anuncios/MLB6443601210">Editar</a><span>R$ 149,90</span></div>
      </li>`

    const targets = findCommercialTargets()

    expect(targets).toHaveLength(1)
    expect(targets[0].priceCents).toBe(14_990)
  })

  it("reconhece navegação SPA ao trocar a URL suportada", () => {
    expect(isSupportedCommercialPage(new URL("https://www.mercadolivre.com.br/anuncios/lista"))).toBe(true)
    expect(isSupportedCommercialPage(new URL("https://www.mercadolivre.com.br/vendas/lista"))).toBe(false)
  })
})
