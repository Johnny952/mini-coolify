import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Coolify reports application/container status as "state:health" (e.g.
// "running:healthy", "exited:unhealthy"). The health suffix can contain the
// state-like substring "healthy" even when the container is stopped
// ("unhealthy"), so `state` must be checked first — health only nuances the
// tone within the "running" state.
export function containerStatusTone(status: string): string {
  const [state = "", health = ""] = status.toLowerCase().split(":");
  if (state.includes("running")) {
    if (health.includes("unhealthy")) return "bg-red-500";
    if (health.includes("starting")) return "bg-amber-500";
    return "bg-emerald-500";
  }
  if (state.includes("restarting") || state.includes("starting") || state.includes("degraded")) {
    return "bg-amber-500";
  }
  if (state.includes("exited") || state.includes("stopped") || state.includes("dead")) {
    return "bg-zinc-500";
  }
  return "bg-zinc-400";
}
