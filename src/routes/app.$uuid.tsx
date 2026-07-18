import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  getApplication,
  listDeployments,
  getDeployment,
  getApplicationLogs,
  deployApplication,
  stopApplication,
  startApplication,
  restartApplication,
} from "@/lib/coolify.functions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, Rocket, Square, Play, RotateCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { containerStatusTone } from "@/lib/utils";

const appQO = (uuid: string) =>
  queryOptions({
    queryKey: ["coolify", "app", uuid],
    queryFn: () => getApplication({ data: { uuid } }),
    refetchInterval: 10_000,
  });

const deploymentsQO = (uuid: string) =>
  queryOptions({
    queryKey: ["coolify", "app", uuid, "deployments"],
    queryFn: () => listDeployments({ data: { uuid } }),
    refetchInterval: 8_000,
  });

export const Route = createFileRoute("/app/$uuid")({
  head: ({ params }) => ({
    meta: [
      { title: `App ${params.uuid.slice(0, 8)} · Coolify` },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context, params }) => {
    context.queryClient.ensureQueryData(appQO(params.uuid));
    context.queryClient.prefetchQuery(deploymentsQO(params.uuid));
  },
  component: AppDetail,
});

// Deployment status (queued/in_progress/finished/failed/cancelled) — plain
// values, not the "state:health" compound format applications use, so a
// simple substring match is safe here. For application/container status,
// use containerStatusTone from @/lib/utils instead.
function deploymentStatusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes("running") || s.includes("success") || s.includes("healthy")) return "bg-emerald-500";
  if (s.includes("queued") || s.includes("in_progress") || s.includes("starting") || s.includes("restarting")) return "bg-amber-500";
  if (s.includes("failed") || s.includes("error") || s.includes("unhealthy")) return "bg-red-500";
  if (s.includes("cancel")) return "bg-zinc-500";
  return "bg-zinc-400";
}

function AppDetail() {
  const { uuid } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: app } = useSuspenseQuery(appQO(uuid));
  const { data: deployments = [], isLoading: loadingDeps } = useQuery(deploymentsQO(uuid));

  const [tab, setTab] = useState<"deployments" | "logs">("deployments");
  const [selectedDep, setSelectedDep] = useState<string | null>(null);

  const deploy = useServerFn(deployApplication);
  const stop = useServerFn(stopApplication);
  const start = useServerFn(startApplication);
  const restart = useServerFn(restartApplication);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["coolify", "app", uuid] });
  };

  const mDeploy = useMutation({
    mutationFn: () => deploy({ data: { uuid } }),
    onSuccess: () => { toast.success("Deploy iniciado"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mStop = useMutation({
    mutationFn: () => stop({ data: { uuid } }),
    onSuccess: () => { toast.success("Detenido"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mStart = useMutation({
    mutationFn: () => start({ data: { uuid } }),
    onSuccess: () => { toast.success("Iniciado"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mRestart = useMutation({
    mutationFn: () => restart({ data: { uuid } }),
    onSuccess: () => { toast.success("Reiniciado"); invalidateAll(); },
    onError: (e: Error) => toast.error(e.message),
  });


  const isRunning = app.status.toLowerCase().includes("running");
  const busy = mDeploy.isPending || mStop.isPending || mStart.isPending || mRestart.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${containerStatusTone(app.status)}`} />
                <h1 className="text-2xl font-semibold tracking-tight truncate">{app.name}</h1>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                <span className="capitalize">{app.status}</span>
                {app.git_repository && <> · {app.git_repository}{app.git_branch ? `@${app.git_branch}` : ""}</>}
              </div>
              {app.fqdn && (
                <a
                  href={app.fqdn.startsWith("http") ? app.fqdn : `https://${app.fqdn}`}
                  target="_blank" rel="noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                >
                  {app.fqdn.replace(/^https?:\/\//, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => mDeploy.mutate()} disabled={busy}>
                <Rocket className="h-4 w-4 mr-1.5" /> Deploy
              </Button>
              {isRunning ? (
                <Button size="sm" variant="outline" onClick={() => mRestart.mutate()} disabled={busy}>
                  <RotateCw className="h-4 w-4 mr-1.5" /> Restart
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => mStart.mutate()} disabled={busy}>
                  <Play className="h-4 w-4 mr-1.5" /> Start
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => mStop.mutate()} disabled={busy || !isRunning}>
                <Square className="h-4 w-4 mr-1.5" /> Stop
              </Button>
              <Button size="sm" variant="ghost" onClick={() => router.invalidate()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex gap-1 border-b mb-4">
          <TabBtn active={tab === "deployments"} onClick={() => setTab("deployments")}>
            Deployments
          </TabBtn>
          <TabBtn active={tab === "logs"} onClick={() => setTab("logs")}>
            Logs del contenedor
          </TabBtn>
        </div>

        {tab === "deployments" ? (
          <div className="grid md:grid-cols-[320px_1fr] gap-4">
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b">
                Historial
              </div>
              {loadingDeps ? (
                <div className="p-4 text-sm text-muted-foreground">Cargando…</div>
              ) : deployments.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Sin deployments.</div>
              ) : (
                <ul className="max-h-[600px] overflow-auto divide-y">
                  {deployments.map((d) => {
                    const key = d.uuid ?? String(d.id);
                    const active = selectedDep === key;
                    return (
                      <li key={key}>
                        <button
                          onClick={() => setSelectedDep(key)}
                          className={`w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition ${active ? "bg-accent" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${deploymentStatusTone(d.status)}`} />
                            <span className="font-medium capitalize">{d.status}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {d.created_at ? new Date(d.created_at).toLocaleString() : "—"}
                          </div>
                          {d.commit && (
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              {d.commit.slice(0, 12)}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <DeploymentLogs uuid={selectedDep} />
          </div>
        ) : (
          <ContainerLogs uuid={uuid} isRunning={isRunning} />
        )}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
        active
          ? "border-foreground text-foreground font-medium"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function DeploymentLogs({ uuid }: { uuid: string | null }) {
  const getDep = useServerFn(getDeployment);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["coolify", "deployment", uuid],
    queryFn: () => getDep({ data: { uuid: uuid! } }),
    enabled: !!uuid,
    refetchInterval: uuid ? 5_000 : false,
  });

  if (!uuid) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Selecciona un deployment para ver sus logs.
      </div>
    );
  }
  if (isLoading) return <LogBox>Cargando…</LogBox>;
  if (isError) return <LogBox>Error: {(error as Error).message}</LogBox>;
  return <LogBox>{data?.logs?.trim() || "(sin logs)"}</LogBox>;
}

function ContainerLogs({ uuid, isRunning }: { uuid: string; isRunning: boolean }) {
  const getLogs = useServerFn(getApplicationLogs);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["coolify", "container-logs", uuid],
    queryFn: () => getLogs({ data: { uuid, lines: 300 } }),
    enabled: isRunning,
    refetchInterval: isRunning ? 5_000 : false,
  });

  if (!isRunning) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        El contenedor no está corriendo, no hay logs disponibles.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">Últimas 300 líneas · autorefresh cada 5s</p>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {isLoading ? (
        <LogBox>Cargando…</LogBox>
      ) : isError ? (
        <LogBox>Error: {(error as Error).message}</LogBox>
      ) : (
        <LogBox>{data?.logs?.trim() || "(sin logs)"}</LogBox>
      )}
    </div>
  );
}

function LogBox({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-lg border bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-auto max-h-[600px] whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}
