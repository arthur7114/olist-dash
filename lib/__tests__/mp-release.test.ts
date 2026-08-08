import { describe, expect, it } from "vitest"
import { aggregateRelease, fetchMlOrderRelease, type MpPaymentRelease } from "@/lib/mp-release"
import { extractOcNumber, isReceivableOpen, buildBaixaBody, formatDateBr } from "@/lib/olist-v3"
import { indexReceivablesByOc } from "@/lib/mp-reconcile"

const payment = (over: Partial<MpPaymentRelease>): MpPaymentRelease => ({
  paymentId: 1,
  status: "approved",
  moneyReleaseStatus: "released",
  moneyReleaseDate: "2026-06-20T14:01:19.000-04:00",
  amount: 100,
  ...over,
})

describe("aggregateRelease", () => {
  it("libera quando todos os pagamentos aprovados estão released", () => {
    const result = aggregateRelease("123", [
      payment({ paymentId: 1, amount: 100 }),
      payment({ paymentId: 2, amount: 50.5, moneyReleaseDate: "2026-06-22T10:00:00.000-04:00" }),
    ])
    expect(result.releaseStatus).toBe("released")
    expect(result.amount).toBe(150.5)
    // A data de liberação do pedido é a MAIS TARDIA entre os pagamentos.
    expect(result.releaseDate).toBe("2026-06-22T10:00:00.000-04:00")
  })

  it("fica pendente se qualquer pagamento aprovado ainda não liberou", () => {
    const result = aggregateRelease("123", [
      payment({ paymentId: 1 }),
      payment({ paymentId: 2, moneyReleaseStatus: "pending" }),
    ])
    expect(result.releaseStatus).toBe("pending")
  })

  it("ignora pagamentos não aprovados no veredito", () => {
    const result = aggregateRelease("123", [
      payment({ paymentId: 1, status: "rejected", moneyReleaseStatus: null, amount: 999 }),
      payment({ paymentId: 2, amount: 80 }),
    ])
    expect(result.releaseStatus).toBe("released")
    expect(result.amount).toBe(80)
  })

  it("sem pagamento aprovado não há o que conciliar", () => {
    expect(aggregateRelease("123", []).releaseStatus).toBe("no_payments")
    expect(aggregateRelease("123", [payment({ status: "refunded" })]).releaseStatus).toBe("no_payments")
  })

  it("pagamento em mediação vira 'disputed', não 'no_payments'", () => {
    // Caso real: pedido entregue, dinheiro até liberado, mas em mediação no ML —
    // pode ser revertido, então a conta a receber fica aberta de propósito.
    const result = aggregateRelease("123", [
      payment({ status: "in_mediation", moneyReleaseStatus: "released", amount: 77.6 }),
    ])
    expect(result.releaseStatus).toBe("disputed")
    expect(result.amount).toBe(77.6)
    expect(result.releaseDate).toBeNull()
  })

  it("chargeback também conta como disputa", () => {
    expect(aggregateRelease("123", [payment({ status: "charged_back" })]).releaseStatus).toBe("disputed")
  })

  it("disputa não vence pagamento aprovado e liberado", () => {
    const result = aggregateRelease("123", [
      payment({ paymentId: 1, status: "in_mediation", amount: 10 }),
      payment({ paymentId: 2, status: "approved", amount: 20 }),
    ])
    expect(result.releaseStatus).toBe("released")
    expect(result.amount).toBe(20)
  })
})

describe("fetchMlOrderRelease", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  it("resolve pack e consulta cada pagamento no MP", async () => {
    const calls: string[] = []
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith("/orders/999")) return jsonResponse({ message: "not found" }, 404)
      if (url.endsWith("/packs/999")) return jsonResponse({ id: 999, orders: [{ id: 111 }] })
      if (url.endsWith("/orders/111"))
        return jsonResponse({ id: 111, status: "paid", payments: [{ id: 555, status: "approved" }] })
      if (url.endsWith("/v1/payments/555"))
        return jsonResponse({
          id: 555,
          status: "approved",
          money_release_status: "released",
          money_release_date: "2026-06-20T14:01:19.000-04:00",
          transaction_amount: 261.61,
        })
      throw new Error(`URL inesperada: ${url}`)
    }) as typeof fetch

    const result = await fetchMlOrderRelease("999", "token", fetchFn)
    expect(result.releaseStatus).toBe("released")
    expect(result.amount).toBe(261.61)
    expect(result.payments).toHaveLength(1)
    expect(calls.some((u) => u.includes("api.mercadopago.com/v1/payments/555"))).toBe(true)
  })

  it("propaga falha na consulta de pagamento (não inventa veredito)", async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/orders/1"))
        return jsonResponse({ id: 1, status: "paid", payments: [{ id: 7, status: "approved" }] })
      return new Response("boom", { status: 500 })
    }) as typeof fetch

    await expect(fetchMlOrderRelease("1", "token", fetchFn)).rejects.toThrow(/\/v1\/payments\/7/)
  })

  it("not_found quando nem order nem pack existem", async () => {
    const fetchFn = (async () => new Response("{}", { status: 404 })) as typeof fetch
    const result = await fetchMlOrderRelease("42", "token", fetchFn)
    expect(result.releaseStatus).toBe("not_found")
  })
})

describe("extractOcNumber", () => {
  it("extrai o OC do historico real da Olist", () => {
    expect(
      extractOcNumber("Ref. a NF nº 2653, Adelino da Cruz Martins Nunes - OC nº 2000014421256617"),
    ).toBe("2000014421256617")
  })

  it("aceita variações de grafia do nº", () => {
    expect(extractOcNumber("OC no 2000014421256617")).toBe("2000014421256617")
    expect(extractOcNumber("oc n° 2000014421256617")).toBe("2000014421256617")
  })

  it("não confunde com o número da NF", () => {
    expect(extractOcNumber("Ref. a NF nº 2655, AUTO PECAS SANTO ANTONIO LTDA ME")).toBeUndefined()
    expect(extractOcNumber(undefined)).toBeUndefined()
  })
})

describe("indexReceivablesByOc", () => {
  it("agrupa contas pelo OC e descarta as sem vínculo", () => {
    const map = indexReceivablesByOc([
      { id: 1, historico: "Ref. a NF nº 2653, Fulano - OC nº 2000014421256617", situacao: "aberto" },
      { id: 2, historico: "Ref. a NF nº 2653, Fulano - OC nº 2000014421256617", situacao: "pago" },
      { id: 3, historico: "Ref. a NF nº 159, Consumidor Final", situacao: "pago" },
    ])
    expect(map.get("2000014421256617")?.map((r) => r.id)).toEqual([1, 2])
    expect(map.size).toBe(1)
  })
})

describe("isReceivableOpen", () => {
  it("aberto/parcial/atrasadas/prevista podem ser baixadas; pago/cancelada não", () => {
    expect(isReceivableOpen({ situacao: "aberto" })).toBe(true)
    expect(isReceivableOpen({ situacao: "parcial" })).toBe(true)
    expect(isReceivableOpen({ situacao: "atrasadas" })).toBe(true)
    expect(isReceivableOpen({ situacao: "prevista" })).toBe(true)
    expect(isReceivableOpen({ situacao: "pago" })).toBe(false)
    expect(isReceivableOpen({ situacao: "cancelada" })).toBe(false)
    expect(isReceivableOpen({})).toBe(false)
  })
})

describe("buildBaixaBody", () => {
  it("formata a data em dd/mm/yyyy (fuso de Fortaleza) e arredonda o valor", () => {
    // 2026-09-04T23:04:06-04:00 = 2026-09-05 00:04 em Fortaleza (UTC-3).
    const body = buildBaixaBody({
      valorPago: 109.199,
      data: new Date("2026-09-04T23:04:06.000-04:00"),
      historico: "Baixa automática",
    })
    expect(body).toEqual({ data: "05/09/2026", valorPago: 109.2, historico: "Baixa automática" })
  })

  it("omite historico quando ausente", () => {
    const body = buildBaixaBody({ valorPago: 50, data: new Date("2026-01-10T12:00:00.000Z") })
    expect(body).toEqual({ data: "10/01/2026", valorPago: 50 })
  })
})

describe("formatDateBr", () => {
  it("converte para o dia local de Fortaleza", () => {
    expect(formatDateBr(new Date("2026-08-08T01:00:00.000Z"))).toBe("07/08/2026")
    expect(formatDateBr(new Date("2026-08-08T12:00:00.000Z"))).toBe("08/08/2026")
  })
})
