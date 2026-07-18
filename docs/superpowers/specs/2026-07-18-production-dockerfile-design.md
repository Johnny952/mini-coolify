# Dockerfile de producción para mini-coolify

## Contexto

mini-coolify es una app TanStack Start (React 19 + Vite 8 + Nitro 3) que se
va a desplegar en la propia instancia de Coolify que administra, usando el
build pack "Dockerfile" de Coolify. Hoy no existe ningún Dockerfile ni
`.dockerignore` en el repo.

El wrapper de build `@lovable.dev/vite-tanstack-config` (usado en
`vite.config.ts`) fuerza por defecto el preset `cloudflare-module` de Nitro
al correr `vite build`, salvo que la variable de entorno `NITRO_PRESET`
indique otra cosa — el propio tipo de la opción `nitro` documenta que la
auto-detección por variable de entorno "sigue ganando" sobre el default.
Confirmado en `node_modules/@lovable.dev/vite-tanstack-config/dist/index.js`
(línea ~571: `defaultPreset: "cloudflare-module"`, solo aplica si no hay
preset explícito ni detección de plataforma).

El preset `node-server` de Nitro (confirmado en
`node_modules/nitro/dist/_presets.mjs`, preset `node-server`) genera:
- `.output/server/index.mjs` como entrypoint (`serveStatic: true`, sirve
  también los assets estáticos — no hace falta un servidor de estáticos
  aparte).
- Escucha en `process.env.PORT` (o `NITRO_PORT`), default `3000`, y
  `process.env.HOST` (o `NITRO_HOST`) — confirmado en
  `node_modules/nitro/dist/presets/node/runtime/node-server.mjs`.

El repo tiene tanto `bun.lock`/`bunfig.toml` como `package-lock.json`. Se
usa **npm** para el build de Docker (decisión del usuario).

## Objetivo

Un `Dockerfile` multi-stage que:
1. Instale dependencias con `npm ci` (reproducible, usa
   `package-lock.json`).
2. Compile la app con Nitro apuntando a Node (`NITRO_PRESET=node-server`),
   sin tocar `vite.config.ts`.
3. Produzca una imagen final mínima: solo `.output/`, sin `node_modules` de
   dev, sin código fuente, sin devDependencies, corriendo como usuario no
   root.
4. No hornee secretos (`COOLIFY_URL`, `COOLIFY_TOKEN`,
   `COOLIFY_ALLOWED_UUIDS`) en la imagen — se inyectan en runtime vía
   variables de entorno de Coolify, igual que hoy con `.env` en local.

## Diseño

### Dockerfile — 3 etapas

**Etapa `deps`** (`node:22-alpine`):
- `WORKDIR /app`
- Copia solo `package.json` y `package-lock.json`.
- `npm ci` — instala todas las dependencias (incluye devDependencies,
  necesarias para el build: `vite`, `nitro`, `typescript`, etc.).

**Etapa `build`** (parte de `deps`):
- Copia el resto del código fuente (respetando `.dockerignore`).
- `ENV NITRO_PRESET=node-server`
- `RUN npm run build` → genera `.output/`.

**Etapa `runtime`** (`node:22-alpine` limpio):
- Crea un usuario no root (`node` — ya viene incluido en la imagen oficial
  `node:*-alpine`) y usa `USER node`.
- `WORKDIR /app`
- Copia únicamente `--from=build /app/.output ./` (con `--chown=node:node`).
- `ENV NODE_ENV=production`
- `EXPOSE 3000`
- `CMD ["node", "server/index.mjs"]`

Esta imagen final no incluye `node_modules` de dev, código fuente TS/TSX,
`docs/`, ni `lancedb/` — solo el bundle de Nitro, que ya trae sus propias
dependencias de runtime empaquetadas (comportamiento estándar de Nitro).

### `.dockerignore`

Excluye del build context: `node_modules`, `.git`, `.env`, `docs/`,
`lancedb/`, `dist`, `.output`, `.tanstack`, `.superpowers/`, `*.md` (salvo
que se decida lo contrario), `.vscode`, `.idea`. Evita invalidar cache de
capas de Docker innecesariamente y evita que `.env` (con el token real)
viaje al build context.

### Variables de entorno en runtime (documentadas, no hardcodeadas)

El Dockerfile no declara `ENV` para `COOLIFY_URL`, `COOLIFY_TOKEN` ni
`COOLIFY_ALLOWED_UUIDS` — Coolify las setea al desplegar el contenedor,
igual que cualquier otra app. `PORT`/`HOST` son opcionales (Nitro ya trae
default `3000`); Coolify puede sobreescribir `PORT` si lo necesita.

## Fuera de alcance

- No se modifica `vite.config.ts` ni ningún archivo de la app — el cambio
  de preset se logra 100% vía variable de entorno de build.
- No se agrega healthcheck HTTP explícito en el Dockerfile (Coolify maneja
  su propio healthcheck vía proxy/puerto expuesto); se puede agregar
  después si hace falta.
- No se toca el flujo de desarrollo local (`npm run dev`) ni `.env` local.
