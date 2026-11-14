import { describe, expect, it } from "vitest"
import { OLIST_CONTAS, cnpjConfere, lerCookieEstado, olistAppCredentials, parseOlistConta } from "@/lib/olist-contas"

describe("contas Olist", () => {
  it("lê a conta do parâmetro: vazio é a atual, sp é sp, o resto é recusado", () => {
    expect(parseOlistConta(null)).toBe("atual")
    expect(parseOlistConta("")).toBe("atual")
    expect(parseOlistConta("sp")).toBe("sp")
    expect(parseOlistConta("rj")).toBeNull()
  })

  it("cada empresa tem a própria linha", () => {
    expect(OLIST_CONTAS.atual.rowId).toBe(1)
    expect(OLIST_CONTAS.sp.rowId).toBe(2)
  })

  it("usa as chaves do aplicativo de cada empresa", () => {
    const env = { OLIST_CLIENT_ID: "a", OLIST_CLIENT_SECRET: "as", OLIST_SP_CLIENT_ID: "b", OLIST_SP_CLIENT_SECRET: "bs" }
    expect(olistAppCredentials("atual", env)).toEqual({ clientId: "a", clientSecret: "as" })
    expect(olistAppCredentials("sp", env)).toEqual({ clientId: "b", clientSecret: "bs" })
  })

  it("aponta a variável que falta, sem cair nas chaves da outra empresa", () => {
    expect(() => olistAppCredentials("sp", { OLIST_CLIENT_ID: "a", OLIST_CLIENT_SECRET: "as" })).toThrow(/OLIST_SP_CLIENT_ID/)
  })

  it("confere o CNPJ da SP com ou sem pontuação; a atual não confere", () => {
    expect(cnpjConfere("sp", "69.810.113/0001-59")).toBe(true)
    expect(cnpjConfere("sp", "69810113000159")).toBe(true)
    expect(cnpjConfere("sp", "11.111.111/0001-11")).toBe(false)
    expect(cnpjConfere("sp", undefined)).toBe(false)
    expect(cnpjConfere("atual", undefined)).toBe(true)
  })

  it("lê o cookie novo com a conta e o antigo como conta atual", () => {
    expect(lerCookieEstado("sp.abc-123")).toEqual({ conta: "sp", state: "abc-123" })
    expect(lerCookieEstado("atual.abc-123")).toEqual({ conta: "atual", state: "abc-123" })
    expect(lerCookieEstado("abc-123")).toEqual({ conta: "atual", state: "abc-123" })
    expect(lerCookieEstado("rj.abc")).toEqual({ conta: null, state: "abc" })
    expect(lerCookieEstado(undefined)).toEqual({ conta: null, state: undefined })
  })
})
