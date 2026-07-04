"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { baixarCsv } from "@/lib/export-csv"
import { cn } from "@/lib/utils"

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  buscaPlaceholder?: string
  csv?: { nome: string; linhas: (rows: T[]) => Record<string, string | number>[] }
  rodape?: (rows: T[]) => ReactNode
  onRowClick?: (row: T) => void
  destacarLinha?: (row: T) => boolean
  vazio?: string
}

export function DataTable<T>({
  columns,
  data,
  buscaPlaceholder = "Buscar...",
  csv,
  rodape,
  onRowClick,
  destacarLinha,
  vazio = "Nenhum registro para os filtros selecionados.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [busca, setBusca] = useState("")

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: busca },
    onSortingChange: setSorting,
    onGlobalFilterChange: setBusca,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const linhasFiltradas = useMemo(
    () => table.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getFilteredRowModel().rows],
  )

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={buscaPlaceholder} className="pl-9" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {linhasFiltradas.length.toLocaleString("pt-BR")} registros
          </span>
          {csv && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => baixarCsv(csv.nome, csv.linhas(linhasFiltradas))}>
              <Download className="size-3.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40">
                {hg.headers.map((h) => {
                  const podeOrdenar = h.column.getCanSort()
                  const dir = h.column.getIsSorted()
                  return (
                    <TableHead key={h.id}>
                      {podeOrdenar ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  destacarLinha?.(row.original) && "bg-warning/10 hover:bg-warning/15",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
            {!table.getRowModel().rows.length && (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {vazio}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {rodape && linhasFiltradas.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 text-sm">{rodape(linhasFiltradas)}</div>
      )}

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-xs text-muted-foreground">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
