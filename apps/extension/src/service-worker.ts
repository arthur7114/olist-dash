import { extensionConfigSchema, type ExtensionConfig } from "@oem/contracts"
import type { ExtensionMessage, ExtensionReply } from "./types"

const DEFAULT_CONFIG: ExtensionConfig = { apiBaseUrl: "https://olist-dash.vercel.app", apiKey: "" }

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse: (response: ExtensionReply) => void) => {
  void handleMessage(message).then(sendResponse)
  return true
})

async function handleMessage(message: ExtensionMessage): Promise<ExtensionReply> {
  try {
    if (message.type === "oem:get-config") return { ok: true, data: await getConfig() }
    if (message.type === "oem:save-config") {
      const config = extensionConfigSchema.parse(message.config)
      await chrome.storage.local.set({ oemConfig: config })
      return { ok: true, data: config }
    }
    if (message.type === "oem:request") {
      const config = await getConfig()
      if (!config.apiKey) throw new Error("Configure a chave da extensão.")
      const response = await fetch(new URL(message.path, config.apiBaseUrl), {
        method: message.init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: message.init?.body == null ? undefined : JSON.stringify(message.init.body),
        cache: "no-store",
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) throw new Error(data.error ?? `API retornou ${response.status}.`)
      return { ok: true, data }
    }
    return { ok: false, error: "Mensagem desconhecida." }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get("oemConfig")
  const parsed = extensionConfigSchema.safeParse(stored.oemConfig)
  return parsed.success ? parsed.data : DEFAULT_CONFIG
}
