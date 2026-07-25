import { describe, expect, it } from "vitest"
import { pedidoLiquidado, reconciliar, type ReconcileRow } from "@/lib/reconcile"

const AGORA = new Date("2026-07-25T12:00:00.000Z")

const JANELA = { de: "2026-07-01", ate: "2026-07-31" }

// Pedido com frete: a base do dash (valorTotalProdutos) fica abaixo do total do pedido.
function pedidoComFrete(over: Partial<ReconcileRow> = {}): ReconcileRow {
  return {
    olistId: "1",
    data: "2026-07-10",
    situacao: 1,
    valorVenda: 100,
    valorNota: 120,
    updatedAt: "2026-07-25T09:00:00.000Z",
    raw: {
      valorTotalProdutos: 100,
      valorTotalPedido: 120,
      valor: 120,
      valorFrete: 20,
      valorDesconto: 0,
      valorOutrasDespesas: 0,
    },
    ...over,
  }
}

describe("reconciliar", () => {
  it("soma o período sob cada definição de faturamento", () => {
    const r = reconciliar([pedidoComFrete(), pedidoComFrete({ olistId: "2" })], JANELA)

    expect(r.totais.pedidos).toBe(2)
    expect(r.totais.valorVenda).toBe(200)
    expect(r.totais.valorTotalProdutos).toBe(200)
    expect(r.totais.valorTotalPedido).toBe(240)
    expect(r.totais.valorListagem).toBe(240)
    expect(r.totais.frete).toBe(40)
    expect(r.totais.valorNota).toBe(240)
  })

  it("expõe a divergência entre a base do dash e o total do pedido", () => {
    const r = reconciliar([pedidoComFrete()], JANELA)

    expect(r.divergencias.pedidos).toBe(1)
    expect(r.divergencias.soma).toBe(20)
    expect(r.divergencias.exemplos[0]).toMatchObject({
      olistId: "1",
      valorVenda: 100,
      valorTotalPedido: 120,
      frete: 20,
      diferenca: 20,
    })
  })

  it("não acusa divergência quando as bases coincidem", () => {
    const r = reconciliar(
      [
        pedidoComFrete({
          valorVenda: 120,
          raw: { valorTotalProdutos: 120, valorTotalPedido: 120, valor: 120, valorFrete: 0 },
        }),
      ],
      JANELA,
    )
    expect(r.divergencias.pedidos).toBe(0)
    expect(r.divergencias.soma).toBe(0)
  })

  it("separa os recortes: todos, sem cancelados e só faturados", () => {
    const r = reconciliar(
      [
        pedidoComFrete({ olistId: "1", situacao: 1 }), // Faturado
        pedidoComFrete({ olistId: "2", situacao: 2 }), // Cancelado
        pedidoComFrete({ olistId: "3", situacao: 0 }), // Em aberto
      ],
      JANELA,
    )

    expect(r.totais.pedidos).toBe(3)
    expect(r.totais.valorVenda).toBe(300)
    // Sem cancelados exclui só a situação 2.
    expect(r.totaisSemCancelados.pedidos).toBe(2)
    expect(r.totaisSemCancelados.valorVenda).toBe(200)
    // Faturados exclui cancelado E em aberto.
    expect(r.totaisFaturados.pedidos).toBe(1)
    expect(r.totaisFaturados.valorVenda).toBe(100)
  })

  it("quebra por situação com o rótulo da Olist", () => {
    const r = reconciliar(
      [pedidoComFrete({ olistId: "1", situacao: 2 }), pedidoComFrete({ olistId: "2", situacao: null })],
      JANELA,
    )
    const labels = r.porSituacao.map((l) => l.label)
    expect(labels).toContain("Cancelado")
    expect(labels).toContain("sem situação")
  })

  it("conta pedidos sem raw e sem NF sem quebrar os totais", () => {
    const r = reconciliar(
      [pedidoComFrete({ olistId: "1", raw: null, valorNota: null }), pedidoComFrete({ olistId: "2" })],
      JANELA,
    )

    expect(r.totais.semRaw).toBe(1)
    expect(r.totais.semNota).toBe(1)
    // Sem raw, só valorVenda entra; o total do pedido soma apenas o pedido com detalhe.
    expect(r.totais.valorVenda).toBe(200)
    expect(r.totais.valorTotalPedido).toBe(120)
    expect(r.totais.valorNota).toBe(120)
    // Pedido sem raw não vira divergência (comparação contra zero seria ruído).
    expect(r.divergencias.pedidos).toBe(1)
  })

  it("reporta a extensão real das datas encontradas (sync atrasado fica visível)", () => {
    const r = reconciliar(
      [
        pedidoComFrete({ olistId: "1", data: "2026-07-02" }),
        pedidoComFrete({ olistId: "2", data: "2026-07-18" }),
      ],
      JANELA,
    )
    expect(r.dataMin).toBe("2026-07-02")
    expect(r.dataMax).toBe("2026-07-18")
  })

  it("conta pedidos não liquidados e congelados", () => {
    const r = reconciliar(
      [
        // Ainda mutável e sem sync há 10 dias → congelado.
        pedidoComFrete({ olistId: "congelado", situacao: 3, valorNota: null, updatedAt: "2026-07-15T09:00:00.000Z" }),
        // Ainda mutável, mas sincronizado hoje → não congelado.
        pedidoComFrete({ olistId: "fresco", situacao: 3, valorNota: null, updatedAt: "2026-07-25T09:00:00.000Z" }),
        // Entregue com NF → liquidado, não entra na conta.
        pedidoComFrete({ olistId: "liquidado", situacao: 6, updatedAt: "2026-07-01T09:00:00.000Z" }),
      ],
      JANELA,
      20,
      AGORA,
    )

    expect(r.frescor.naoLiquidados).toBe(2)
    expect(r.frescor.congelados).toBe(1)
    expect(r.frescor.updatedAtMin).toBe("2026-07-01T09:00:00.000Z")
    expect(r.frescor.updatedAtMax).toBe("2026-07-25T09:00:00.000Z")
  })

  it("ordena os exemplos pela maior diferença absoluta", () => {
    const r = reconciliar(
      [
        pedidoComFrete({ olistId: "pequeno", raw: { valorTotalProdutos: 100, valorTotalPedido: 105, valor: 105, valorFrete: 5 } }),
        pedidoComFrete({ olistId: "grande", raw: { valorTotalProdutos: 100, valorTotalPedido: 300, valor: 300, valorFrete: 200 } }),
      ],
      JANELA,
    )
    expect(r.divergencias.exemplos.map((e) => e.olistId)).toEqual(["grande", "pequeno"])
  })
})

// Espelha a cláusula de liquidação de getBackfillSkipIds (lib/db/orders.ts):
// o backfill só pode pular definitivamente o que não muda mais.
describe("pedidoLiquidado", () => {
  it("cancelado está encerrado", () => {
    expect(pedidoLiquidado({ situacao: 2, valorNota: null })).toBe(true)
  })

  it("entregue com NF está completo", () => {
    expect(pedidoLiquidado({ situacao: 6, valorNota: 120 })).toBe(true)
  })

  it("entregue SEM NF ainda precisa da nota", () => {
    expect(pedidoLiquidado({ situacao: 6, valorNota: null })).toBe(false)
  })

  it("em aberto, aprovado e enviado ainda mudam", () => {
    for (const situacao of [0, 1, 3, 4, 5, 7]) {
      expect(pedidoLiquidado({ situacao, valorNota: 120 })).toBe(false)
    }
  })

  it("sem situação não pode ser considerado liquidado", () => {
    expect(pedidoLiquidado({ situacao: null, valorNota: 120 })).toBe(false)
  })
})
