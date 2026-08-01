import { afterEach, describe, expect, it } from "vitest"
import { POST } from "@/app/api/ml/products/evolution/sync/route"

const originalSecret = process.env.OLIST_SYNC_SECRET

afterEach(() => {
  if (originalSecret === undefined) delete process.env.OLIST_SYNC_SECRET
  else process.env.OLIST_SYNC_SECRET = originalSecret
})

describe("POST /api/ml/products/evolution/sync", () => {
  it("rejects requests without the protected job secret before touching external services", async () => {
    process.env.OLIST_SYNC_SECRET = "expected-secret"
    const response = await POST(
      new Request("http://localhost/api/ml/products/evolution/sync", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Não autorizado." })
  })

  it("fails closed when the server secret is not configured", async () => {
    delete process.env.OLIST_SYNC_SECRET
    const response = await POST(
      new Request("http://localhost/api/ml/products/evolution/sync", { method: "POST" }),
    )

    expect(response.status).toBe(500)
  })
})
