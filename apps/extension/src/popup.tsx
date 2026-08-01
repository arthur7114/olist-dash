import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ExtensionConfig } from "@oem/contracts"
import type { ExtensionReply } from "./types"
import "./ui.css"

function Popup() {
  const [config, setConfig] = useState<ExtensionConfig | null>(null)
  const [status, setStatus] = useState("Verificando…")
  const [error, setError] = useState(false)

  useEffect(() => {
    void send<ExtensionConfig>({ type: "oem:get-config" }).then(async (reply) => {
      if (!reply.ok) return fail(reply.error)
      setConfig(reply.data)
      if (!reply.data.apiKey) return fail("A extensão ainda não foi configurada.")
      const bootstrap = await send<{ lastSync: string | null; settingsComplete: boolean }>({ type: "oem:request", path: "/api/extension/bootstrap" })
      if (!bootstrap.ok) return fail(bootstrap.error)
      setError(false)
      setStatus(bootstrap.data.settingsComplete ? `Conectada · sync ${formatDate(bootstrap.data.lastSync)}` : "Conectada · complete as configurações financeiras")
    })
  }, [])

  function fail(message: string) { setError(true); setStatus(message) }

  return <main className="page"><h1>OEM Precificação ML</h1><p>Margem e recomendação diretamente no Mercado Livre.</p>
    <div className={`status ${error ? "error" : "success"}`}>{status}</div>
    <div className="actions"><button onClick={() => chrome.runtime.openOptionsPage()}>Configurar</button>{config?.apiBaseUrl && <a className="button secondary" href={`${config.apiBaseUrl}/precificacao`} target="_blank" rel="noreferrer">Abrir dashboard</a>}</div>
  </main>
}

function send<T>(message: unknown): Promise<ExtensionReply<T>> { return chrome.runtime.sendMessage(message) }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("pt-BR") : "pendente" }
createRoot(document.getElementById("root")!).render(<Popup />)
