import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

function coolifyEnv() {
  const base = process.env.COOLIFY_URL?.replace(/\/+$/, "");
  const token = process.env.COOLIFY_TOKEN;
  if (!base || !token) throw new Error("COOLIFY_URL / COOLIFY_TOKEN no configurados");
  return { base, token };
}

async function coolifyFetch(path: string, init?: RequestInit) {
  const { base, token } = coolifyEnv();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || res.statusText;
    throw new Error(`Coolify ${res.status}: ${msg}`);
  }
  return data;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export type Application = {
  uuid: string;
  name: string;
  status: string;
  fqdn?: string | null;
  git_repository?: string | null;
  git_branch?: string | null;
  description?: string | null;
};

export const listApplications = createServerFn({ method: "GET" }).handler(async () => {
  const data = (await coolifyFetch("/api/v1/applications")) as unknown;
  const arr = Array.isArray(data) ? data : [];
  return arr.map((a: Record<string, unknown>) => ({
    uuid: String(a.uuid ?? ""),
    name: String(a.name ?? a.uuid ?? "unnamed"),
    status: String(a.status ?? "unknown"),
    fqdn: (a.fqdn as string) ?? null,
    git_repository: (a.git_repository as string) ?? null,
    git_branch: (a.git_branch as string) ?? null,
    description: (a.description as string) ?? null,
  })) as Application[];
});

export const getApplication = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const app = (await coolifyFetch(`/api/v1/applications/${data.uuid}`)) as Record<string, unknown>;
    return {
      uuid: String(app.uuid ?? data.uuid),
      name: String(app.name ?? "unnamed"),
      status: String(app.status ?? "unknown"),
      fqdn: (app.fqdn as string) ?? null,
      git_repository: (app.git_repository as string) ?? null,
      git_branch: (app.git_branch as string) ?? null,
      description: (app.description as string) ?? null,
    } as Application;
  });

export const deployApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string; force?: boolean }) =>
    z.object({ uuid: z.string().min(1), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = new URLSearchParams({ uuid: data.uuid, force: String(data.force ?? false) });
    return await coolifyFetch(`/api/v1/deploy?${q.toString()}`, { method: "GET" });
  });

export const stopApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    return await coolifyFetch(`/api/v1/applications/${data.uuid}/stop`, { method: "GET" });
  });

export const startApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    return await coolifyFetch(`/api/v1/applications/${data.uuid}/start`, { method: "GET" });
  });

export const restartApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    return await coolifyFetch(`/api/v1/applications/${data.uuid}/restart`, { method: "GET" });
  });

export type Deployment = {
  id: number | string;
  uuid?: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  commit?: string | null;
  logs?: string | null;
};

export const listDeployments = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const res = (await coolifyFetch(
      `/api/v1/deployments/applications/${data.uuid}`,
    )) as unknown;
    const arr = Array.isArray(res)
      ? res
      : Array.isArray((res as { deployments?: unknown[] })?.deployments)
        ? (res as { deployments: unknown[] }).deployments
        : [];
    return arr.map((d: Record<string, unknown>) => ({
      id: (d.id as number | string) ?? String(d.deployment_uuid ?? ""),
      uuid: (d.deployment_uuid as string) ?? (d.uuid as string) ?? undefined,
      status: String(d.status ?? "unknown"),
      created_at: (d.created_at as string) ?? undefined,
      updated_at: (d.updated_at as string) ?? undefined,
      commit: (d.commit as string) ?? null,
    })) as Deployment[];
  });

export const getDeployment = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const res = (await coolifyFetch(`/api/v1/deployments/${data.uuid}`)) as Record<
      string,
      unknown
    >;
    let logs: string | null = null;
    const rawLogs = res.logs;
    if (typeof rawLogs === "string") {
      logs = rawLogs;
    } else if (Array.isArray(rawLogs)) {
      logs = rawLogs
        .map((l: unknown) => {
          if (typeof l === "string") return l;
          const o = l as { output?: string; timestamp?: string };
          return o?.timestamp ? `[${o.timestamp}] ${o.output ?? ""}` : (o?.output ?? "");
        })
        .join("\n");
    }
    return {
      id: (res.id as number | string) ?? data.uuid,
      uuid: (res.deployment_uuid as string) ?? data.uuid,
      status: String(res.status ?? "unknown"),
      created_at: (res.created_at as string) ?? undefined,
      updated_at: (res.updated_at as string) ?? undefined,
      commit: (res.commit as string) ?? null,
      logs,
    } as Deployment;
  });

export const getApplicationLogs = createServerFn({ method: "GET" })
  .validator((d: { uuid: string; lines?: number }) =>
    z.object({ uuid: z.string().min(1), lines: z.number().int().positive().max(2000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = new URLSearchParams({ lines: String(data.lines ?? 200) });
    const res = (await coolifyFetch(
      `/api/v1/applications/${data.uuid}/logs?${q.toString()}`,
    )) as unknown;
    if (typeof res === "string") return { logs: res };
    const r = res as { logs?: string; raw?: string };
    return { logs: r?.logs ?? r?.raw ?? JSON.stringify(res, null, 2) };
  });
