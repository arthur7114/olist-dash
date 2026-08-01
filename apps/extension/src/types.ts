import type { ExtensionConfig } from "@oem/contracts"

export type ExtensionMessage =
  | { type: "oem:get-config" }
  | { type: "oem:save-config"; config: ExtensionConfig }
  | { type: "oem:request"; path: string; init?: { method?: string; body?: unknown } }

export type ExtensionReply<T = unknown> = { ok: true; data: T } | { ok: false; error: string }
