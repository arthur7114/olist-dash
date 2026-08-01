"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { LayoutDashboard, ReceiptText, Store, BarChart3, Package, Undo2, Tags } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
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
  { titulo: "Produtos e SKUs", href: "/produtos", icone: Package },
  { titulo: "Precificação e promoções", href: "/precificacao", icone: Tags },
  { titulo: "Devoluções", href: "/devolucoes", icone: Undo2 },
  { titulo: "Curva ABC", href: "/curva-abc", icone: BarChart3 },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center px-2 py-3">
          <Image
            src="/oem-logo-white.png"
            alt="OEM Parts"
            width={146}
            height={80}
            priority
            className="h-12 w-auto object-contain"
          />
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
    </Sidebar>
  )
}
