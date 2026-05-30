import { neon } from "@neondatabase/serverless"
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http"
import * as schema from "./schema"

let cached: NeonHttpDatabase<typeof schema> | null = null

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

// Inicialização preguiçosa: nada acontece no import (build não precisa de DATABASE_URL).
export function getDb(): NeonHttpDatabase<typeof schema> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL não configurado.")
  if (!cached) {
    const sql = neon(url)
    cached = drizzle(sql, { schema })
  }
  return cached
}

export { schema }
