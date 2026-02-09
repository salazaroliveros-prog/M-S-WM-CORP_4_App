# Verificación de alineación: App ↔ Supabase schema

Fecha: 2026-02-09

Este chequeo compara:
- **Qué emite/consume la app** (inserts/updates/selects en `lib/db.ts` y componentes)
- **Qué exige el schema** (migraciones en `supabase/migrations/*.sql`)

Resultado general: **Sí coincide**. No encontré llamadas desde la app a tablas/columnas inexistentes ni columnas `NOT NULL` sin valor (donde no hay `DEFAULT`).

---

## 1) Tenancy / seguridad

**Schema:**
- Tablas: `organizations`, `org_members`
- Funciones: `app.is_org_member`, `app.is_org_admin` (usadas por RLS)

**App emite/usa:**
- `getOrCreateOrgId()` inserta en `organizations` y luego opera por `org_id`.

**Alineación:** OK.

---

## 2) Proyectos (`projects`)

**Schema (public.projects):**
- Campos usados por UI: `name`, `client_name`, `location`, `lot`, `block`, `coordinates`, `area_land`, `area_build`, `needs`, `status`, `start_date`, `typology`, `project_manager`
- Requeridos: varios `NOT NULL` + checks `area_land > 0`, `area_build > 0`

**App emite:**
- `createProject()`/`updateProject()` usan `toDbProject()` que mapea exactamente esos campos.

**Alineación:** OK.

---

## 3) Transacciones (`transactions`)

**Schema (public.transactions):**
- `occurred_at` es `timestamptz`
- `rent_end_date` es `date` (nullable)
- checks: `amount >= 0`, `cost >= 0`

**App emite:**
- `createTransaction()` inserta `occurred_at: tx.date` (ISO string) y `rent_end_date` desde un `<input type="date">` (formato `yyyy-mm-dd`).

**Alineación:** OK.

---

## 4) Presupuestos (`budgets`, `budget_lines`, `budget_line_materials`)

**Schema:**
- `budgets` único por `project_id` (1 presupuesto por proyecto)
- `budget_lines.direct_cost` se recalcula por trigger y se “bump”ea al insertar materiales

**App emite:**
- `saveBudgetForProject()` hace `upsert` de header por `project_id`, luego reemplaza líneas y materiales.
- No escribe `direct_cost` manualmente (lo calcula la DB).

**Alineación:** OK.

---

## 5) Seguimiento (`project_progress`, `project_progress_lines`)

**Schema:**
- Header único por `project_id`
- Líneas por `line_name` (no depende de IDs de `budget_lines`)

**App emite:**
- `saveProgressForProject()` hace `upsert` por `project_id` y reemplaza líneas.

**Alineación:** OK.

---

## 6) Compras (`suppliers`, `requisitions`, `requisition_items`)

**Schema:**
- `requisitions.status` con workflow/trigger (transiciones válidas)
- Vista `v_requisition_totals` para listados
- En 2026-02-06 se agregan columnas `default_note_template`, `terms_template` a `suppliers`

**App emite:**
- `createRequisition()` crea primero en `draft`, inserta items, luego transiciona a `sent` (compatible con políticas y trigger).
- `upsertSupplier()` escribe `default_note_template` y `terms_template`.

**Alineación:** OK.

---

## 7) RRHH (`employees`, `employee_contracts`, `org_pay_rates`, `employee_rate_overrides`)

**Schema:**
- `employees.position` tiene un `check (...)` con valores exactos (incluye acentos)
- `employee_contracts.seed` es `jsonb not null`
- RPC pública: `submit_employee_contract_response(p_request_id, p_response)`

**App emite:**
- `createEmployee()` inserta `position` como string desde UI; el tipo TS usa exactamente los mismos valores permitidos.
- `upsertEmployeeContract()` siempre manda `seed` (aunque sea `{}`) y usa `onConflict: org_id,request_id`.
- `submitEmployeeContractResponsePublic()` llama al RPC.

**Alineación:** OK.

---

## 8) Asistencia / biometría

**Schema:**
- RPC wrappers públicos para exponer funciones en schema `app`:
  - `public.set_employee_attendance_token`
  - `public.submit_attendance_with_token`
  - `public.get_attendance_token_info`
- Vista: `v_attendance_daily`

**App emite:**
- Llama los RPC con los mismos parámetros (`p_token`, `p_action`, `p_lat`, `p_lng`, etc.)
- Lista asistencias desde `v_attendance_daily` filtrando por `org_id` y `work_date`.

**Alineación:** OK.

---

## 9) Catálogo de materiales / precios / APU

**Schema:**
- `material_catalog_items` unique: `(org_id, name_norm, unit)`
- `material_price_quotes` unique: `(material_id, org_id, vendor, price_date)`
- `apu_templates` unique: `(org_id, typology, name_norm)`
- Vista: `v_material_latest_prices`

**App emite:**
- Upserts con `onConflict` exactamente iguales a las constraints.
- Consulta de precios latest por la vista.

**Alineación:** OK.

---

## 10) Auditoría (`audit_logs`)

**Schema:**
- Triggers registran insert/update/delete en tablas clave.

**App emite/consume:**
- Solo lectura (`listAuditLogs()`); no inserta manualmente.

**Alineación:** OK.

---

## Tablas presentes en schema pero no usadas por módulos actuales

No es inconsistencia; solo significa que el schema incluye funcionalidades adicionales todavía no conectadas en UI:
- `payroll_periods`, `payroll_entries` (nómina)
- `quotes` (cotización “clásica”)
- `project_phases` (seguimiento por fases)

---

## Único punto a vigilar (no es error, pero conviene saberlo)

- Las tablas `budgets` y `project_progress` usan `onConflict: project_id` (sin `org_id`). Esto es correcto porque `project_id` es un UUID único global de `projects`.

Si quieres, el siguiente paso es que me confirmes **qué datos “reales” estás creando en producción** (ej: campos opcionales que siempre te llegan vacíos) y te preparo un checklist por módulo para validar con capturas o exports.
