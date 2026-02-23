# Verificación en campo: Offline-first + Realtime (Supabase)

Este checklist valida que **una app instalada (PWA) en otro dispositivo**:
1) pueda capturar datos en campo (offline o con mala señal),
2) sincronizarlos al reconectar,
3) y que **otro dispositivo** vea los cambios en **tiempo real** (Realtime).

## 0) Requisitos (imprescindibles)

- Ambos dispositivos deben quedar trabajando sobre **la misma organización (`org_id`)**.
  - Si usas **el mismo usuario de Supabase** en ambos: OK.
  - Si usas **usuarios distintos**: el segundo debe ser **miembro** en `org_members` del mismo `org_id` (owner/admin lo agrega).
- La build debe tener **sincronización nube** habilitada.
  - Variables requeridas: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
  - Flag requerido: `VITE_ENABLE_CLOUD_LOGIN=true` (si no, la app opera como “Modo local” aunque tenga internet)
- Supabase Realtime debe estar habilitado para las tablas usadas.
  - Dashboard: *Database → Replication → Realtime* (activar tablas), o ejecutar el script:
    - `supabase/scripts/enable_realtime_publication.sql`
- En la app debes ver estado **“Nube sincronizada”** (arriba). Si dice “Modo local (sin nube)”, ese dispositivo no enviará nada a Supabase.

## 1) Prueba rápida (dos dispositivos online)

**Objetivo:** al guardar algo en A, B lo ve sin refrescar.

1. En **Dispositivo A (oficina)**: abrir la app, iniciar sesión y confirmar “Nube sincronizada”.
2. En **Dispositivo B (campo)**: abrir/instalar la app (PWA) e iniciar sesión; confirmar “Nube sincronizada”.
3. En A, crea un registro en un módulo:
   - Proyectos: crear/editar un proyecto
   - Compras: crear requisición
   - RRHH: crear empleado o contrato
   - Cotizador: crear cotización
   - Seguimiento: guardar avance
4. En B, mantén abierto el mismo módulo.

**PASA si:** en 1–3 segundos B refleja el cambio (lista/estado) sin recargar manual.

## 2) Prueba de campo (offline → reconexión → realtime)

**Objetivo:** capturar datos sin señal y sincronizar al volver.

1. En **Dispositivo B (campo)**, con la app abierta, activa **Modo avión** (o corta datos/WiFi).
2. Captura información:
   - Compras: crea requisición
   - RRHH: crea empleado / registra asistencia manual
   - Presupuestos / Seguimiento: guarda cambios
   - Inicio: registra una transacción (se encola localmente)
3. Cierra y vuelve a abrir el módulo para confirmar que quedó guardado localmente.
4. Desactiva modo avión y espera ~5–20s.
5. En **Dispositivo A (oficina)** con el módulo abierto, observa.

**PASA si:**
- B no pierde lo capturado mientras está offline.
- Al reconectar, B sincroniza automáticamente.
- A recibe los cambios sin refrescar (Realtime).

## 3) Prueba de asistencia (campo)

La vista de asistencia del trabajador funciona como PWA por hash:
- `#asistencia=<token>`

1. Abre el link en el teléfono del trabajador.
2. Sin señal: intenta `check_in`/`check_out` (quedará en cola local si falla el envío).
3. Al reconectar: se drena la cola y se envía a Supabase.

**PASA si:** el registro aparece en RRHH (en oficina) al reconectar.

## 4) Verificación automatizada (opcional, desde tu PC)

Para validar que Supabase + Realtime están realmente emitiendo eventos (cuando hay credenciales y Realtime activo):

- `npm run test:supabase`

Opcionalmente fuerza que el test de realtime falle si no llega evento:
- PowerShell:
  - `$env:SUPABASE_REQUIRE_REALTIME='true'; npm run test:supabase`

> Nota: Supabase Auth puede rate-limitar en pruebas repetidas. Si aparece rate limit, espera ~1 min y reintenta.
