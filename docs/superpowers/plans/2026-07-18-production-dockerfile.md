# Production Dockerfile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready multi-stage `Dockerfile` (plus `.dockerignore`) so mini-coolify can be deployed via Coolify's "Dockerfile" build pack, producing a Node server bundle instead of the default Cloudflare Worker bundle.

**Architecture:** A 3-stage Dockerfile (`deps` → `build` → `runtime`) on `node:22-alpine`. The `build` stage sets `NITRO_PRESET=node-server` so Nitro (invoked by `npm run build`) emits a Node-runnable `.output/` instead of its Cloudflare default. The `runtime` stage copies only `.output/` into a clean image and runs it as a non-root user.

**Tech Stack:** Docker multi-stage build, Node 22 (alpine), npm, Nitro 3 (via `@lovable.dev/vite-tanstack-config`'s `nitro()` plugin).

## Global Constraints

- Package manager: **npm** (`package-lock.json`, `npm ci`) — not bun, per user decision. Do not use `bun.lock`.
- Nitro target: set via `ENV NITRO_PRESET=node-server` in the `build` stage. Do NOT modify `vite.config.ts` — the preset override must be build-env-only, confirmed to work because `@lovable.dev/vite-tanstack-config` only applies its `cloudflare-module` default when no platform/env auto-detection wins (`node_modules/@lovable.dev/vite-tanstack-config/dist/index.js` ~line 571).
- Node-server entrypoint is `.output/server/index.mjs` and it serves static assets itself (`serveStatic: true` — confirmed in `node_modules/nitro/dist/_presets.mjs`, preset `node-server`). No separate static file server needed.
- Runtime port/host: reads `PORT`/`NITRO_PORT` (default `3000`) and `HOST`/`NITRO_HOST` (confirmed in `node_modules/nitro/dist/presets/node/runtime/node-server.mjs`). `EXPOSE 3000` in the Dockerfile; Coolify may override `PORT`.
- Do NOT bake `COOLIFY_URL`, `COOLIFY_TOKEN`, or `COOLIFY_ALLOWED_UUIDS` into the image (no `ENV` lines for these, no `ARG` that could leak into layers). They're injected by Coolify at container runtime, same as `.env` locally.
- Final `runtime` stage must contain only `.output/` — no `node_modules` of dev deps, no TS/TSX source, no `docs/`, no `lancedb/`. Runs as a non-root user (the `node` user already present in the official `node:*-alpine` image).
- **This sandbox's shell user is NOT in the local `docker` group** (`docker version` returns "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock", confirmed non-interactively; `sudo`/`sg docker` both require a password not available here). If `docker build`/`docker run` fail with that exact permission error when you attempt them, do not treat it as a code defect — report it as an environment limitation and give the user the exact commands to run themselves (they can prefix with `!` in their Claude Code session to run in their own shell, which likely has proper docker permissions).

---

### Task 1: Add `.dockerignore` and the multi-stage `Dockerfile`

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`

**Interfaces:**
- Produces: a `Dockerfile` buildable via `docker build -t mini-coolify:prod .` from the repo root, and a `.dockerignore` that keeps the build context free of `node_modules`, VCS metadata, and secrets.

- [ ] **Step 1: Create `.dockerignore`**

Create `/home/johnny/Escritorio/proyectos/mini-coolify/.dockerignore`:

```
node_modules
.git
.gitignore
.env
.env.*
docs
lancedb
dist
.output
.tanstack
.superpowers
.lovable
.vscode
.idea
*.log
.DS_Store
```

- [ ] **Step 2: Create the `Dockerfile`**

Create `/home/johnny/Escritorio/proyectos/mini-coolify/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/.output ./
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
```

- [ ] **Step 3: Sanity-check the Dockerfile syntax without building**

Run: `docker build --check -t mini-coolify:prod-check . 2>&1 || true`

This validates Dockerfile syntax without requiring a full build or the
`docker` group permission that a real build needs (`--check` only parses
and lints the Dockerfile). If this also fails with the same "permission
denied while trying to connect to the docker API" error seen during
planning, that confirms the environment limitation noted in Global
Constraints — skip to Step 4 without treating it as a Dockerfile defect.

Expected (if docker socket is reachable): no syntax errors reported.
Expected (if not reachable): the exact permission-denied message — proceed
to Step 4 regardless.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add production Dockerfile targeting Nitro node-server"
```

---

### Task 2: Verify the image builds and serves the real dashboard

**Files:** none (build/run verification only).

**Interfaces:**
- Consumes: the `Dockerfile` and `.dockerignore` from Task 1.
- Produces: confirmation the image builds, starts, and serves the same
  filtered dashboard behavior already verified for the dev server (per
  `docs/superpowers/plans/2026-07-18-restrict-resources-by-env.md` Task 4).

- [ ] **Step 1: Attempt the build**

Run from the repo root: `docker build -t mini-coolify:prod .`

- **If this fails with "permission denied while trying to connect to the
  docker API at unix:///var/run/docker.sock"**: this is the known
  environment limitation from Global Constraints, not a Dockerfile defect.
  Do not attempt `sudo`, `sg docker`, or any other privilege escalation —
  none work non-interactively here (both were confirmed to require a
  password during planning). Report status `BLOCKED` with this exact
  message for the controller: *"Cannot verify the Docker build in this
  sandbox — the shell user isn't in the `docker` group. Please run these
  commands yourself (e.g. prefix each with `!` in your Claude Code
  session) and share the output: `docker build -t mini-coolify:prod .`
  then the commands in Step 2 onward."* Do not mark this task complete
  without either a successful build you ran, or the user confirming they
  ran it successfully.
- **If the build succeeds**: continue to Step 2.

Expected on success: build completes, final stage tagged `mini-coolify:prod`, no errors. The build stage's `npm run build` output should show Nitro targeting `node-server` (look for `node-server` in the build log, e.g. a line like "Nitro Server built" referencing the node preset), not `cloudflare-module`.

- [ ] **Step 2: Run the image against the real Coolify instance**

Read `COOLIFY_URL` and `COOLIFY_TOKEN` from the repo's `.env` (do not print
the token to any log or report — pass it straight through as an env var).

```bash
export $(grep -v '^#' .env | xargs)
docker run -d --name mini-coolify-verify -p 8081:3000 \
  -e COOLIFY_URL="$COOLIFY_URL" \
  -e COOLIFY_TOKEN="$COOLIFY_TOKEN" \
  -e COOLIFY_ALLOWED_UUIDS=f59hfjf45dvyz3j9yqnscd7v \
  mini-coolify:prod
sleep 3
docker logs mini-coolify-verify
```

Expected: container starts, logs show the Nitro/srvx server listening
(no crash, no stack trace). `f59hfjf45dvyz3j9yqnscd7v` is Valheim's real
uuid, already used for the same kind of verification in the
`restrict-resources-by-env` plan.

- [ ] **Step 3: Confirm the dashboard actually serves real data**

```bash
curl -s http://localhost:8081/ -o /tmp/docker-dashboard.html -w "HTTP %{http_code}\n"
grep -a -o "valheim" /tmp/docker-dashboard.html | sort -u
grep -a -o "frigate\|Bot secretaria\|mosquito" /tmp/docker-dashboard.html | sort -u
```

Expected: `HTTP 200`; first grep prints `valheim`; second grep prints
nothing (only the allowlisted app is visible — same allowlist behavior
already shipped, now confirmed working in the prod container too).

- [ ] **Step 4: Clean up**

```bash
docker stop mini-coolify-verify
docker rm mini-coolify-verify
```

Expected: container stopped and removed, no leftover `mini-coolify-verify`
container (`docker ps -a | grep mini-coolify-verify` prints nothing).

- [ ] **Step 5: Report image size (informational, not a gate)**

```bash
docker images mini-coolify:prod --format "{{.Repository}}:{{.Tag}} {{.Size}}"
```

Include this in the task report so the controller/user has a reference
size for the final runtime image.
