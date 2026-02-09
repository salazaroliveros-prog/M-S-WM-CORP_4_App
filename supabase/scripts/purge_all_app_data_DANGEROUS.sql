-- DANGEROUS: PURGA TOTAL DE DATOS (todas las organizaciones)
--
-- Esto borra TODO el contenido de las tablas de la app en schema public.
-- NO toca `auth.users` directamente, pero elimina `org_members` y toda data ligada a organizaciones.
--
-- Uso recomendado: solo en entornos 100% de prueba.
-- Ejecutar en Supabase SQL Editor con rol con permisos (owner/postgres).

begin;

-- Orden: primero tablas hijas (por claridad). TRUNCATE ... CASCADE también resuelve dependencias.
truncate table
  public.audit_logs,
  public.webauthn_challenges,
  public.employee_webauthn_credentials,
  public.employee_attendance_tokens,
  public.attendance,
  public.employee_contracts,
  public.employee_rate_overrides,
  public.org_pay_rates,
  public.service_quotes,
  public.project_progress_lines,
  public.project_progress,
  public.requisition_items,
  public.requisitions,
  public.suppliers,
  public.budget_line_materials,
  public.budget_lines,
  public.budgets,
  public.transactions,
  public.material_price_quotes,
  public.material_catalog_items,
  public.apu_templates,
  public.employees,
  public.quotes,
  public.project_phases,
  public.payroll_entries,
  public.payroll_periods,
  public.projects,
  public.org_members,
  public.organizations
restart identity cascade;

commit;
