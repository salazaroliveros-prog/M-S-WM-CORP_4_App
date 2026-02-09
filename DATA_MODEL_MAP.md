# Mapa de datos (App ↔ Supabase)

Este documento cruza los módulos de la app con las tablas/vistas/funciones que existen en Supabase (según `supabase/migrations/*.sql`) y que consume el código (principalmente `lib/db.ts`).

## Tablas/vistas/funciones usadas por la app

### Tenancy / seguridad
- Tablas: `organizations`, `org_members`
- Funciones (RLS): `app.is_org_member(uuid)`, `app.is_org_admin(uuid)`

### Proyectos (components/Proyectos.tsx)
- Tabla: `projects`

### Inicio + Dashboard + Seguimiento (flujo caja)
- Tabla: `transactions`
- Vista (reporting): `v_project_cashflow_monthly`

### Presupuestos
- Tablas: `budgets`, `budget_lines`, `budget_line_materials`
- Vista: `v_budget_totals`

### Compras
- Tablas: `suppliers`, `requisitions`, `requisition_items`
- Vista: `v_requisition_totals`

### Seguimiento (progreso físico)
- Tablas: `project_progress`, `project_progress_lines`

### RRHH (empleados + contratos)
- Tablas: `employees`, `employee_contracts`, `org_pay_rates`, `employee_rate_overrides`
- RPC pública: `submit_employee_contract_response(request_id, response)`

### Asistencia (worker app)
- Tablas: `attendance`, `employee_attendance_tokens`, `employee_webauthn_credentials`, `webauthn_challenges`
- Vista: `v_attendance_daily`
- RPC públicas: `set_employee_attendance_token(employee_id, token)`, `submit_attendance_with_token(...)`, `get_attendance_token_info(token)`

### Cotizador (catálogo + APU + histórico)
- Tablas: `material_catalog_items`, `material_price_quotes`, `apu_templates`, `service_quotes`
- Vista: `v_material_latest_prices`

### Auditoría
- Tabla: `audit_logs`

## Tablas que existen pero NO están siendo usadas por los módulos principales (por ahora)
Estas tablas están creadas en las migraciones, pero no aparecen consumidas por `lib/db.ts`/componentes en el estado actual del repo:
- `payroll_periods`, `payroll_entries` (nómina)
- `quotes` (cotizaciones “clásicas” — distinto de `service_quotes`)
- `project_phases` (seguimiento por fases — la app usa `project_progress*`)

No es un problema: solo significa que el schema incluye capacidad futura.

## Validación rápida (qué revisar si algo “no coincide”)
- Si el frontend falla con “Could not find the table … / schema cache”, normalmente falta aplicar migraciones (iniciando por `supabase/migrations/20260204_init.sql`).
- Si Realtime no llega para una tabla, revisa que esté incluida en la publicación Realtime (ya hay una migración para eso: `20260207_realtime_publication_all_tables.sql`).
