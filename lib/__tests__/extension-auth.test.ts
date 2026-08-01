import { describe, expect, it } from "vitest"
import { isExtensionAuthorized } from "@/lib/extension-auth"

describe("isExtensionAuthorized", () => {
  it("aceita somente a chave Bearer exata", () => {
    expect(isExtensionAuthorized(new Request("https://oem.test", {
      headers: { Authorization: "Bearer chave-segura" },
    }), "chave-segura")).toBe(true)
    expect(isExtensionAuthorized(new Request("https://oem.test", {
      headers: { Authorization: "Bearer chave" },
    }), "chave-segura")).toBe(false)
  })

  it("não aceita a chave em query string", () => {
    expect(isExtensionAuthorized(
      new Request("https://oem.test?key=chave-segura"),
      "chave-segura",
    )).toBe(false)
  })
})
