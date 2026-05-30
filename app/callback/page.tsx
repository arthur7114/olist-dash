import Link from "next/link"
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type CallbackSearchParams = {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function CallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const callbackParams: CallbackSearchParams = {
    code: getFirstParam(params.code),
    state: getFirstParam(params.state),
    error: getFirstParam(params.error),
    error_description: getFirstParam(params.error_description),
  }

  const hasError = Boolean(callbackParams.error)
  const hasCode = Boolean(callbackParams.code)
  const status = hasError ? "error" : hasCode ? "success" : "warning"

  const content = {
    error: {
      title: "Autorização não concluída",
      description:
        callbackParams.error_description ??
        "A Olist retornou uma falha no processo de autorização.",
      icon: AlertCircle,
      badge: "Erro",
      badgeClassName:
        "border-destructive/20 bg-destructive/10 text-destructive",
      iconClassName: "bg-destructive/10 text-destructive",
    },
    success: {
      title: "Callback recebido",
      description:
        "A Olist retornou um código de autorização para esta aplicação.",
      icon: CheckCircle2,
      badge: "Sucesso",
      badgeClassName: "border-success/20 bg-success/10 text-success",
      iconClassName: "bg-success/10 text-success",
    },
    warning: {
      title: "Aguardando parâmetros da Olist",
      description:
        "Esta rota está disponível para receber o redirect OAuth com code e state.",
      icon: KeyRound,
      badge: "Callback",
      badgeClassName:
        "border-warning/30 bg-warning/15 text-warning-foreground",
      iconClassName: "bg-warning/15 text-warning-foreground",
    },
  }[status]

  const Icon = content.icon

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl overflow-hidden">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                content.iconClassName,
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-2">
              <span
                className={cn(
                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                  content.badgeClassName,
                )}
              >
                {content.badge}
              </span>
              <CardTitle className="text-2xl">{content.title}</CardTitle>
              <CardDescription>{content.description}</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          <div className="rounded-lg border border-border bg-card">
            <dl className="divide-y divide-border text-sm">
              <div className="grid gap-1 p-4 sm:grid-cols-[120px_1fr] sm:gap-4">
                <dt className="font-medium text-muted-foreground">Code</dt>
                <dd className="break-all font-mono text-xs text-foreground">
                  {callbackParams.code ?? "Não informado"}
                </dd>
              </div>
              <div className="grid gap-1 p-4 sm:grid-cols-[120px_1fr] sm:gap-4">
                <dt className="font-medium text-muted-foreground">State</dt>
                <dd className="break-all font-mono text-xs text-foreground">
                  {callbackParams.state ?? "Não informado"}
                </dd>
              </div>
              {hasError && (
                <div className="grid gap-1 p-4 sm:grid-cols-[120px_1fr] sm:gap-4">
                  <dt className="font-medium text-muted-foreground">Erro</dt>
                  <dd className="break-all font-mono text-xs text-foreground">
                    {callbackParams.error}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <p className="text-sm text-muted-foreground">
            A troca do código por token ainda não é feita nesta tela. Para isso,
            será necessário configurar client_id, client_secret, validação de
            state e armazenamento seguro.
          </p>

          <Button asChild className="w-full sm:w-auto">
            <Link href="/">Voltar ao dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
