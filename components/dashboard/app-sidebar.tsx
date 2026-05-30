"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, ReceiptText, Store, BarChart3, Package } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const itens = [
  { titulo: "Visão Geral", href: "/", icone: LayoutDashboard },
  { titulo: "Pedidos e NF", href: "/pedidos", icone: ReceiptText },
  { titulo: "Canais e Vendedores", href: "/canais", icone: Store },
  { titulo: "Curva ABC", href: "/curva-abc", icone: BarChart3 },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Package className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-semibold text-sidebar-foreground">Olist</span>
            <span className="text-xs text-sidebar-foreground/60">Painel de Vendas</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarMenu>
            {itens.map((item) => {
              const ativo = pathname === item.href
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={ativo} tooltip={item.titulo}>
                    <Link href={item.href}>
                      <item.icone className="h-4 w-4" />
                      <span>{item.titulo}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sm font-medium text-sidebar-accent-foreground">
            RC
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-sidebar-foreground">Renata Castro</span>
            <span className="text-xs text-sidebar-foreground/60">Gestora comercial</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
