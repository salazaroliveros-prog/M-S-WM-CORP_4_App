# Checklist de validación de enlaces (por módulo)

Objetivo: asegurar que cada módulo consulte/guarde **exactamente** los datos correctos, con enlaces consistentes entre tablas y pantallas.

## 0) Precondiciones globales

### Modo Supabase
- [ ] `orgId` resuelto (App ya lo hace con `ensureSupabaseSession()` + `getOrCreateOrgId()`).
- [ ] Migraciones aplicadas según módulo (init + progress + rrhh + attendance + requisitions + webauthn, etc.).

### Modo local
- [ ] Se entiende que **no hay `orgId`**, y varias funciones cloud quedan deshabilitadas o con fallback a `localStorage`.

---

## 1) Proyectos (Gestión)

**Genera**: `projects` (llave base para el resto).

Validaciones:
- [ ] Al crear/editar proyecto: `name`, `clientName`, `location`, `areaLand > 0`, `areaBuild > 0`, `projectManager`.
- [ ] `Project.id` existe y es único.

Enlaces que habilita:
- Presupuestos/Seguimiento/Compras/RRHH: `projectId`.
- Cotizador: `clientName` + `location` (no requiere IDs).

---

## 2) Inicio (Transacciones)

**Guarda**: `transactions`.

Validaciones:
- [ ] `Transaction.projectId` obligatorio.
- [ ] `type` ∈ {`INGRESO`, `GASTO`}.
- [ ] `cost`/`amount` numéricos (>= 0).
- [ ] `occurred_at` (`date`) ISO válido.

Enlaces:
- Dashboard: consulta por `orgId`.
- Seguimiento: usa transacciones para métricas por proyecto.

---

## 3) Dashboard

**Consulta**: `transactions` por `orgId` (cloud) o `localStorage` (local).

Validaciones:
- [ ] Si `useCloud=true`: `orgId` no nulo.

---

## 4) Presupuestos

**Guarda**: `budgets`, `budget_lines`, `budget_line_materials`.

Validaciones:
- [ ] `projectId` seleccionado.
- [ ] `typology` definido (deriva de Proyecto).
- [ ] Al guardar: `lines[].name`, `lines[].unit`, `lines[].quantity` numérico.

Enlaces:
- Seguimiento: carga el plan del proyecto vía `projectId`.
- Compras (Quick Buy): emite `RequisitionData`.

Checklist Quick Buy:
- [ ] `RequisitionData.projectId`.
- [ ] Si se pasa `sourceBudgetLineId`, también pasar `sourceLineName` (para trazabilidad).
- [ ] `items[]` no vacío cuando se pretende “enviar”.

---

## 5) Seguimiento

**Guarda**: `project_progress` + `project_progress_lines`.

Validaciones:
- [ ] `projectId` seleccionado.
- [ ] Debe existir presupuesto (o al menos líneas de avance guardadas) para evitar avance sin plan.
- [ ] `completedQty` clamped entre 0 y `plannedQty`.

Enlaces:
- Plan: `projectId` → `budgets`.
- Avance: se vincula por `projectId`.

---

## 6) Compras

**Guarda**: `requisitions` + `requisition_items`.

Validaciones:
- [ ] `projectId` seleccionado (o recibido por `initialData`).
- [ ] Si `status='sent'`: `items[]` no vacío.
- [ ] `items[].name` y `items[].unit` no vacíos.
- [ ] `items[].quantity > 0`.

Enlaces:
- Requisición → Proyecto: `requisitions.project_id`.
- Requisición → Renglón presupuesto (opcional): `source_budget_line_id`.
- Requisición trazable aunque cambien IDs de renglones: `notes` incluye `sourceLineName`.

Historial:
- [ ] Debe poder filtrarse por `projectId` (para evitar mezcla de proyectos). (Aplicado)

---

## 7) RRHH

### Empleados
Validaciones:
- [ ] `name` obligatorio.
- [ ] `position` en catálogo esperado.
- [ ] `dailyRate >= 0`.
- [ ] `projectId` opcional, pero si existe debe ser un `projectId` real.

### Contratos digitales
Validaciones:
- [ ] `requestId` obligatorio.
- [ ] Ideal: `employeeId` y `projectId` presentes en `seed`.
- [ ] Si el código importado no trae `projectId`: usar fallback al proyecto seleccionado (Aplicado).

### Asistencia
Validaciones:
- [ ] Token generado por empleado (`set_employee_attendance_token`).
- [ ] Marcaje exige GPS y evidencia biométrica/código.

---

## 8) ContractIntake (externo)

Validaciones:
- [ ] El `seed` del hash incluye `requestId`, `employeeName`, `role`.
- [ ] Respuesta (`responseCode`) incluye `requestId` y datos mínimos (dpi, phone, startDate, accepted=true).

Enlaces:
- RRHH importa y persiste en `employee_contracts` por `(orgId, requestId)`.

---

## 9) WorkerAttendance (externo)

Validaciones:
- [ ] `token` válido.
- [ ] GPS listo.
- [ ] WebAuthn sólo si HTTPS/secure context; si no, usar código.

Enlaces:
- RPC resuelve `token` → `employee_id` + `org_id`.

---

## Nota importante: IDs de renglones en presupuesto

El guardado de presupuesto borra y reinserta renglones (IDs pueden cambiar). Por eso:
- Enlaces “fuertes” por `source_budget_line_id` pueden romperse en el tiempo.
- Mantener también enlace “humano” con `sourceLineName` (ya se guarda en `requisitions.notes`).
