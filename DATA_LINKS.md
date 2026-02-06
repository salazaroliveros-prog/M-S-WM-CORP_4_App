
# Vinculación de datos entre módulos (M&S Construcción)

Este documento describe **qué información genera cada módulo**, **qué información consume** y **cuáles son las llaves/enlaces** que deben existir para que cada consulta traiga *exactamente* los datos correctos.

## Contexto global (obligatorio para modo Supabase)

- **`orgId`**: se resuelve en [App.tsx](App.tsx) con `ensureSupabaseSession()` + `getOrCreateOrgId()` y es el filtro principal en casi todas las tablas (`org_id`).
- **`projectId`**: proviene de la entidad **Proyecto** (`projects.id`) y es la llave que vincula Presupuestos / Seguimiento / Compras / RRHH.

## Entidades principales y llaves

- **Organización**: `organizations.id` → `org_id` en todas las tablas.
- **Proyecto**: `projects.id` + `projects.org_id`.
- **Transacción**: `transactions.project_id` + `transactions.org_id`.
- **Presupuesto**: `budgets.project_id` (1 por proyecto) + `budgets.org_id`.
- **Renglón de presupuesto**: `budget_lines.id` + `budget_lines.budget_id` + `budget_lines.org_id`.
- **Requisición**: `requisitions.project_id` + `requisitions.org_id`.
	- Enlace opcional: `requisitions.source_budget_line_id` → `budget_lines.id`.
- **Empleado**: `employees.id` + `employees.project_id?` + `employees.org_id`.
- **Contrato digital**: `employee_contracts.request_id` + `employee_contracts.org_id` y enlaces `employee_id?` + `project_id?`.
- **Asistencia**: se registra por RPC con `token` y queda asociada a `employee_id`, `project_id?`, `org_id`.

## Módulos: qué consumen / qué generan

### Proyectos (Gestión)

- **Consume**: `projects[]` (estado global en App).
- **Genera**:
	- Crea/actualiza/elimina **Proyectos**.
	- Puede navegar a Presupuestos pasando `projectId` (preselección).
	- Puede iniciar Cotizador pasando `clientName` + `location`.
- **Enlaces críticos**:
	- `Project.id` → usado por todos los demás módulos.
	- `Project.typology` → usado por Presupuestos (líneas default + catálogo APU).

### Inicio (Finanzas: registro)

- **Consume**: `projects[]` (para seleccionar proyecto activo).
- **Genera**: **Transacciones** (`transactions`) con `projectId`.
- **Enlaces críticos**:
	- `Transaction.projectId` → Dashboard y Seguimiento (métricas financieras).

### Dashboard (KPIs + gráficos)

- **Consume**:
	- `projects[]` (distribución por tipología).
	- `orgId` (para consultar `transactions` cuando `useCloud`).
- **Genera**: métricas (solo visualización).
- **Enlaces críticos**:
	- Consulta `transactions` filtrando por `org_id`.

### Presupuestos (Análisis de costos)

- **Consume**:
	- `projects[]` para seleccionar `projectId` y derivar `typology`.
	- `onLoadBudget(projectId)` / `onSaveBudget(projectId, typology, indirectPct, lines)`.
- **Genera**:
	- **Presupuesto** (`budgets`) + **renglones** (`budget_lines`) + **materiales** (`budget_line_materials`).
	- **Quick Buy**: `RequisitionData` hacia Compras.
- **Enlaces críticos**:
	- `selectedProjectId`.
	- En Quick Buy: `sourceBudgetLineId` (id del renglón) y `sourceLineName` (nombre del renglón).

### Seguimiento (Avance físico vs financiero)

- **Consume**:
	- `onLoadBudget(projectId)` para “plan” (renglones y costos).
	- `onLoadProgress(projectId)` / `onSaveProgress(projectId, payload)`.
- **Genera**: **Avance por renglón** (`project_progress` + `project_progress_lines`).
- **Enlaces críticos**:
	- `projectId`.
	- Identificación de renglón por `line_name` (merge por nombre normalizado).

### Compras (Requisiciones)

- **Consume**:
	- `projectId` (selección manual o `initialData` desde Presupuestos).
	- `onLoadBudget(projectId)` para derivar lista agregada de materiales.
	- `onCreateRequisition(data, supplierName)` para persistencia.
	- `onListRequisitions()` para historial.
- **Genera**: **Requisiciones** (`requisitions` + `requisition_items`).
- **Enlaces críticos**:
	- `RequisitionData.projectId`.
	- Enlace opcional a presupuesto: `RequisitionData.sourceBudgetLineId`.

### RRHH (Contratos + Asistencia + Planilla)

- **Consume**:
	- `projects[]` para asignación de empleado/contrato.
	- `onListEmployees`, `onCreateEmployee`.
	- `onListContracts`, `onUpsertContract`.
	- `onListAttendance(workDate)`.
	- `onSetAttendanceToken(employeeId, token)`.
- **Genera**:
	- Empleados (`employees`).
	- Contratos (`employee_contracts`).
	- Tokens de asistencia (RPC) y marcajes (RPC).
- **Enlaces críticos**:
	- `employeeId`.
	- `projectId` (si corresponde) para ligar contrato y empleado al proyecto.

### ContractIntake (externo: captura de datos del colaborador)

- **Consume**: `seed` embebido en `#contract-intake=...` (base64url JSON).
- **Genera**: `responseCode` (base64url JSON) que RRHH importa.
- **Enlaces críticos**:
	- Debe traer `requestId`.
	- Idealmente trae `employeeId` y `projectId` (para vincular sin ambigüedad).

### WorkerAttendance (externo: marcaje asistencia)

- **Consume**: `token` en `#asistencia=...`.
- **Genera**: marcaje de entrada/salida via `submit_attendance_with_token`.
- **Enlaces críticos**:
	- `token` debe mapear a `employee_id` + `org_id`.

## Enlaces faltantes / riesgos detectados (y mitigación)

1) **Historial de Compras sin `projectId` en la respuesta**

- Problema: el historial se puede mezclar entre proyectos si la UI necesita contexto por proyecto.
- Mitigación aplicada:
	- `listRequisitions()` ahora retorna `projectId` desde `v_requisition_totals`.
	- Compras filtra el historial por `selectedProjectId` cuando hay proyecto seleccionado.

2) **Contratos importados pueden quedar sin `projectId` aunque RRHH tenga un proyecto seleccionado**

- Problema: si el código importado no trae `projectId`, el registro en Supabase podía quedar sin vínculo al proyecto.
- Mitigación aplicada:
	- En RRHH, al importar se usa fallback al proyecto seleccionado y se persiste ese `projectId`.

3) **Enlace requisición ↔ renglón presupuesto puede perderse si se re-guardan presupuestos**

- Causa: `saveBudgetForProject()` borra y re-inserta renglones (`budget_lines`), por lo que los IDs cambian y el FK `source_budget_line_id` podría quedar `NULL`.
- Mitigación aplicada:
	- Al crear requisición se persiste también `sourceLineName` en `requisitions.notes` (además del FK) para trazabilidad humana.

---

Si quieres, el siguiente paso es convertir este mapa en un **checklist de validación** por módulo (qué campos deben existir antes de permitir acciones como Guardar/Enviar) y agregar validaciones mínimas en UI/DB donde falten.

