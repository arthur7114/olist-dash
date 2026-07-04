import { describe, expect, it } from "vitest"
import { gerarCsv } from "@/lib/export-csv"

describe("gerarCsv", () => {
  it("gera cabeçalho das chaves, separador ; e CRLF com BOM", () => {
    const csv = gerarCsv([
      { SKU: "6103", Faturamento: 100.5 },
      { SKU: "40150693", Faturamento: 200 },
    ])
    expect(csv).toBe("﻿SKU;Faturamento\r\n6103;100,5\r\n40150693;200")
  })
  it("escapa valores com ; aspas e quebras de linha", () => {
    const csv = gerarCsv([{ Produto: 'CABO "X"; especial', N: 1 }])
    expect(csv).toBe('﻿Produto;N\r\n"CABO ""X""; especial";1')
  })
  it("lista vazia gera string vazia", () => {
    expect(gerarCsv([])).toBe("")
  })
})
