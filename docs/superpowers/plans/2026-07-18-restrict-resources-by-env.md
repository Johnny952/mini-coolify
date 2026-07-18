# Restringir recursos por env + fix warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir qué applications de Coolify son visibles/operables en el dashboard a las listadas en `COOLIFY_ALLOWED_UUIDS`, y eliminar los tres warnings de `vite dev` (deprecación de `inputValidator`, falta de CSRF middleware).

**Architecture:** Toda la lógica de acceso a Coolify vive en `src/lib/coolify.functions.ts`. Se agregan dos funciones puras (`getAllowedUuids`, `assertUuidAllowed`) y se invocan al inicio de cada server function que recibe un `uuid` de aplicación, más un `.filter()` en `listApplications`. El fix de CSRF es una línea de configuración en `src/start.ts` usando la API oficial de `@tanstack/react-start`.

**Tech Stack:** TanStack Start (`@tanstack/react-start` v1.168), Zod, React, Vite. Sin framework de tests automatizados instalado (no vitest/jest en `package.json`).

## Global Constraints

- Variable de entorno: `COOLIFY_ALLOWED_UUIDS` — UUIDs de aplicación separados por comas (espacios alrededor de cada uno se recortan, entradas vacías se ignoran).
- Si `COOLIFY_ALLOWED_UUIDS` no está definida o queda vacía tras el parseo: el set de permitidos es vacío → cero aplicaciones visibles (empty state), NO "mostrar todas".
- Enforcement en servidor en TODO handler que reciba un `uuid` de aplicación (`getApplication`, `listDeployments`, `getApplicationLogs`, `deployApplication`, `stopApplication`, `startApplication`, `restartApplication`). Al rechazar, lanzar `Error("Aplicación no encontrada")` — mismo mensaje que un 404 real, nunca revelar que el uuid existe pero está bloqueado.
- `getDeployment` (recibe uuid de *deployment*, no de app) queda explícitamente SIN este chequeo — no agregar llamadas extra a Coolify para resolverlo.
- Este repo no tiene test runner instalado. No instalar uno solo para esto (fuera de alcance). La verificación de cada tarea usa `npx tsc --noEmit`, `npm run lint`, y checks manuales contra la instancia real de Coolify (alcanzable en este entorno en `http://100.85.136.1:8000`, confirmado con `curl`).
- UUIDs reales disponibles en la instancia de Coolify para pruebas manuales (obtenidos vía `GET /api/v1/applications`):
  - `vcvwu5ynrjgzf04sjpel6xjy` → "Bot secretaria" (usar como uuid PERMITIDO en pruebas)
  - `yzees8astbum1ve4s8e8ka7b` → "frigate" (usar como uuid NO permitido en pruebas)

---

### Task 1: Reemplazar `inputValidator()` deprecado por `validator()`

**Files:**
- Modify: `src/lib/coolify.functions.ts` (8 ocurrencias: `getApplication`, `deployApplication`, `stopApplication`, `startApplication`, `restartApplication`, `listDeployments`, `getDeployment`, `getApplicationLogs`)

**Interfaces:**
- Consumes: nada nuevo (cambio mecánico, cero cambio de comportamiento).
- Produces: nada nuevo — los mismos exports (`getApplication`, `deployApplication`, etc.) con la misma firma.

- [ ] **Step 1: Reemplazar todas las ocurrencias de `.inputValidator(` por `.validator(`**

En `src/lib/coolify.functions.ts`, cada una de estas 8 líneas cambia únicamente el nombre del método (el resto de la línea/bloque queda idéntico):

```
.inputValidator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
```
→
```
.validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
```

Esto aplica literalmente igual a las 6 ocurrencias de esa forma exacta (`getApplication`, `stopApplication`, `startApplication`, `restartApplication`, `listDeployments`, `getDeployment`), y a estas dos variantes multilínea:

```
.inputValidator((d: { uuid: string; force?: boolean }) =>
    z.object({ uuid: z.string().min(1), force: z.boolean().optional() }).parse(d),
  )
```
→
```
.validator((d: { uuid: string; force?: boolean }) =>
    z.object({ uuid: z.string().min(1), force: z.boolean().optional() }).parse(d),
  )
```

```
.inputValidator((d: { uuid: string; lines?: number }) =>
    z.object({ uuid: z.string().min(1), lines: z.number().int().positive().max(2000).optional() }).parse(d),
  )
```
→
```
.validator((d: { uuid: string; lines?: number }) =>
    z.object({ uuid: z.string().min(1), lines: z.number().int().positive().max(2000).optional() }).parse(d),
  )
```

- [ ] **Step 2: Verificar que ya no quede ningún `inputValidator` en el archivo**

Run: `grep -n "inputValidator" src/lib/coolify.functions.ts`
Expected: sin output (0 coincidencias).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sin errores nuevos en `coolify.functions.ts`.

- [ ] **Step 5: Confirmar en el dev server que el warning de deprecación desapareció**

Run: `npm run dev` (dejarlo corriendo en background), luego en otra terminal:
`curl -s http://localhost:3000/ -o /dev/null` (o abrir `http://localhost:3000/` en el navegador) para forzar el bundling del server function.
Expected: en la salida de `vite dev` ya NO aparece `createServerFn().inputValidator() is deprecated`. (El warning de CSRF todavía puede seguir apareciendo — se corrige en Task 3.)

Detener el dev server (`Ctrl+C` o `kill`) antes de continuar.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coolify.functions.ts
git commit -m "fix: replace deprecated inputValidator() with validator()"
```

(Si el repo no tiene `.git` inicializado, omitir este step y notificar en el resumen final en vez de fallar.)

---

### Task 2: Restringir applications visibles/operables vía `COOLIFY_ALLOWED_UUIDS`

**Files:**
- Modify: `src/lib/coolify.functions.ts`
- Modify: `src/routes/index.tsx:64-67` (mensaje de empty state)

**Interfaces:**
- Produces: `function getAllowedUuids(): Set<string>` y `function assertUuidAllowed(uuid: string): void` (lanza `Error` si no permitido) — funciones internas del módulo, no exportadas, usadas solo dentro de `coolify.functions.ts`.
- Consumes: `process.env.COOLIFY_ALLOWED_UUIDS` (string | undefined).

- [ ] **Step 1: Agregar los helpers de allowlist**

En `src/lib/coolify.functions.ts`, insertar esto justo después de la función `safeJson` (línea 37) y antes de `export type Application` (línea 39):

```ts
function getAllowedUuids(): Set<string> {
  return new Set(
    (process.env.COOLIFY_ALLOWED_UUIDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function assertUuidAllowed(uuid: string) {
  if (!getAllowedUuids().has(uuid)) {
    throw new Error("Aplicación no encontrada");
  }
}
```

- [ ] **Step 2: Filtrar `listApplications` por la allowlist**

Reemplazar el cuerpo de `listApplications` (después de Task 1, el decorador ya dice `.handler`, no hay `.validator` en esta función):

Antes:
```ts
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
```

Después:
```ts
export const listApplications = createServerFn({ method: "GET" }).handler(async () => {
  const allowed = getAllowedUuids();
  const data = (await coolifyFetch("/api/v1/applications")) as unknown;
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((a: Record<string, unknown>) => ({
      uuid: String(a.uuid ?? ""),
      name: String(a.name ?? a.uuid ?? "unnamed"),
      status: String(a.status ?? "unknown"),
      fqdn: (a.fqdn as string) ?? null,
      git_repository: (a.git_repository as string) ?? null,
      git_branch: (a.git_branch as string) ?? null,
      description: (a.description as string) ?? null,
    }))
    .filter((a) => allowed.has(a.uuid)) as Application[];
});
```

- [ ] **Step 3: Agregar el guard a `getApplication`**

Antes:
```ts
export const getApplication = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const app = (await coolifyFetch(`/api/v1/applications/${data.uuid}`)) as Record<string, unknown>;
```

Después:
```ts
export const getApplication = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    assertUuidAllowed(data.uuid);
    const app = (await coolifyFetch(`/api/v1/applications/${data.uuid}`)) as Record<string, unknown>;
```

- [ ] **Step 4: Agregar el guard a `deployApplication`**

Antes:
```ts
export const deployApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string; force?: boolean }) =>
    z.object({ uuid: z.string().min(1), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = new URLSearchParams({ uuid: data.uuid, force: String(data.force ?? false) });
    return await coolifyFetch(`/api/v1/deploy?${q.toString()}`, { method: "GET" });
  });
```

Después:
```ts
export const deployApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string; force?: boolean }) =>
    z.object({ uuid: z.string().min(1), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    assertUuidAllowed(data.uuid);
    const q = new URLSearchParams({ uuid: data.uuid, force: String(data.force ?? false) });
    return await coolifyFetch(`/api/v1/deploy?${q.toString()}`, { method: "GET" });
  });
```

- [ ] **Step 5: Agregar el guard a `stopApplication`, `startApplication`, `restartApplication`**

Las tres tienen la misma forma. Ejemplo para `stopApplication` (aplicar el mismo patrón a las otras dos, cambiando solo el nombre de la función y el path):

Antes:
```ts
export const stopApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    return await coolifyFetch(`/api/v1/applications/${data.uuid}/stop`, { method: "GET" });
  });
```

Después:
```ts
export const stopApplication = createServerFn({ method: "POST" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    assertUuidAllowed(data.uuid);
    return await coolifyFetch(`/api/v1/applications/${data.uuid}/stop`, { method: "GET" });
  });
```

Repetir exactamente igual (agregar `assertUuidAllowed(data.uuid);` como primera línea del handler) en `startApplication` (path `/start`) y `restartApplication` (path `/restart`).

- [ ] **Step 6: Agregar el guard a `listDeployments`**

Antes:
```ts
export const listDeployments = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const res = (await coolifyFetch(
      `/api/v1/deployments/applications/${data.uuid}`,
    )) as unknown;
```

Después:
```ts
export const listDeployments = createServerFn({ method: "GET" })
  .validator((d: { uuid: string }) => z.object({ uuid: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    assertUuidAllowed(data.uuid);
    const res = (await coolifyFetch(
      `/api/v1/deployments/applications/${data.uuid}`,
    )) as unknown;
```

- [ ] **Step 7: Agregar el guard a `getApplicationLogs`**

Antes:
```ts
export const getApplicationLogs = createServerFn({ method: "GET" })
  .validator((d: { uuid: string; lines?: number }) =>
    z.object({ uuid: z.string().min(1), lines: z.number().int().positive().max(2000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const q = new URLSearchParams({ lines: String(data.lines ?? 200) });
```

Después:
```ts
export const getApplicationLogs = createServerFn({ method: "GET" })
  .validator((d: { uuid: string; lines?: number }) =>
    z.object({ uuid: z.string().min(1), lines: z.number().int().positive().max(2000).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    assertUuidAllowed(data.uuid);
    const q = new URLSearchParams({ lines: String(data.lines ?? 200) });
```

**NO tocar `getDeployment`** — queda sin `assertUuidAllowed` a propósito (ver Global Constraints).

- [ ] **Step 8: Actualizar el mensaje de empty state en el dashboard**

En `src/routes/index.tsx`, la sección:

```tsx
{apps.length === 0 ? (
  <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
    No hay aplicaciones. Revisa que <code>COOLIFY_URL</code> y <code>COOLIFY_TOKEN</code> sean correctos.
  </div>
) : (
```

pasa a:

```tsx
{apps.length === 0 ? (
  <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
    No hay aplicaciones visibles. Revisa que <code>COOLIFY_URL</code>, <code>COOLIFY_TOKEN</code> y{" "}
    <code>COOLIFY_ALLOWED_UUIDS</code> estén configurados correctamente.
  </div>
) : (
```

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 10: Lint**

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 11: Verificación manual — sin `COOLIFY_ALLOWED_UUIDS` (empty state)**

Confirmar que `.env` NO tiene la línea `COOLIFY_ALLOWED_UUIDS`. Run: `npm run dev`, abrir `http://localhost:3000/`.
Expected: el dashboard muestra el mensaje de empty state actualizado del Step 8, "0 aplicaciones" en el header, y NINGUNA de las 12 apps reales listadas.

- [ ] **Step 12: Verificación manual — con `COOLIFY_ALLOWED_UUIDS` seteada a una sola app**

Agregar temporalmente a `.env`:
```
COOLIFY_ALLOWED_UUIDS=vcvwu5ynrjgzf04sjpel6xjy
```
Reiniciar `npm run dev`, refrescar `http://localhost:3000/`.
Expected: el dashboard muestra exactamente 1 aplicación ("Bot secretaria"), header dice "1 aplicación".

- [ ] **Step 13: Verificación manual — acceso directo a un uuid NO permitido queda bloqueado en servidor**

Con `COOLIFY_ALLOWED_UUIDS=vcvwu5ynrjgzf04sjpel6xjy` todavía activo, navegar directamente a:
`http://localhost:3000/app/yzees8astbum1ve4s8e8ka7b` (uuid de "frigate", NO está en la allowlist)
Expected: la página NO muestra los datos de "frigate" — se dispara el error boundary / página de error (`renderErrorPage`, ver `src/start.ts`) porque `getApplication` lanzó `Error("Aplicación no encontrada")`. Confirmar también en la terminal del dev server que no hubo ninguna llamada exitosa a la API real de Coolify para ese uuid (no debería aparecer tráfico hacia `/api/v1/applications/yzees8astbum1ve4s8e8ka7b` en los logs, porque `assertUuidAllowed` corta antes del fetch).

- [ ] **Step 14: Verificación manual — acceso directo a un uuid SÍ permitido funciona normal**

Navegar a `http://localhost:3000/app/vcvwu5ynrjgzf04sjpel6xjy`.
Expected: carga el detalle de "Bot secretaria" con normalidad (status, deployments, logs, botones deploy/start/stop/restart operables).

- [ ] **Step 15: Revertir el `.env` de prueba**

Quitar la línea `COOLIFY_ALLOWED_UUIDS=...` agregada en el Step 12 del `.env` local, o dejarla según decida el usuario — preguntar antes de decidir por él si debe quedar configurada permanentemente. Detener el dev server.

- [ ] **Step 16: Commit**

```bash
git add src/lib/coolify.functions.ts src/routes/index.tsx
git commit -m "feat: restrict visible/operable applications via COOLIFY_ALLOWED_UUIDS"
```

(Si el repo no tiene `.git` inicializado, omitir y notificar en el resumen final.)

---

### Task 3: Agregar CSRF middleware

**Files:**
- Modify: `src/start.ts`

**Interfaces:**
- Consumes: `createCsrfMiddleware` de `@tanstack/react-start` (confirmado exportado en `node_modules/@tanstack/start-client-core/dist/esm/index.d.ts:10`), campo `ctx.handlerType: 'serverFn' | 'router'` (confirmado en `node_modules/@tanstack/start-client-core/dist/esm/createMiddleware.d.ts:183`).
- Produces: `startInstance` con `requestMiddleware: [errorMiddleware, csrfMiddleware]` (mismo export, mismo nombre, usado por el resto del framework vía convención de archivo).

- [ ] **Step 1: Importar `createCsrfMiddleware` y registrar el middleware**

Archivo completo `src/start.ts`, antes:
```ts
import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
```

Después:
```ts
import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
```

`errorMiddleware` va primero en el array (más externo) para que su `try/catch` siga cubriendo cualquier error que dispare `csrfMiddleware`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Verificación manual — el warning de CSRF desaparece**

Run: `npm run dev`, abrir `http://localhost:3000/` en el navegador (para que se ejecute al menos una server function, ej. `listApplications`).
Expected: en la salida de `vite dev` ya NO aparece el mensaje `TanStack Start server functions are not protected by the CSRF middleware.`.

- [ ] **Step 4: Verificación manual — las acciones del dashboard siguen funcionando (mismo origen)**

Con el dashboard abierto en el navegador (same-origin, que es el caso normal de uso), probar un botón "Deploy" o "Start" sobre la app permitida del Task 2 (`vcvwu5ynrjgzf04sjpel6xjy`).
Expected: la acción se ejecuta con normalidad (toast de éxito), el CSRF middleware no bloquea peticiones same-origin legítimas.

- [ ] **Step 5: Commit**

```bash
git add src/start.ts
git commit -m "fix: add CSRF middleware for server functions"
```

(Si el repo no tiene `.git` inicializado, omitir y notificar en el resumen final.)

---

### Task 4: Verificación final end-to-end

**Files:** ninguno (solo verificación, sin cambios de código).

**Interfaces:**
- Consumes: todo lo construido en Tasks 1-3.
- Produces: confirmación de que ambos objetivos del spec quedan resueltos simultáneamente.

- [ ] **Step 1: Build de producción limpio**

Run: `npm run build`
Expected: build exitoso, sin errores de TypeScript ni de Vite.

- [ ] **Step 2: Dev server sin ninguno de los 3 warnings originales**

Run: `npm run dev`, abrir `http://localhost:3000/` y navegar a `http://localhost:3000/app/vcvwu5ynrjgzf04sjpel6xjy` (para ejercitar todos los server functions: `listApplications`, `getApplication`, `listDeployments`, `getApplicationLogs`).
Expected: en la terminal del dev server, revisando la salida completa, NO aparece:
  - `createServerFn().inputValidator() is deprecated`
  - `TanStack Start server functions are not protected by the CSRF middleware.`

- [ ] **Step 3: Confirmar filtrado activo con `COOLIFY_ALLOWED_UUIDS` configurada**

Con `.env` conteniendo `COOLIFY_ALLOWED_UUIDS=vcvwu5ynrjgzf04sjpel6xjy` (re-agregarla si se quitó en Task 2 Step 15), refrescar `http://localhost:3000/`.
Expected: solo "Bot secretaria" visible; navegar a `/app/yzees8astbum1ve4s8e8ka7b` sigue bloqueado (error, no datos de "frigate").

- [ ] **Step 4: Decidir el valor final de `COOLIFY_ALLOWED_UUIDS` en `.env`**

Preguntar al usuario qué UUIDs quiere dejar permitidos de forma permanente en `.env` (de las 12 apps reales listadas en Global Constraints), y dejar esa línea configurada según su respuesta. No decidir esto de forma autónoma — es una decisión de negocio/acceso, no técnica.

- [ ] **Step 5: Detener el dev server**

Terminar el proceso de `npm run dev` iniciado para las pruebas.
