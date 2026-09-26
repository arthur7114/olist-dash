import { describe, expect, it, vi } from "vitest"
import { completeMlAuthorization, getMlUserAccessToken, type MlCredentialStore, type MlUserCredentials } from "@/lib/ml-user-token"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function memoryStore(initial: MlUserCredentials | null = null): MlCredentialStore & { current: MlUserCredentials | null } {
  const store = {
    current: initial,
    load: async () => store.current,
    save: async (c: MlUserCredentials) => {
      store.current = c
    },
  }
  return store
}

const env = { clientId: "id", clientSecret: "secret", sellerId: "587857974" }
const now = new Date("2026-09-26T12:00:00Z")

describe("completeMlAuthorization", () => {
  it("troca o code e guarda o token da conta vendedora", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "APP_USR-a", refresh_token: "TG-r1", expires_in: 21600, user_id: 587857974, scope: "offline_access read write" }),
    )
    const store = memoryStore()

    const result = await completeMlAuthorization({
      code: "TG-code",
      redirectUri: "https://olist-dash.vercel.app/ml/callback",
      store,
      fetchFn: fetchFn as unknown as typeof fetch,
      env,
      now: () => now,
    })

    expect(result).toEqual({ userId: "587857974" })
    expect(store.current).toEqual({
      userId: "587857974",
      accessToken: "APP_USR-a",
      refreshToken: "TG-r1",
      accessExpiresAt: new Date("2026-09-26T18:00:00Z"),
      scope: "offline_access read write",
    })
    const body = new URLSearchParams(String(fetchFn.mock.calls[0][1].body))
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("TG-code")
    expect(body.get("redirect_uri")).toBe("https://olist-dash.vercel.app/ml/callback")
  })

  it("recusa autorização feita com outra conta do Mercado Livre e não grava nada", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "APP_USR-x", refresh_token: "TG-x", expires_in: 21600, user_id: 111 }),
    )
    const store = memoryStore()

    await expect(
      completeMlAuthorization({
        code: "TG-code",
        redirectUri: "https://olist-dash.vercel.app/ml/callback",
        store,
        fetchFn: fetchFn as unknown as typeof fetch,
        env,
        now: () => now,
      }),
    ).rejects.toThrow(/outra conta/)
    expect(store.current).toBeNull()
  })
})

const stored: MlUserCredentials = {
  userId: "587857974",
  accessToken: "APP_USR-old",
  refreshToken: "TG-r1",
  accessExpiresAt: new Date("2026-09-26T15:00:00Z"),
  scope: null,
}

describe("getMlUserAccessToken", () => {
  it("devolve o token guardado enquanto ele ainda vale, sem chamar o Mercado Livre", async () => {
    const fetchFn = vi.fn()
    const token = await getMlUserAccessToken({
      store: memoryStore(stored),
      fetchFn: fetchFn as unknown as typeof fetch,
      env,
      now: () => now,
    })
    expect(token).toBe("APP_USR-old")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("renova o token vencido e guarda o refresh novo, que é de uso único", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "APP_USR-new", refresh_token: "TG-r2", expires_in: 21600, user_id: 587857974, scope: "read write" }),
    )
    const store = memoryStore({ ...stored, accessExpiresAt: new Date("2026-09-26T11:00:00Z") })

    const token = await getMlUserAccessToken({ store, fetchFn: fetchFn as unknown as typeof fetch, env, now: () => now })

    expect(token).toBe("APP_USR-new")
    const body = new URLSearchParams(String(fetchFn.mock.calls[0][1].body))
    expect(body.get("grant_type")).toBe("refresh_token")
    expect(body.get("refresh_token")).toBe("TG-r1")
    expect(store.current).toEqual({
      userId: "587857974",
      accessToken: "APP_USR-new",
      refreshToken: "TG-r2",
      accessExpiresAt: new Date("2026-09-26T18:00:00Z"),
      scope: "read write",
    })
  })

  it("se outra chamada renovou primeiro, usa o token que ela guardou", async () => {
    const expired = { ...stored, accessExpiresAt: new Date("2026-09-26T11:00:00Z") }
    const winner = { ...stored, accessToken: "APP_USR-winner", refreshToken: "TG-r2", accessExpiresAt: new Date("2026-09-26T18:00:00Z") }
    const store = memoryStore(expired)
    const load = vi.spyOn(store, "load").mockResolvedValueOnce(expired).mockResolvedValueOnce(winner)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant", message: "Error validating grant" }, 400))

    const token = await getMlUserAccessToken({ store, fetchFn: fetchFn as unknown as typeof fetch, env, now: () => now })

    expect(token).toBe("APP_USR-winner")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("sem autorização guardada, pede para autorizar pelo painel", async () => {
    await expect(getMlUserAccessToken({ store: memoryStore(), fetchFn: vi.fn() as unknown as typeof fetch, env, now: () => now })).rejects.toThrow(
      /ml\/authorize/,
    )
  })

  it("refresh recusado e nenhum token novo guardado: pede para autorizar de novo", async () => {
    const store = memoryStore({ ...stored, accessExpiresAt: new Date("2026-09-26T11:00:00Z") })
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400))

    await expect(getMlUserAccessToken({ store, fetchFn: fetchFn as unknown as typeof fetch, env, now: () => now })).rejects.toThrow(
      /ml\/authorize/,
    )
  })
})
