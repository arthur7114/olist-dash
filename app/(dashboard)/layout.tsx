import type { ReactNode } from "react"
import Image from "next/image"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { DataSourceAlert } from "@/components/dashboard/data-source-alert"
import { DataSourceStatus } from "@/components/dashboard/data-source-status"
import { ThemeToggle } from "@/components/dashboard/theme-toggle"
import { FiltrosProvider } from "@/lib/filters"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <FiltrosProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2.5">
              <Image
                src="/oem-logo-black.png"
                alt="OEM Parts"
                width={88}
                height={48}
                priority
                className="h-7 w-auto object-contain dark:hidden"
              />
              <Image
                src="/oem-logo-white.png"
                alt="OEM Parts"
                width={88}
                height={48}
                priority
                className="hidden h-7 w-auto object-contain dark:block"
              />
              <span className="text-sm text-muted-foreground">/ Painel comercial</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <DataSourceStatus />
              <span className="hidden text-xs text-muted-foreground sm:inline">Atualizado em 30/05/2026</span>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <DataSourceAlert />
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </FiltrosProvider>
  )
}
