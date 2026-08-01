import { describe, expect, it } from "vitest"
import { isAllowedApiRequest } from "./request-policy"

describe("política de requisições do service worker", () => {
  it("permite apenas as rotas e métodos internos necessários", () => {
    expect(isAllowedApiRequest("/api/extension/bootstrap", "GET")).toBe(true)
    expect(isAllowedApiRequest("/api/extension/settings", "PUT")).toBe(true)
    expect(isAllowedApiRequest("/api/extension/refresh", "POST")).toBe(true)
    expect(isAllowedApiRequest("/api/extension/settings", "DELETE")).toBe(false)
  })

  it("bloqueia URLs absolutas e qualquer chamada ao Mercado Livre", () => {
    expect(isAllowedApiRequest("https://api.mercadolibre.com/items/MLB1", "POST")).toBe(false)
    expect(isAllowedApiRequest("/items/MLB1", "PUT")).toBe(false)
  })
})
