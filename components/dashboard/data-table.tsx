"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type Header,
  type RowData,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Filter,
  FilterX,
  GripVertical,
  Search,
  Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { baixarCsv } from "@/lib/export-csv"
import { cn } from "@/lib/utils"

// Metadados opcionais por coluna, lidos pelo DataTable para alinhamento,
// rótulo legível (menu/filtro) e variante de filtro.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    rotulo?: string
    alinhar?: "left" | "right"
    filtro?: "text" | "select" | "none"
  }
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  /** Identificador estável usado para persistir ordem/visibilidade/filtros no localStorage. */
  tableId?: string
  buscaPlaceholder?: string
  csv?: { nome: string; linhas: (rows: T[]) => Record<string, string | number>[] }
  rodape?: (rows: T[]) => ReactNode
  onRowClick?: (row: T) => void
  destacarLinha?: (row: T) => boolean
  vazio?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filtroSelecao: FilterFn<any> = (row, columnId, valor) => {
  const selecionados = valor as string[] | undefined
  if (!selecionados?.length) return true
  return selecionados.includes(String(row.getValue(columnId)))
}

function temAcessor<T>(col: ColumnDef<T, unknown>): boolean {
  return "accessorKey" in col || "accessorFn" in col
}

function idColuna<T>(col: ColumnDef<T, unknown>): string | undefined {
  if (col.id) return col.id
  if ("accessorKey" in col && col.accessorKey != null) return String(col.accessorKey)
  return undefined
}

function rotuloColuna(column: Column<unknown, unknown>): string {
  const meta = column.columnDef.meta
  if (meta?.rotulo) return meta.rotulo
  if (typeof column.columnDef.header === "string") return column.columnDef.header
  return column.id
}

export function DataTable<T>({
  columns,
  data,
  tableId,
  buscaPlaceholder = "Buscar...",
  csv,
  rodape,
  onRowClick,
  destacarLinha,
  vazio = "Nenhum registro para os filtros selecionados.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [busca, setBusca] = useState("")
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  // A camada de drag do dnd-kit gera ids não determinísticos; só a montamos no
  // cliente para evitar mismatch de hidratação com o HTML do servidor.
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  // Injeta filterFn e habilita filtro conforme os metadados de cada coluna.
  const colunasPreparadas = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((col) => {
        if (!temAcessor(col) || col.meta?.filtro === "none") {
          return { ...col, enableColumnFilter: false }
        }
        const variante = col.meta?.filtro ?? "text"
        return {
          ...col,
          enableColumnFilter: col.enableColumnFilter ?? true,
          filterFn: col.filterFn ?? (variante === "select" ? filtroSelecao : "includesString"),
        }
      }),
    [columns],
  )

  const ordemPadrao = useMemo(
    () => colunasPreparadas.map(idColuna).filter((v): v is string => Boolean(v)),
    [colunasPreparadas],
  )

  // Persistência: hidrata do localStorage após montar (evita mismatch de SSR).
  const chave = tableId ? `datatable:${tableId}` : null
  const [hidratado, setHidratado] = useState(false)
  useEffect(() => {
    if (!chave) {
      setHidratado(true)
      return
    }
    try {
      const bruto = localStorage.getItem(chave)
      if (bruto) {
        const salvo = JSON.parse(bruto) as {
          columnOrder?: string[]
          columnVisibility?: VisibilityState
          columnFilters?: ColumnFiltersState
        }
        if (salvo.columnOrder) {
          const validos = salvo.columnOrder.filter((id) => ordemPadrao.includes(id))
          const faltantes = ordemPadrao.filter((id) => !validos.includes(id))
          setColumnOrder([...validos, ...faltantes])
        }
        if (salvo.columnVisibility) setColumnVisibility(salvo.columnVisibility)
        if (salvo.columnFilters) setColumnFilters(salvo.columnFilters)
      }
    } catch {
      // ignora preferências corrompidas
    }
    setHidratado(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  useEffect(() => {
    if (!chave || !hidratado) return
    try {
      localStorage.setItem(chave, JSON.stringify({ columnOrder, columnVisibility, columnFilters }))
    } catch {
      // storage indisponível — segue sem persistir
    }
  }, [chave, hidratado, columnOrder, columnVisibility, columnFilters])

  const table = useReactTable({
    data,
    columns: colunasPreparadas,
    state: {
      sorting,
      globalFilter: busca,
      columnFilters,
      columnVisibility,
      columnOrder: columnOrder.length ? columnOrder : ordemPadrao,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setBusca,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const linhasFiltradas = useMemo(
    () => table.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getFilteredRowModel().rows],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const aoArrastar = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setColumnOrder((prev) => {
      const base = prev.length ? prev : ordemPadrao
      const de = base.indexOf(String(active.id))
      const para = base.indexOf(String(over.id))
      if (de < 0 || para < 0) return base
      return arrayMove(base, de, para)
    })
  }

  const restaurarPadrao = () => {
    setColumnOrder(ordemPadrao)
    setColumnVisibility({})
    setColumnFilters([])
    if (chave) {
      try {
        localStorage.removeItem(chave)
      } catch {
        // ignore
      }
    }
  }

  const idsVisiveis = table.getHeaderGroups()[0]?.headers.map((h) => h.column.id) ?? []
  const totalColunas = table.getVisibleLeafColumns().length
  const temFiltros = columnFilters.length > 0

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
          {temFiltros && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setColumnFilters([])}>
              <FilterX className="size-3.5" /> Limpar filtros
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="size-3.5" /> Colunas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(Boolean(v))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {rotuloColuna(c as Column<unknown, unknown>)}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={restaurarPadrao}>Restaurar padrão</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {csv && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => baixarCsv(csv.nome, csv.linhas(linhasFiltradas))}>
              <Download className="size-3.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <DndContext id={`dnd-${tableId ?? "table"}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={aoArrastar}>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40">
                  {montado ? (
                    <SortableContext items={idsVisiveis} strategy={horizontalListSortingStrategy}>
                      {hg.headers.map((h) => (
                        <CabecalhoColuna key={h.id} header={h as Header<unknown, unknown>} />
                      ))}
                    </SortableContext>
                  ) : (
                    hg.headers.map((h) => <CabecalhoSimples key={h.id} header={h as Header<unknown, unknown>} />)
                  )}
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
                    <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.alinhar === "right" && "text-right")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!table.getRowModel().rows.length && (
                <TableRow>
                  <TableCell colSpan={totalColunas} className="h-24 text-center text-muted-foreground">
                    {vazio}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DndContext>
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

function ConteudoCabecalho({ header, grip }: { header: Header<unknown, unknown>; grip?: ReactNode }) {
  const column = header.column
  const alinharDir = column.columnDef.meta?.alinhar === "right"
  const podeOrdenar = column.getCanSort()
  const podeFiltrar = column.getCanFilter()
  const dir = column.getIsSorted()

  return (
    <div className={cn("group/th flex items-center gap-1", alinharDir && "flex-row-reverse")}>
      {grip}
      {podeOrdenar ? (
        <button
          type="button"
          onClick={column.getToggleSortingHandler()}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {flexRender(column.columnDef.header, header.getContext())}
          {dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : dir === "desc" ? (
            <ArrowDown className="size-3" />
          ) : (
            <ArrowUpDown className="size-3 opacity-40" />
          )}
        </button>
      ) : (
        flexRender(column.columnDef.header, header.getContext())
      )}
      {podeFiltrar && <FiltroColuna column={column} />}
    </div>
  )
}

// Cabeçalho estático usado na renderização inicial (SSR + primeira passada no
// cliente), sem hooks do dnd-kit — garante hidratação sem mismatch.
function CabecalhoSimples({ header }: { header: Header<unknown, unknown> }) {
  const alinharDir = header.column.columnDef.meta?.alinhar === "right"
  return (
    <TableHead className={cn(alinharDir && "text-right")}>
      <ConteudoCabecalho header={header} />
    </TableHead>
  )
}

function CabecalhoColuna({ header }: { header: Header<unknown, unknown> }) {
  const column = header.column
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id })
  const alinharDir = column.columnDef.meta?.alinhar === "right"

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
    position: "relative",
  }

  const grip = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label="Reordenar coluna"
      className="cursor-grab touch-none text-muted-foreground/40 opacity-0 transition-opacity hover:text-foreground group-hover/th:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="size-3.5" />
    </button>
  )

  return (
    <TableHead ref={setNodeRef} style={style} className={cn(alinharDir && "text-right")}>
      <ConteudoCabecalho header={header} grip={grip} />
    </TableHead>
  )
}

function FiltroColuna({ column }: { column: Column<unknown, unknown> }) {
  const variante = column.columnDef.meta?.filtro ?? "text"
  const valor = column.getFilterValue()
  const ativo = variante === "select" ? Array.isArray(valor) && valor.length > 0 : Boolean(valor)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filtrar coluna"
          className={cn(
            "inline-flex size-5 items-center justify-center rounded transition-colors hover:bg-muted",
            ativo ? "text-primary" : "text-muted-foreground/40 hover:text-foreground",
          )}
        >
          <Filter className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        {variante === "select" ? <FiltroSelecao column={column} /> : <FiltroTexto column={column} />}
      </PopoverContent>
    </Popover>
  )
}

function FiltroTexto({ column }: { column: Column<unknown, unknown> }) {
  const valor = (column.getFilterValue() as string) ?? ""
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Contém</p>
      <Input
        autoFocus
        value={valor}
        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
        placeholder="Digite para filtrar…"
        className="h-8"
      />
      {valor && (
        <Button variant="ghost" size="sm" className="h-7 w-full justify-start text-muted-foreground" onClick={() => column.setFilterValue(undefined)}>
          Limpar
        </Button>
      )}
    </div>
  )
}

function FiltroSelecao({ column }: { column: Column<unknown, unknown> }) {
  const selecionados = (column.getFilterValue() as string[] | undefined) ?? []
  const opcoes = useMemo(
    () =>
      Array.from(column.getFacetedUniqueValues().keys())
        .map((v) => String(v))
        .filter((v) => v !== "" && v !== "null" && v !== "undefined")
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [column],
  )

  const alternar = (opcao: string, marcado: boolean) => {
    const proximo = marcado ? [...selecionados, opcao] : selecionados.filter((v) => v !== opcao)
    column.setFilterValue(proximo.length ? proximo : undefined)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Valores</p>
        {selecionados.length > 0 && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => column.setFilterValue(undefined)}>
            Limpar
          </button>
        )}
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {opcoes.map((opcao) => (
          <label key={opcao} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
            <Checkbox checked={selecionados.includes(opcao)} onCheckedChange={(v) => alternar(opcao, Boolean(v))} />
            <span className="truncate">{opcao}</span>
          </label>
        ))}
        {!opcoes.length && <p className="px-1 py-2 text-xs text-muted-foreground">Sem valores.</p>}
      </div>
    </div>
  )
}
