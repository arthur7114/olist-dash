import { describe, expect, it } from "vitest"
import {
  aggregateMlProductMonth,
  classifyEvolution,
  completeMonthWindow,
  evolutionRows,
  groupMonthlyMetrics,
  pendingEvolutionMonths,
  type MlEvolutionOrder,
} from "@/lib/ml-product-evolution"

describe("completeMonthWindow", () => {
  it("uses America/Fortaleza to exclude the month still in progress", () => {
    expect(completeMonthWindow(new Date("2026-08-01T03:00:00.000Z"))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ])

    // Ainda é 31/07 às 23h em Fortaleza.
    expect(completeMonthWindow(new Date("2026-08-01T02:00:00.000Z"))).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ])
  })
})

describe("aggregateMlProductMonth", () => {
  it("deduplicates orders, keeps created and paid bases separate and aggregates multi-item orders", () => {
    const orders: MlEvolutionOrder[] = [
      {
        id: 101,
        status: "paid",
        tags: [],
        order_items: [
          { quantity: 2, unit_price: 100, item: { id: "MLB-A", seller_sku: "SKU-A", title: "Produto A" } },
          { quantity: 1, unit_price: 50, item: { id: "MLB-B", title: "Produto B" } },
        ],
      },
      // Duplicata de paginação: não pode dobrar os valores.
      {
        id: 101,
        status: "paid",
        tags: [],
        order_items: [
          { quantity: 2, unit_price: 100, item: { id: "MLB-A", seller_sku: "SKU-A", title: "Produto A" } },
          { quantity: 1, unit_price: 50, item: { id: "MLB-B", title: "Produto B" } },
        ],
      },
      {
        id: 102,
        status: "cancelled",
        tags: ["cancelled"],
        order_items: [
          { quantity: 1, unit_price: 80, item: { id: "MLB-A", seller_sku: "SKU-A", title: "Produto A" } },
        ],
      },
    ]

    const rows = aggregateMlProductMonth({
      month: "2026-07",
      orders,
      itemDetails: new Map([
        ["MLB-B", { id: "MLB-B", user_product_id: "UP-B", title: "Produto B detalhado" }],
      ]),
      visitsByItem: new Map([
        ["MLB-A", 20],
        ["MLB-B", 10],
      ]),
    })

    expect(rows).toEqual([
      {
        month: "2026-07",
        productKey: "SKU-A",
        title: "Produto A",
        itemIds: ["MLB-A"],
        created: { orders: 2, units: 3, revenue: 280 },
        paid: { orders: 1, units: 2, revenue: 200 },
        visits: 20,
      },
      {
        month: "2026-07",
        productKey: "UP-B",
        title: "Produto B",
        itemIds: ["MLB-B"],
        created: { orders: 1, units: 1, revenue: 50 },
        paid: { orders: 1, units: 1, revenue: 50 },
        visits: 10,
      },
    ])
  })

  it("returns unavailable visits as null instead of inventing zero", () => {
    const rows = aggregateMlProductMonth({
      month: "2026-07",
      orders: [
        {
          id: 1,
          status: "confirmed",
          tags: [],
          order_items: [
            { quantity: 1, unit_price: 10, item: { id: "MLB-1", parent_item_id: "PARENT-1", title: "Produto" } },
          ],
        },
      ],
      itemDetails: new Map(),
      visitsByItem: null,
    })

    expect(rows[0].visits).toBeNull()
    expect(rows[0].productKey).toBe("PARENT-1")
  })

  it("keeps catalog products with visits even when they had no orders in the month", () => {
    const rows = aggregateMlProductMonth({
      month: "2026-07",
      orders: [],
      itemDetails: new Map([
        ["MLB-IDLE", { id: "MLB-IDLE", seller_custom_field: "SKU-IDLE", title: "Produto sem venda" }],
      ]),
      visitsByItem: new Map([["MLB-IDLE", 7]]),
    })

    expect(rows).toEqual([
      {
        month: "2026-07",
        productKey: "SKU-IDLE",
        title: "Produto sem venda",
        itemIds: ["MLB-IDLE"],
        created: { orders: 0, units: 0, revenue: 0 },
        paid: { orders: 0, units: 0, revenue: 0 },
        visits: 7,
      },
    ])
  })
})

describe("classifyEvolution", () => {
  it.each([
    [0, 0, "no_movement"],
    [0, 10, "new"],
    [10, 0, "inactive"],
    [100, 116, "growth"],
    [100, 115, "stable"],
    [100, 84, "decline"],
    [100, 85, "stable"],
  ] as const)("classifies %s → %s as %s", (previous, current, expected) => {
    expect(classifyEvolution(previous, current)).toBe(expected)
  })
})

describe("evolutionRows", () => {
  it("compares the two latest complete months using the selected basis and metric", () => {
    const rows = evolutionRows(
      [
        {
          productKey: "SKU-A",
          title: "Produto A",
          itemIds: ["MLB-A"],
          totals: {
            created: { orders: 3, units: 3, revenue: 260 },
            paid: { orders: 2, units: 2, revenue: 180 },
            visits: 45,
          },
          monthly: [
            { month: "2026-06", created: { orders: 1, units: 1, revenue: 100 }, paid: { orders: 1, units: 1, revenue: 100 }, visits: 20 },
            { month: "2026-07", created: { orders: 2, units: 2, revenue: 160 }, paid: { orders: 1, units: 1, revenue: 80 }, visits: 25 },
          ],
        },
      ],
      ["2026-06", "2026-07"],
      "paid",
      "revenue",
    )

    expect(rows[0]).toMatchObject({
      previous: 100,
      current: 80,
      absoluteChange: -20,
      percentChange: -0.2,
      status: "decline",
      total: 180,
      visits: 45,
    })
  })
})

describe("groupMonthlyMetrics", () => {
  it("fills missing complete months without turning unavailable visits into zero", () => {
    const products = groupMonthlyMetrics(
      [
        {
          month: "2026-07",
          productKey: "SKU-A",
          title: "Produto A",
          itemIds: ["MLB-A"],
          created: { orders: 1, units: 2, revenue: 100 },
          paid: { orders: 1, units: 2, revenue: 100 },
          visits: 20,
        },
      ],
      ["2026-06", "2026-07"],
    )

    expect(products[0].monthly[0]).toEqual({
      month: "2026-06",
      created: { orders: 0, units: 0, revenue: 0 },
      paid: { orders: 0, units: 0, revenue: 0 },
      visits: null,
    })
    expect(products[0].totals).toEqual({
      created: { orders: 1, units: 2, revenue: 100 },
      paid: { orders: 1, units: 2, revenue: 100 },
      visits: 20,
    })
  })
})

describe("pendingEvolutionMonths", () => {
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]

  it("resumes a full backfill from the persisted cursor", () => {
    expect(
      pendingEvolutionMonths(months, true, { status: "backfilling_error", cursorMonth: "2026-04" }),
    ).toEqual({ mode: "backfilling", pending: ["2026-04", "2026-05", "2026-06", "2026-07"] })
  })

  it("refreshes only the two latest complete months and resumes the second one", () => {
    expect(pendingEvolutionMonths(months, false, null)).toEqual({
      mode: "refreshing",
      pending: ["2026-06", "2026-07"],
    })
    expect(
      pendingEvolutionMonths(months, false, { status: "refreshing", cursorMonth: "2026-07" }),
    ).toEqual({ mode: "refreshing", pending: ["2026-07"] })
  })
})
