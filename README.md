<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/temp/2

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. (Opcional) Configurar Supabase para CRUD real:
   - Copie [.env.local.example](.env.local.example) a `.env.local` y complete `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
   - En Supabase Auth, habilite **Anonymous sign-ins** (o reemplace por un login real).
    - Aplique la migración SQL en `supabase/migrations/20260204_init.sql`.
    - (Opcional) Para **APUs + precios desde Web con cache** aplique también `supabase/migrations/20260204_catalog_apu_prices.sql`.
3. Run the app:
   `npm run dev`

## Tests

### Windows + nvm (si `node`/`npm` no aparecen en PATH)

En algunos entornos Windows, aunque `nvm` esté instalado, PowerShell puede no encontrar `node`/`npm` en `PATH`.

1. Verifica `nvm`:
   `nvm version`
2. Instala y activa una versión (ejemplo LTS):
   `nvm install 24.13.0`
   `nvm use 24.13.0`
3. Si aun así `node -v` falla, agrega temporalmente el symlink de nvm al `PATH` en la **misma** sesión de PowerShell:
   `$env:PATH = "C:\\nvm4w\\nodejs;" + $env:PATH`
   `node -v`
   `npm -v`

- Unit tests (sin Supabase, usando mocks): `npm test`
- Integration tests (con Supabase real):
  - Cree `.env.local` desde [.env.local.example](.env.local.example) y defina **ambas** variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
  - Recomendado: cree un usuario de prueba en **Supabase → Authentication → Users** y agregue en `.env.local`:
    - `SUPABASE_TEST_EMAIL`
    - `SUPABASE_TEST_PASSWORD`
    (esto evita depender de Anonymous sign-in y reduce rate limiting en CI)
  - Si el usuario de prueba no tiene permisos por RLS (no pertenece a una organización), ejecute el script:
    - [supabase/scripts/bootstrap_test_user_org.sql](supabase/scripts/bootstrap_test_user_org.sql)
  - Luego ejecute: `npm run test:supabase`

### Realtime (opcional)

Por defecto, Supabase Realtime se habilita **por tabla**. Si quieres suscripciones en tiempo real desde `supabase-js` (canales `postgres_changes`):

- En Supabase Dashboard: **Database → Replication → Realtime** y activa las tablas que te interesan (por ejemplo `transactions`).
- Alternativa por SQL (idempotente): ejecuta [supabase/scripts/enable_realtime_publication.sql](supabase/scripts/enable_realtime_publication.sql).

El repo incluye un test opcional: [tests/integration/supabase.realtime.integration.test.ts](tests/integration/supabase.realtime.integration.test.ts). Por defecto solo avisa con `console.warn` si no llegan eventos.
Si quieres que falle cuando no haya Realtime, define `SUPABASE_REQUIRE_REALTIME=true` y corre `npm run test:supabase`.

En PowerShell:

`$env:SUPABASE_REQUIRE_REALTIME='true'; npm run test:supabase`

## Validación de datos y Realtime (app)

La app incluye un panel **Diagnóstico Supabase** que valida:

- Que la aplicación **lee/escribe** en las tablas principales (con datos temporales con prefijo `SMOKE_TEST`).
- Que **Realtime** entrega eventos y que hay **cobertura** (suscripción) para las tablas principales.
- Que al final se hace **limpieza** (borrado) de los datos de prueba creados por el diagnóstico.

### Monitor Realtime (cross-dispositivo)

Para comprobar que los cambios se ven en vivo desde **otro dispositivo** (sin escribir datos desde el monitor):

1) En el dispositivo B: abrir **Diagnóstico Supabase → Monitor Realtime** y presionar **Iniciar**.
2) En el dispositivo A: crear/editar/borrar datos (por ejemplo en Proyectos/Compras/RRHH).
3) En el dispositivo B: verás un feed de eventos `INSERT/UPDATE/DELETE` por tabla.

Notas:

- Ambos dispositivos deben estar en la **misma organización** (mismo `org_id`).
- Realtime debe estar habilitado en Supabase por tabla (ver sección **Realtime** arriba).

## Validación de datos reales (SQL)

Para validar integridad de datos reales en una instalación donde usas **una sola organización**:

- Ejecuta: [supabase/scripts/validate_real_data_single_org.sql](supabase/scripts/validate_real_data_single_org.sql)

Incluye conteos por tabla, chequeos de integridad y un resumen compacto (SUMMARY) para detectar orfandades/inconsistencias.

### Limpieza de datos de prueba (SQL)

- Purga segura por org (patrones `SMOKE_TEST`/`VITEST`):
   [supabase/scripts/purge_test_data_by_org.sql](supabase/scripts/purge_test_data_by_org.sql)
- Wipe total (peligroso, TRUNCATE/CASCADE):
   [supabase/scripts/purge_all_app_data_DANGEROUS.sql](supabase/scripts/purge_all_app_data_DANGEROUS.sql)

## Deploy a GitHub Pages

Este repo está configurado para desplegarse automáticamente a GitHub Pages con GitHub Actions.

1) En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2) Hacer push a `main`.
3) El workflow publicará la carpeta `dist/`.

### Supabase en GitHub Pages (config permanente)

En GitHub Pages no existe `.env.local` en runtime; Vite necesita las variables en **build time**.

Este repo ya soporta esto con el workflow `.github/workflows/deploy-pages.yml`.
Configure estos **Secrets** en GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (solo ANON, nunca Service Role)
- (Opcional) `VITE_ORG_NAME`

Ruta: **Settings → Secrets and variables → Actions → New repository secret**.

Luego haga push a `main` para re-deploy.

URL esperada:

`https://salazaroliveros-prog.github.io/M-S-WM-CORP_4_App/`

Si quieres probar el build de Pages local:

`npm run build:pages`

## Catálogo APU + Precios (importación web segura)

La app **no hace scraping** automático de sitios. Para mantener datos **seguros y trazables**, se importan desde una URL explícita (CSV/JSON) que usted controle o desde APIs oficiales con permiso.

### URLs oficiales (equipo)

Pegue aquí las URLs “oficiales” que usará todo el equipo (misma fuente para todos):

- **Precios (CSV):** <PEGAR_URL_CSV_AQUI>
- **APUs (CSV o JSON):** <PEGAR_URL_APUS_AQUI>

Notas:

- La app es **offline-first** para estas bibliotecas: cuando importas desde URL, primero busca si ya está descargado en el navegador; si no existe, lo descarga y lo guarda en caché/biblioteca local.
- Para “forzar” una descarga nueva: cambia la URL (por ejemplo agregando `?v=YYYYMMDD`) o limpia el almacenamiento del sitio en el navegador.

### CSV de precios (para "Actualizar Precios Web")

- Debe ser una URL pública que devuelva texto CSV.
- Encabezados soportados (case-insensitive):
   - `name` o `descripcion`
   - `unit_price` o `precio`
   - `unit` (opcional)

Ejemplo:

```csv
name,unit,unit_price
Cemento 42.5kg,saco,78.50
Arena lavada,m3,210.00
Varilla #3,unidad,36.00
```

Sugerencia: Google Sheets "Publicar en la web" como CSV.

### JSON de APUs (para "Actualizar APUs Web")

Formato recomendado: arreglo de objetos.

```json
[
   {
      "typology": "RESIDENCIAL",
      "name": "Limpieza y chapeo",
      "unit": "m2",
      "laborCost": 15,
      "equipmentCost": 5,
      "materials": [
         { "name": "Cal", "unit": "lbs", "quantityPerUnit": 0.5, "unitPrice": 0 }
      ],
      "meta": {
         "rendimiento_mo": "0.08 jornales/m2",
         "rendimiento_material": "0.5 lbs/m2"
      },
      "currency": "GTQ",
      "source": "Base interna",
      "effectiveDate": "2026-02-04"
   }
]
```

Una vez importado, al crear un renglón personalizado puede activar "catálogo Supabase" para autocompletar mano de obra/equipo/materiales y aplicar precios cacheados.
