# Restringir recursos visibles por variable de entorno + fix de warnings

## Contexto

Mini-coolify es un dashboard que envuelve la API de Coolify. Hoy solo maneja
un tipo de recurso: **applications** (`listApplications`, `getApplication`,
`listDeployments`, `getDeployment`, `getApplicationLogs`,
`deployApplication`, `stopApplication`, `startApplication`,
`restartApplication`, todas en `src/lib/coolify.functions.ts`).

No hay control de acceso alguno hoy: cualquiera con acceso al dashboard ve y
controla todas las aplicaciones que Coolify devuelve.

## Objetivo 1 — Restringir recursos visibles

Limitar qué applications son visibles/operables en el dashboard a un
subconjunto definido por variable de entorno, con **enforcement en
servidor** (no solo cosmético en la lista).

### Variable de entorno

`COOLIFY_ALLOWED_UUIDS` — lista de UUIDs de aplicaciones Coolify separados
por comas. Ej: `COOLIFY_ALLOWED_UUIDS=abc123,def456`.

### Comportamiento

- Si la variable **no está definida o está vacía**: el set de uuids
  permitidos es vacío → el dashboard no muestra ninguna aplicación (empty
  state), en vez de mostrarlas todas. La restricción es la política por
  defecto, no opt-in.
- Si está definida: solo las apps cuyo `uuid` esté en el set son visibles y
  operables.

### Alcance del enforcement

- `listApplications`: filtra el array de resultado a solo uuids permitidos.
- `getApplication`, `listDeployments`, `getApplicationLogs`,
  `deployApplication`, `stopApplication`, `startApplication`,
  `restartApplication`: todas reciben un `uuid` de aplicación como input.
  Cada una valida ese uuid contra el set permitido **antes** de llamar a la
  API de Coolify. Si no está permitido, lanzan
  `Error("Aplicación no encontrada")` — mismo mensaje que un 404 real, para
  no filtrar por el mensaje de error qué uuids existen en la instancia de
  Coolify.
- `getDeployment`: recibe el uuid de un *deployment*, no de una app.
  Validar correctamente requeriría una llamada extra a Coolify para
  resolver a qué aplicación pertenece ese deployment. Se deja **sin
  validar**: los uuids de deployment son difíciles de adivinar y solo
  exponen logs de un deploy puntual, no control de la aplicación.

### Implementación

En `src/lib/coolify.functions.ts`:

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

- `listApplications` llama a `getAllowedUuids()` una vez y filtra el array
  mapeado con `.filter((a) => allowed.has(a.uuid))`.
- Cada handler que recibe `{ uuid }` (de aplicación) llama
  `assertUuidAllowed(data.uuid)` como primera línea del handler.

En `src/routes/index.tsx`: el mensaje del empty state existente
("No hay aplicaciones. Revisa que COOLIFY_URL y COOLIFY_TOKEN sean
correctos.") se amplía para cubrir también el caso de
`COOLIFY_ALLOWED_UUIDS` vacía/no configurada.

## Objetivo 2 — Corregir warnings de vite/dev server

1. **`inputValidator()` deprecado**: reemplazar las 6 ocurrencias de
   `.inputValidator(...)` por `.validator(...)` en
   `src/lib/coolify.functions.ts` (API idéntica, solo cambia el nombre del
   método — confirmado en
   `node_modules/@tanstack/start-client-core/dist/esm/createServerFn.d.ts`).

2. **CSRF middleware faltante**: agregar `createCsrfMiddleware` (exportado
   por `@tanstack/react-start`) en `src/start.ts`, filtrando por
   `ctx.handlerType === 'serverFn'`, y registrarlo en
   `requestMiddleware` junto al `errorMiddleware` existente.

## Fuera de alcance

- Otros tipos de recursos de Coolify (databases, services) — no existen
  hoy en este proyecto.
- Validar `getDeployment` contra la app dueña (ver justificación arriba).
- UI para editar `COOLIFY_ALLOWED_UUIDS` desde el dashboard — se configura
  solo por variable de entorno, como `COOLIFY_URL`/`COOLIFY_TOKEN`.
