import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listApplications,
  deployApplication,
  stopApplication,
  startApplication,
  restartApplication,
  type Application,
} from "@/lib/coolify.functions";
import { Button } from "@/components/ui/button";
import { RefreshCw, Rocket, Square, Play, RotateCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { containerStatusTone } from "@/lib/utils";

const appsQO = queryOptions({
  queryKey: ["coolify", "applications"],
  queryFn: () => listApplications(),
  refetchInterval: 10_000,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Coolify Dashboard" },
      { name: "description", content: "Panel simple para administrar contenedores de Coolify." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(appsQO),
  component: Dashboard,
});

function Dashboard() {
  const { data: apps } = useSuspenseQuery(appsQO);
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Coolify Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {apps.length} {apps.length === 1 ? "aplicación" : "aplicaciones"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.invalidate()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refrescar
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {apps.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            No hay aplicaciones visibles. Revisa que <code>COOLIFY_URL</code>, <code>COOLIFY_TOKEN</code> y{" "}
            <code>COOLIFY_ALLOWED_UUIDS</code> estén configurados correctamente.
          </div>
        ) : (
          <div className="grid gap-3">
            {apps.map((app) => (
              <AppRow key={app.uuid} app={app} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AppRow({ app }: { app: Application }) {
  const qc = useQueryClient();
  const deploy = useServerFn(deployApplication);
  const stop = useServerFn(stopApplication);
  const start = useServerFn(startApplication);
  const restart = useServerFn(restartApplication);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["coolify", "applications"] });

  const mDeploy = useMutation({
    mutationFn: () => deploy({ data: { uuid: app.uuid } }),
    onSuccess: () => { toast.success(`Deploy iniciado: ${app.name}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mStop = useMutation({
    mutationFn: () => stop({ data: { uuid: app.uuid } }),
    onSuccess: () => { toast.success(`Detenido: ${app.name}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mStart = useMutation({
    mutationFn: () => start({ data: { uuid: app.uuid } }),
    onSuccess: () => { toast.success(`Iniciado: ${app.name}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mRestart = useMutation({
    mutationFn: () => restart({ data: { uuid: app.uuid } }),
    onSuccess: () => { toast.success(`Reiniciado: ${app.name}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isRunning = app.status.toLowerCase().includes("running");
  const busy = mDeploy.isPending || mStop.isPending || mStart.isPending || mRestart.isPending;

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${containerStatusTone(app.status)}`} aria-hidden />
        <div className="min-w-0">
          <Link
            to="/app/$uuid"
            params={{ uuid: app.uuid }}
            className="font-medium hover:underline block truncate"
          >
            {app.name}
          </Link>
          <div className="text-xs text-muted-foreground truncate">
            <span className="capitalize">{app.status}</span>
            {app.git_branch && <> · {app.git_branch}</>}
            {app.fqdn && (
              <> · <a href={app.fqdn.startsWith("http") ? app.fqdn : `https://${app.fqdn}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground">
                {app.fqdn.replace(/^https?:\/\//, "")}
                <ExternalLink className="h-3 w-3" />
              </a></>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 shrink-0">
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => mStop.mutate()}
          disabled={busy || !isRunning}
        >
          <Square className="h-4 w-4 mr-1.5" /> Stop
        </Button>
      </div>
    </div>
  );
}
