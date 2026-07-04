// CSV pt-BR (Excel): BOM UTF-8, separador ; e vírgula decimal.

function celula(valor: string | number): string {
  const texto = typeof valor === "number" ? String(valor).replace(".", ",") : valor
  if (/[";\n\r]/.test(texto)) return `"${texto.replaceAll('"', '""')}"`
  return texto
}

export function gerarCsv(linhas: Record<string, string | number>[]): string {
  if (!linhas.length) return ""
  const colunas = Object.keys(linhas[0])
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c] ?? "")).join(";"))
  return "﻿" + [colunas.join(";"), ...corpo].join("\r\n")
}

export function baixarCsv(nomeArquivo: string, linhas: Record<string, string | number>[]): void {
  const blob = new Blob([gerarCsv(linhas)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
