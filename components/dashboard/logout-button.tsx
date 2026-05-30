"use client"

import { useState } from "react"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

export function LogoutButton() {
  const [saindo, setSaindo] = useState(false)

  async function sair() {
    setSaindo(true)
    try {
      await fetch("/api/olist/auth/logout", { method: "POST" })
    } finally {
      window.location.href = "/"
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="hidden bg-background sm:inline-flex"
      onClick={sair}
      disabled={saindo}
    >
      <LogOut className="h-4 w-4" />
      {saindo ? "Saindo" : "Sair"}
    </Button>
  )
}
