import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ExtensionConfig } from "@oem/contracts"
import type { ExtensionReply } from "./types"
import "./ui.css"

function Options() {
  const [config, setConfig] = useState<ExtensionConfig>({ apiBaseUrl: "https://olist-dash.vercel.app", apiKey: "" })
  const [status, setStatus] = useState("")
  const [error, setError] = useState(false)
  useEffect(() => { void send<ExtensionConfig>({ type: "oem:get-config" }).then((reply) => reply.ok && setConfig(reply.data)) }, [])

  async function save() {
    const normalized = { ...config, apiBaseUrl: config.apiBaseUrl.replace(/\/+$/, "") }
    const saved = await send<ExtensionConfig>({ type: "oem:save-config", config: normalized })
    if (!saved.ok) return show(saved.error, true)
    const tested = await send({ type: "oem:request", path: "/api/extension/bootstrap" })
    if (!tested.ok) return show(tested.error, true)
    setConfig(normalized)
    show("Configuração salva e conexão validada.", false)
  }
  function show(message: string, failed: boolean) { setStatus(message); setError(failed) }

  return <main className="page" style={{ maxWidth: 620, margin: "30px auto" }}><h1>Configurar OEM Precificação</h1><p>A chave é armazenada somente no perfil desta extensão.</p>
    <label>URL da API<input value={config.apiBaseUrl} onChange={(event) => setConfig({ ...config, apiBaseUrl: event.target.value })} /></label>
    <label>Chave compartilhada<input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} /></label>
    {status && <div className={`status ${error ? "error" : "success"}`}>{status}</div>}
    <button onClick={save}>Salvar e testar conexão</button>
  </main>
}

function send<T = unknown>(message: unknown): Promise<ExtensionReply<T>> { return chrome.runtime.sendMessage(message) }
createRoot(document.getElementById("root")!).render(<Options />)
