import type { BudgetLine, MaterialItem, Project, Transaction } from '../types';
import { getSupabaseClient } from './supabaseClient';

export type DbMode = 'supabase' | 'local';

function requireNonEmpty(value: unknown, label: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`${label} requerido.`);
  return s;
}

function requireFiniteNumber(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} inválido.`);
  return n;
}

function normalizeText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/^\s*\d+\s*[\.|\)]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };

  const pushRow = () => {
    // ignore completely empty trailing rows
    if (row.length === 1 && row[0].trim() === '') {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      pushCell();
      continue;
    }

    if (ch === '\n') {
      pushCell();
      pushRow();
      continue;
    }

    if (ch === '\r') {
      continue;
    }

    cell += ch;
  }

  pushCell();
  if (row.length > 0) pushRow();
  return rows;
}

function toDbProject(p: Partial<Project>, orgId: string) {
  return {
    org_id: orgId,
    name: p.name,
    client_name: p.clientName,
    location: p.location,
    lot: p.lot ?? null,
    block: p.block ?? null,
    coordinates: p.coordinates ?? null,
    area_land: p.areaLand,
    area_build: p.areaBuild,
    needs: p.needs ?? '',
    status: p.status ?? 'standby',
    start_date: p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : undefined,
    typology: p.typology,
    project_manager: p.projectManager,
  };
}

function fromDbProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    clientName: row.client_name,
    location: row.location,
    lot: row.lot ?? undefined,
    block: row.block ?? undefined,
    coordinates: row.coordinates ?? undefined,
    areaLand: Number(row.area_land),
    areaBuild: Number(row.area_build),
    needs: row.needs ?? '',
    status: row.status,
    startDate: row.start_date ? new Date(row.start_date).toISOString() : new Date().toISOString(),
    typology: row.typology,
    projectManager: row.project_manager,
  };
}

function defaultOrgName(): string {
  const metaEnv = (import.meta as any).env as Record<string, any> | undefined;
  const env = metaEnv ?? (process.env as Record<string, any> | undefined) ?? {};
  const name =
    (env.VITE_ORG_NAME as string | undefined) ??
    (env.SUPABASE_TEST_ORG_NAME as string | undefined) ??
    (env.SUPABASE_ORG_NAME as string | undefined);
  return name && String(name).trim() ? String(name).trim() : 'M&S Construcción';
}

export async function ensureSupabaseSession(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return;

  // Prefer anonymous sign-in for simple kiosk/admin-password UI.
  const anon = await supabase.auth.signInAnonymously();
  if (anon.error) {
    throw new Error(
      `No se pudo iniciar sesión en Supabase. Habilite Anonymous Sign-ins en Auth o implemente login por email. Detalle: ${anon.error.message}`
    );
  }

  const session = anon.data?.session;
  if (session?.access_token && session.refresh_token) {
    // Force the client to adopt the new session immediately.
    // This avoids a race where subsequent PostgREST requests are still treated as anon.
    const setRes = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (setRes.error) throw setRes.error;
  }

  // Wait briefly for the auth state to be fully usable by downstream queries.
  const deadline = Date.now() + 2500;
  let lastSession: any = null;
  while (Date.now() < deadline) {
    const verify = await supabase.auth.getSession();
    lastSession = verify.data.session;
    if (lastSession?.access_token) {
      const userRes = await supabase.auth.getUser();
      if (userRes.data.user?.id) return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error('No se pudo establecer sesión de Supabase (token no disponible).');
}

export async function getOrCreateOrgId(orgName = defaultOrgName()): Promise<string> {
  const supabase = getSupabaseClient();

  const memberships = await supabase
    .from('org_members')
    .select('org_id, role')
    .limit(1);

  if (memberships.error) throw memberships.error;
  if (memberships.data && memberships.data.length > 0) return memberships.data[0].org_id as string;

  let sess = await supabase.auth.getSession();
  if (!sess.data.session) {
    await ensureSupabaseSession();
    sess = await supabase.auth.getSession();
  }
  const userId = sess.data.session?.user?.id;
  if (!userId) {
    throw new Error('No hay sesión activa de Supabase. Inicie sesión (anon/email) antes de crear la organización.');
  }

  // Create org (created_by default = auth.uid(); trigger will insert org_members(owner) for creator)
  const tryCreate = async () => {
    return await supabase
      .from('organizations')
      .insert({ name: orgName, created_by: userId })
      .select('id')
      .single();
  };

  let created = await tryCreate();
  if (created.error) {
    const msg = String((created.error as any)?.message || created.error);
    const isRls = msg.toLowerCase().includes('row-level security') && msg.toLowerCase().includes('organizations');
    if (isRls) {
      // This almost always means the request reached PostgREST without a valid JWT.
      // Clear any stale client auth state, establish a fresh session, then retry.
      try {
        await supabase.auth.signOut();
      } catch {}

      await ensureSupabaseSession();

      for (const delayMs of [150, 350, 700]) {
        await new Promise((r) => setTimeout(r, delayMs));
        created = await tryCreate();
        if (!created.error) break;
      }
    }
  }

  if (created.error) throw created.error;
  return created.data.id as string;
}

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------

export async function listProjects(orgId: string): Promise<Project[]> {
  const supabase = getSupabaseClient();
  const res = await supabase
    .from('projects')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (res.error) throw res.error;
  return (res.data ?? []).map(fromDbProject);
}

export async function createProject(orgId: string, project: Partial<Project>): Promise<Project> {
  const supabase = getSupabaseClient();
  const payload = toDbProject(project, orgId);

  const res = await supabase
    .from('projects')
    .insert(payload)
    .select('*')
    .single();

  if (res.error) throw res.error;
  return fromDbProject(res.data);
}

export async function updateProject(orgId: string, projectId: string, patch: Partial<Project>): Promise<Project> {
  const supabase = getSupabaseClient();
  const payload = toDbProject(patch, orgId);

  // Remove undefined keys so we don't overwrite existing fields.
  Object.keys(payload).forEach((k) => (payload as any)[k] === undefined && delete (payload as any)[k]);

  const res = await supabase
    .from('projects')
    .update(payload)
    .eq('id', projectId)
    .eq('org_id', orgId)
    .select('*')
    .single();

  if (res.error) throw res.error;
  return fromDbProject(res.data);
}

export async function deleteProject(orgId: string, projectId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const res = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('org_id', orgId);

  if (res.error) throw res.error;
}

// -----------------------------------------------------------------------------
// Transactions
// -----------------------------------------------------------------------------

export async function createTransaction(orgId: string, tx: Transaction): Promise<void> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(tx?.projectId, 'projectId');
  requireNonEmpty(tx?.type, 'type');
  requireNonEmpty(tx?.date, 'date');
  requireFiniteNumber(tx?.cost, 'cost');

  const res = await supabase.from('transactions').insert({
    org_id: orgId,
    project_id: tx.projectId,
    type: tx.type,
    description: tx.description,
    amount: tx.amount,
    unit: tx.unit,
    cost: tx.cost,
    category: tx.category,
    occurred_at: tx.date,
    provider: tx.provider ?? null,
    rent_end_date: tx.rentEndDate ? tx.rentEndDate : null,
  });

  if (res.error) throw res.error;
}

// -----------------------------------------------------------------------------
// Budgets
// -----------------------------------------------------------------------------

export async function loadBudgetForProject(orgId: string, projectId: string): Promise<{ indirectPct: string; lines: BudgetLine[] } | null> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(projectId, 'projectId');

  const budgetRes = await supabase
    .from('budgets')
    .select('id, indirect_pct, typology')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (budgetRes.error) throw budgetRes.error;
  if (!budgetRes.data) return null;

  const budgetId = budgetRes.data.id as string;

  const linesRes = await supabase
    .from('budget_lines')
    .select('*')
    .eq('org_id', orgId)
    .eq('budget_id', budgetId)
    .order('sort_order', { ascending: true });

  if (linesRes.error) throw linesRes.error;

  const lineRows = linesRes.data ?? [];
  const lineIds = lineRows.map((l: any) => l.id as string);

  let matsByLine = new Map<string, MaterialItem[]>();
  if (lineIds.length > 0) {
    const matsRes = await supabase
      .from('budget_line_materials')
      .select('*')
      .eq('org_id', orgId)
      .in('budget_line_id', lineIds);

    if (matsRes.error) throw matsRes.error;

    for (const m of matsRes.data ?? []) {
      const arr = matsByLine.get(m.budget_line_id) ?? [];
      arr.push({
        name: m.name,
        unit: m.unit,
        quantityPerUnit: Number(m.quantity_per_unit),
        unitPrice: Number(m.unit_price),
      });
      matsByLine.set(m.budget_line_id, arr);
    }
  }

  const lines: BudgetLine[] = lineRows.map((l: any) => ({
    id: l.id,
    projectId,
    name: l.name,
    unit: l.unit,
    quantity: Number(l.quantity),
    directCost: Number(l.direct_cost),
    materials: matsByLine.get(l.id) ?? [],
    laborCost: Number(l.labor_cost),
    equipmentCost: Number(l.equipment_cost),
  }));

  return {
    indirectPct: String(budgetRes.data.indirect_pct ?? 35),
    lines,
  };
}

export async function saveBudgetForProject(
  orgId: string,
  projectId: string,
  typology: string,
  indirectPctStr: string,
  lines: BudgetLine[]
): Promise<void> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(projectId, 'projectId');
  requireNonEmpty(typology, 'typology');
  if (!Array.isArray(lines)) throw new Error('lines inválido.');
  const indirectPct = Number.parseFloat(indirectPctStr || '0') || 0;

  const upsertBudget = await supabase
    .from('budgets')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
        typology,
        indirect_pct: indirectPct,
      },
      { onConflict: 'project_id' }
    )
    .select('id')
    .single();

  if (upsertBudget.error) throw upsertBudget.error;
  const budgetId = upsertBudget.data.id as string;

  // Delete existing lines/materials
  const existingLines = await supabase
    .from('budget_lines')
    .select('id')
    .eq('org_id', orgId)
    .eq('budget_id', budgetId);

  if (existingLines.error) throw existingLines.error;

  const existingLineIds = (existingLines.data ?? []).map((x: any) => x.id as string);
  if (existingLineIds.length > 0) {
    const delMats = await supabase
      .from('budget_line_materials')
      .delete()
      .eq('org_id', orgId)
      .in('budget_line_id', existingLineIds);
    if (delMats.error) throw delMats.error;
  }

  const delLines = await supabase
    .from('budget_lines')
    .delete()
    .eq('org_id', orgId)
    .eq('budget_id', budgetId);

  if (delLines.error) throw delLines.error;

  // Insert new lines
  const linePayload = lines.map((l, idx) => ({
    org_id: orgId,
    budget_id: budgetId,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity,
    labor_cost: l.laborCost,
    equipment_cost: l.equipmentCost,
    sort_order: idx,
  }));

  const insertedLines = await supabase
    .from('budget_lines')
    .insert(linePayload)
    .select('id, name');

  if (insertedLines.error) throw insertedLines.error;

  // Map back by order (safe because we just inserted the array)
  const inserted = insertedLines.data ?? [];
  for (let i = 0; i < inserted.length; i++) {
    const lineId = inserted[i].id as string;
    const mats = lines[i]?.materials ?? [];
    if (mats.length === 0) continue;

    const matPayload = mats.map((m) => ({
      org_id: orgId,
      budget_line_id: lineId,
      name: m.name,
      unit: m.unit,
      quantity_per_unit: m.quantityPerUnit,
      unit_price: m.unitPrice,
    }));

    const insMats = await supabase.from('budget_line_materials').insert(matPayload);
    if (insMats.error) throw insMats.error;
  }
}

// -----------------------------------------------------------------------------
// Seguimiento (Avance físico por renglón)
// Model: 1 avance editable por proyecto, con líneas identificadas por nombre.
// NOTE: Budget lines are re-inserted on save (IDs can change), so we persist by
//       line_name and merge in the UI by normalized name.
// -----------------------------------------------------------------------------

export type ProjectProgressLine = {
  name: string;
  unit: string;
  plannedQty: number;
  completedQty: number;
  notes?: string;
};

export type ProjectProgressPayload = {
  projectId: string;
  updatedAt?: string;
  lines: ProjectProgressLine[];
};

export async function loadProgressForProject(orgId: string, projectId: string): Promise<ProjectProgressPayload | null> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(projectId, 'projectId');

  const header = await supabase
    .from('project_progress')
    .select('id, updated_at')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (header.error) throw header.error;
  if (!header.data) return null;

  const progressId = header.data.id as string;

  const linesRes = await supabase
    .from('project_progress_lines')
    .select('*')
    .eq('org_id', orgId)
    .eq('progress_id', progressId)
    .order('sort_order', { ascending: true });

  if (linesRes.error) throw linesRes.error;

  const lines: ProjectProgressLine[] = (linesRes.data ?? []).map((r: any) => ({
    name: r.line_name,
    unit: r.line_unit,
    plannedQty: Number(r.planned_qty),
    completedQty: Number(r.completed_qty),
    notes: r.notes ?? undefined,
  }));

  return {
    projectId,
    updatedAt: header.data.updated_at ? String(header.data.updated_at) : undefined,
    lines,
  };
}

export async function saveProgressForProject(orgId: string, projectId: string, payload: ProjectProgressPayload): Promise<void> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(projectId, 'projectId');

  const upsert = await supabase
    .from('project_progress')
    .upsert(
      {
        org_id: orgId,
        project_id: projectId,
      },
      { onConflict: 'project_id' }
    )
    .select('id')
    .single();

  if (upsert.error) throw upsert.error;
  const progressId = upsert.data.id as string;

  const delLines = await supabase
    .from('project_progress_lines')
    .delete()
    .eq('org_id', orgId)
    .eq('progress_id', progressId);

  if (delLines.error) throw delLines.error;

  const linePayload = (payload.lines ?? []).map((l, idx) => ({
    org_id: orgId,
    progress_id: progressId,
    line_name: l.name,
    line_unit: l.unit,
    planned_qty: Number(l.plannedQty) || 0,
    completed_qty: Number(l.completedQty) || 0,
    notes: l.notes ?? null,
    sort_order: idx,
  }));

  if (linePayload.length > 0) {
    const ins = await supabase
      .from('project_progress_lines')
      .insert(linePayload);
    if (ins.error) throw ins.error;
  }
}

// -----------------------------------------------------------------------------
// Catalog: material prices + APU templates (web-import friendly)
// -----------------------------------------------------------------------------

export type MaterialPriceImportInput = {
  url: string;
  vendor: string;
  currency: string;
  sourceType?: string;
};

export type ApuTemplateImportInput = {
  url: string;
  source?: string;
  currency?: string;
};

export async function importMaterialPricesFromCsvUrl(
  orgId: string,
  input: MaterialPriceImportInput
): Promise<{ materialsUpserted: number; quotesUpserted: number }>
{
  const supabase = getSupabaseClient();
  const url = input.url?.trim();
  if (!url) throw new Error('URL de CSV requerida.');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar CSV (${res.status}).`);
  const text = await res.text();

  return await importMaterialPricesFromCsvText(orgId, {
    csvText: text,
    vendor: input.vendor,
    currency: input.currency,
    sourceType: input.sourceType ?? 'csv',
    sourceUrl: url,
  });
}

export async function importMaterialPricesFromCsvText(
  orgId: string,
  input: { csvText: string; vendor: string; currency: string; sourceType?: string; sourceUrl?: string | null }
): Promise<{ materialsUpserted: number; quotesUpserted: number }>
{
  const supabase = getSupabaseClient();
  const text = input.csvText ?? '';

  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV sin datos.');

  const headers = rows[0].map((h) => normalizeText(h));
  const colName = headers.findIndex((h) => ['name', 'material', 'descripcion', 'descripción', 'item'].includes(h));
  const colUnit = headers.findIndex((h) => ['unit', 'unidad', 'u'].includes(h));
  const colPrice = headers.findIndex((h) => ['unit_price', 'precio', 'price', 'costo', 'cost'].includes(h));
  if (colName < 0 || colPrice < 0) {
    throw new Error('CSV debe tener columnas: name (o descripcion) y unit_price (o precio).');
  }

  const vendor = (input.vendor || '').trim();
  const currency = (input.currency || '').trim() || 'GTQ';
  const sourceType = (input.sourceType || 'upload').trim();
  const sourceUrl = input.sourceUrl ?? null;

  type CsvRow = { name: string; unit: string; unitPrice: number };
  const items: CsvRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[colName] ?? '').trim();
    const unit = String(r[colUnit] ?? '').trim();
    const priceRaw = String(r[colPrice] ?? '').trim().replace(/[^0-9.\-]/g, '');
    const unitPrice = Number.parseFloat(priceRaw);
    if (!name || !Number.isFinite(unitPrice) || unitPrice < 0) continue;
    items.push({ name, unit, unitPrice });
  }

  if (items.length === 0) throw new Error('No se encontraron filas válidas en el CSV.');

  const materialKey = (nameNorm: string, unit: string) => `${nameNorm}||${unit || ''}`;
  const uniqueMaterials = new Map<string, { name: string; name_norm: string; unit: string }>();
  for (const it of items) {
    const name_norm = normalizeText(it.name);
    const key = materialKey(name_norm, it.unit);
    if (!uniqueMaterials.has(key)) {
      uniqueMaterials.set(key, { name: it.name, name_norm, unit: it.unit || '' });
    }
  }

  const upsertPayload = Array.from(uniqueMaterials.values()).map((m) => ({
    org_id: orgId,
    name: m.name,
    name_norm: m.name_norm,
    unit: m.unit,
  }));

  const upsertMaterials = await supabase
    .from('material_catalog_items')
    .upsert(upsertPayload, { onConflict: 'org_id,name_norm,unit' })
    .select('id, name_norm, unit');

  if (upsertMaterials.error) throw upsertMaterials.error;

  const idByKey = new Map<string, string>();
  for (const m of upsertMaterials.data ?? []) {
    idByKey.set(materialKey(m.name_norm, m.unit), m.id);
  }

  const today = new Date();
  const priceDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);

  const quotes = items
    .map((it) => {
      const key = materialKey(normalizeText(it.name), it.unit);
      const materialId = idByKey.get(key);
      if (!materialId) return null;
      return {
        org_id: orgId,
        material_id: materialId,
        vendor,
        currency,
        unit_price: it.unitPrice,
        price_date: priceDate,
        source_type: sourceType,
        source_url: sourceUrl,
      };
    })
    .filter(Boolean) as any[];

  if (quotes.length > 0) {
    const upsertQuotes = await supabase
      .from('material_price_quotes')
      .upsert(quotes, { onConflict: 'material_id,org_id,vendor,price_date' });
    if (upsertQuotes.error) throw upsertQuotes.error;
  }

  return {
    materialsUpserted: upsertPayload.length,
    quotesUpserted: quotes.length,
  };
}

export async function suggestLineFromApuCatalog(
  orgId: string,
  typology: string,
  lineName: string
): Promise<Partial<BudgetLine> | null> {
  const supabase = getSupabaseClient();
  const q = normalizeText(lineName);
  if (!q) return null;

  const templates = await supabase
    .from('apu_templates')
    .select('id, name, unit, labor_cost, equipment_cost, materials, name_norm')
    .eq('org_id', orgId)
    .eq('typology', typology)
    .ilike('name_norm', `%${q}%`)
    .limit(10);

  if (templates.error) throw templates.error;
  const rows = templates.data ?? [];
  if (rows.length === 0) return null;

  // Pick the closest: exact norm match > startsWith > includes > first
  const exact = rows.find((r: any) => r.name_norm === q);
  const starts = rows.find((r: any) => String(r.name_norm || '').startsWith(q));
  const picked = exact ?? starts ?? rows[0];

  const materials: MaterialItem[] = Array.isArray(picked.materials)
    ? (picked.materials as any[]).map((m) => ({
        name: String(m.name || ''),
        unit: String(m.unit || ''),
        quantityPerUnit: Number(m.quantityPerUnit ?? m.quantity_per_unit ?? 0),
        unitPrice: Number(m.unitPrice ?? m.unit_price ?? 0),
      }))
    : [];

  // Try to fill unitPrice from latest cached price quotes.
  const norms = Array.from(new Set(materials.map((m) => normalizeText(m.name)).filter(Boolean)));
  if (norms.length > 0) {
    const mats = await supabase
      .from('material_catalog_items')
      .select('id, name_norm, unit')
      .eq('org_id', orgId)
      .in('name_norm', norms);

    if (mats.error) throw mats.error;

    const materialIds = (mats.data ?? []).map((m: any) => m.id as string);
    if (materialIds.length > 0) {
      const latest = await supabase
        .from('v_material_latest_prices')
        .select('material_id, unit_price')
        .eq('org_id', orgId)
        .in('material_id', materialIds);

      if (latest.error) throw latest.error;
      const priceById = new Map<string, number>();
      for (const r of latest.data ?? []) priceById.set(r.material_id, Number(r.unit_price));

      const idByNormUnit = new Map<string, string>();
      for (const m of mats.data ?? []) {
        idByNormUnit.set(`${m.name_norm}||${m.unit || ''}`, m.id);
      }

      for (const mat of materials) {
        const key = `${normalizeText(mat.name)}||${mat.unit || ''}`;
        const id = idByNormUnit.get(key);
        if (!id) continue;
        const p = priceById.get(id);
        if (typeof p === 'number' && Number.isFinite(p) && p >= 0) mat.unitPrice = p;
      }
    }
  }

  return {
    name: picked.name,
    unit: picked.unit,
    laborCost: Number(picked.labor_cost ?? 0),
    equipmentCost: Number(picked.equipment_cost ?? 0),
    materials,
  };
}

export async function importApuTemplatesFromJsonUrl(
  orgId: string,
  input: ApuTemplateImportInput
): Promise<{ templatesUpserted: number }>
{
  const supabase = getSupabaseClient();
  const url = input.url?.trim();
  if (!url) throw new Error('URL de JSON requerida.');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar JSON (${res.status}).`);

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error('Respuesta JSON inválida.');
  }

  const arr: any[] = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('JSON sin items.');

  const payload = arr
    .map((it) => {
      const typology = String(it.typology || it.tipologia || '').trim();
      const name = String(it.name || it.nombre || '').trim();
      const unit = String(it.unit || it.unidad || 'Glb').trim();
      if (!typology || !name) return null;

      const materials = Array.isArray(it.materials) ? it.materials : [];
      const normMaterials = materials
        .map((m: any) => ({
          name: String(m.name || m.nombre || '').trim(),
          unit: String(m.unit || m.unidad || '').trim(),
          quantityPerUnit: Number(m.quantityPerUnit ?? m.quantity_per_unit ?? m.cantidad_por_unidad ?? 0),
          unitPrice: Number(m.unitPrice ?? m.unit_price ?? m.precio_unitario ?? 0),
        }))
        .filter((m: any) => m.name);

      return {
        org_id: orgId,
        typology,
        name,
        name_norm: normalizeText(name),
        unit,
        labor_cost: Number(it.laborCost ?? it.labor_cost ?? it.mano_obra ?? 0) || 0,
        equipment_cost: Number(it.equipmentCost ?? it.equipment_cost ?? it.equipo ?? 0) || 0,
        materials: normMaterials,
        meta: it.meta && typeof it.meta === 'object' ? it.meta : {},
        currency: (it.currency || input.currency || null) ? String(it.currency || input.currency) : null,
        source: (it.source || input.source || null) ? String(it.source || input.source) : null,
        source_url: it.sourceUrl ? String(it.sourceUrl) : url,
        effective_date: it.effectiveDate ? String(it.effectiveDate).slice(0, 10) : null,
        last_refreshed_at: new Date().toISOString(),
      };
    })
    .filter(Boolean) as any[];

  if (payload.length === 0) throw new Error('No se encontraron plantillas APU válidas en el JSON.');

  const upsert = await supabase
    .from('apu_templates')
    .upsert(payload, { onConflict: 'org_id,typology,name_norm' });

  if (upsert.error) throw upsert.error;
  return { templatesUpserted: payload.length };
}

export type ApuTemplateCsvImportInput = {
  url: string;
  source?: string;
  currency?: string;
};

function parseMaterialsCell(cell: string): any[] {
  const raw = String(cell || '').trim();
  if (!raw) return [];

  // Prefer JSON array in a single cell.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fallthrough
  }

  // Fallback format: name|unit|qtyPerUnit|unitPrice ; name|unit|qtyPerUnit|unitPrice
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
  const out: any[] = [];
  for (const p of parts) {
    const cols = p.split('|').map((s) => s.trim());
    if (!cols[0]) continue;
    out.push({
      name: cols[0],
      unit: cols[1] || '',
      quantityPerUnit: Number(cols[2] ?? 0) || 0,
      unitPrice: Number(cols[3] ?? 0) || 0,
    });
  }
  return out;
}

export async function importApuTemplatesFromCsvUrl(
  orgId: string,
  input: ApuTemplateCsvImportInput
): Promise<{ templatesUpserted: number }>
{
  const supabase = getSupabaseClient();
  const url = input.url?.trim();
  if (!url) throw new Error('URL de CSV requerida.');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar CSV (${res.status}).`);
  const text = await res.text();

  return await importApuTemplatesFromCsvText(orgId, {
    csvText: text,
    source: input.source,
    currency: input.currency,
    sourceUrl: url,
  });
}

export async function importApuTemplatesFromCsvText(
  orgId: string,
  input: { csvText: string; source?: string; currency?: string; sourceUrl?: string | null }
): Promise<{ templatesUpserted: number }>
{
  const supabase = getSupabaseClient();
  const text = input.csvText ?? '';

  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV sin datos.');

  const headers = rows[0].map((h) => normalizeText(h));
  const colTyp = headers.findIndex((h) => ['typology', 'tipologia', 'tipología'].includes(h));
  const colName = headers.findIndex((h) => ['name', 'renglon', 'renglón', 'descripcion', 'descripción', 'item'].includes(h));
  const colUnit = headers.findIndex((h) => ['unit', 'unidad'].includes(h));
  const colLabor = headers.findIndex((h) => ['labor_cost', 'labor', 'mano_obra', 'mo'].includes(h));
  const colEquip = headers.findIndex((h) => ['equipment_cost', 'equipment', 'equipo'].includes(h));
  const colMaterials = headers.findIndex((h) => ['materials', 'materiales'].includes(h));
  const colMeta = headers.findIndex((h) => ['meta', 'rendimientos', 'yield'].includes(h));

  if (colTyp < 0 || colName < 0) {
    throw new Error('CSV debe tener columnas: typology/tipologia y name/descripcion.');
  }

  const payload: any[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const typology = String(r[colTyp] ?? '').trim();
    const name = String(r[colName] ?? '').trim();
    if (!typology || !name) continue;

    const unit = (colUnit >= 0 ? String(r[colUnit] ?? '').trim() : '') || 'Glb';
    const laborCost = colLabor >= 0 ? Number(String(r[colLabor] ?? '').replace(/[^0-9.\-]/g, '')) || 0 : 0;
    const equipmentCost = colEquip >= 0 ? Number(String(r[colEquip] ?? '').replace(/[^0-9.\-]/g, '')) || 0 : 0;
    const materialsCell = colMaterials >= 0 ? String(r[colMaterials] ?? '') : '';
    const metaCell = colMeta >= 0 ? String(r[colMeta] ?? '') : '';

    const materialsRaw = parseMaterialsCell(materialsCell);
    const materials = materialsRaw
      .map((m: any) => ({
        name: String(m.name || m.nombre || '').trim(),
        unit: String(m.unit || m.unidad || '').trim(),
        quantityPerUnit: Number(m.quantityPerUnit ?? m.quantity_per_unit ?? m.cantidad_por_unidad ?? 0) || 0,
        unitPrice: Number(m.unitPrice ?? m.unit_price ?? m.precio_unitario ?? 0) || 0,
      }))
      .filter((m: any) => m.name);

    let meta: any = {};
    if (metaCell && metaCell.trim()) {
      try {
        const parsed = JSON.parse(metaCell);
        if (parsed && typeof parsed === 'object') meta = parsed;
      } catch {
        meta = { notes: metaCell };
      }
    }

    payload.push({
      org_id: orgId,
      typology,
      name,
      name_norm: normalizeText(name),
      unit,
      labor_cost: laborCost,
      equipment_cost: equipmentCost,
      materials,
      meta,
      currency: input.currency ? String(input.currency) : 'GTQ',
      source: input.source ? String(input.source) : null,
      source_url: input.sourceUrl ?? null,
      last_refreshed_at: new Date().toISOString(),
    });
  }

  if (payload.length === 0) throw new Error('No se encontraron filas APU válidas en el CSV.');

  const upsert = await supabase
    .from('apu_templates')
    .upsert(payload, { onConflict: 'org_id,typology,name_norm' });

  if (upsert.error) throw upsert.error;
  return { templatesUpserted: payload.length };
}

// -----------------------------------------------------------------------------
// Requisitions
// -----------------------------------------------------------------------------

export async function createRequisition(
  orgId: string,
  projectId: string,
  supplierName: string | null,
  sourceBudgetLineId: string | null,
  items: Array<{ name: string; unit: string; quantity: number }>,
  status: 'draft' | 'sent' = 'sent',
  sourceLineName?: string | null
): Promise<void> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(projectId, 'projectId');
  if (!Array.isArray(items)) throw new Error('items inválido.');
  if (status === 'sent' && items.length === 0) throw new Error('La requisición no puede enviarse sin ítems.');
  for (const it of items) {
    requireNonEmpty(it?.name, 'item.name');
    requireNonEmpty(it?.unit, 'item.unit');
    const qty = requireFiniteNumber(it?.quantity, 'item.quantity');
    if (qty <= 0) throw new Error('item.quantity debe ser mayor a 0.');
  }

  let supplierId: string | null = null;
  const supplierNameTrimmed = supplierName?.trim() ?? '';
  if (supplierNameTrimmed) {
    const existing = await supabase
      .from('suppliers')
      .select('id')
      .eq('org_id', orgId)
      .ilike('name', supplierNameTrimmed)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existing.error) throw existing.error;
    if (existing.data && existing.data.length > 0) {
      supplierId = existing.data[0].id as string;
    } else {
      const createdSupplier = await supabase
        .from('suppliers')
        .insert({ org_id: orgId, name: supplierNameTrimmed })
        .select('id')
        .single();

      if (createdSupplier.error) throw createdSupplier.error;
      supplierId = createdSupplier.data.id as string;
    }
  }

  const notesParts: string[] = [];
  if (supplierNameTrimmed) notesParts.push(`Proveedor sugerido: ${supplierNameTrimmed}`);
  if (sourceLineName && String(sourceLineName).trim()) notesParts.push(`Renglón presupuesto: ${String(sourceLineName).trim()}`);

  const req = await supabase
    .from('requisitions')
    .insert({
      org_id: orgId,
      project_id: projectId,
      supplier_id: supplierId,
      status,
      notes: notesParts.length > 0 ? notesParts.join('\n') : null,
      source_budget_line_id: sourceBudgetLineId,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (req.error) throw req.error;
  const reqId = req.data.id as string;

  if (items.length > 0) {
    const payload = items.map((it) => ({
      org_id: orgId,
      requisition_id: reqId,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
    }));

    const ins = await supabase.from('requisition_items').insert(payload);
    if (ins.error) throw ins.error;
  }
}

export async function listRequisitions(
  orgId: string
): Promise<Array<{ id: string; projectId: string | null; requestedAt: string; supplierName: string | null; supplierNote: string | null; total: number; status: string }>> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');

  const res = await supabase
    .from('v_requisition_totals')
    .select('requisition_id, project_id, requested_at, total_amount, status, supplier_name, notes')
    .eq('org_id', orgId)
    .order('requested_at', { ascending: false })
    .limit(20);

  if (res.error) throw res.error;

  return (res.data ?? []).map((r: any) => ({
    id: r.requisition_id,
    projectId: r.project_id ? String(r.project_id) : null,
    requestedAt: r.requested_at,
    supplierName: r.supplier_name ? String(r.supplier_name) : null,
    supplierNote: r.notes ? String(r.notes) : null,
    total: Number(r.total_amount ?? 0),
    status: r.status,
  }));
}

// -----------------------------------------------------------------------------
// Employees
// -----------------------------------------------------------------------------

export async function listEmployees(orgId: string) {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  const res = await supabase
    .from('employees')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (res.error) throw res.error;
  return res.data ?? [];
}

export async function createEmployee(orgId: string, input: { name: string; dpi?: string; phone?: string; position: string; dailyRate: number; projectId?: string | null }) {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(input?.name, 'name');
  requireNonEmpty(input?.position, 'position');
  requireFiniteNumber(input?.dailyRate, 'dailyRate');
  const res = await supabase
    .from('employees')
    .insert({
      org_id: orgId,
      name: input.name,
      dpi: input.dpi ?? null,
      phone: input.phone ?? null,
      position: input.position,
      daily_rate: input.dailyRate,
      status: 'active',
      project_id: input.projectId ?? null,
    })
    .select('*')
    .single();

  if (res.error) throw res.error;
  return res.data;
}

// -----------------------------------------------------------------------------
// Employee Contracts (RRHH digital contracts)
// -----------------------------------------------------------------------------

export async function listEmployeeContracts(orgId: string, limit = 30): Promise<any[]> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  const res = await supabase
    .from('employee_contracts')
    .select('*')
    .eq('org_id', orgId)
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (res.error) throw res.error;
  return res.data ?? [];
}

export async function upsertEmployeeContract(
  orgId: string,
  input: {
    requestId: string;
    status: 'sent' | 'received' | 'void';
    seed: any;
    response?: any | null;
    employeeId?: string | null;
    projectId?: string | null;
    requestedAt?: string;
    respondedAt?: string | null;
  }
): Promise<any> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(input?.requestId, 'requestId');

  const seed = input.seed ?? {};
  const requestedAt = input.requestedAt ?? seed.requestedAt ?? new Date().toISOString();
  const respondedAt = input.respondedAt ?? (input.status === 'received' ? new Date().toISOString() : null);

  const employeeName = String(seed.employeeName ?? '').trim();
  const role = String(seed.role ?? '').trim();

  const res = await supabase
    .from('employee_contracts')
    .upsert(
      {
        org_id: orgId,
        request_id: input.requestId,
        status: input.status,

        employee_id: input.employeeId ?? seed.employeeId ?? null,
        project_id: input.projectId ?? seed.projectId ?? null,

        employee_name: employeeName || 'Empleado',
        employee_phone: seed.employeePhone ? String(seed.employeePhone) : null,
        role: role || 'Puesto',
        daily_rate: typeof seed.dailyRate === 'number' ? seed.dailyRate : Number(seed.dailyRate ?? 0),

        seed,
        response: input.response ?? null,

        requested_at: requestedAt,
        responded_at: respondedAt,
      },
      { onConflict: 'org_id,request_id' }
    )
    .select('*')
    .single();

  if (res.error) throw res.error;
  return res.data;
}

// -----------------------------------------------------------------------------
// Attendance (GPS + biometric payload)
// -----------------------------------------------------------------------------

function normalizeAttendanceToken(token: unknown): string {
  const t = String(token ?? '').trim();
  if (!t) throw new Error('token requerido.');
  if (t.length < 16) throw new Error('token inválido.');
  return t;
}

function rethrowAttendanceRpcError(err: any, context: string): never {
  const msg = String(err?.message ?? err ?? '').trim();
  const lower = msg.toLowerCase();
  if (lower.includes('no autorizado') || lower.includes('not authorized') || lower.includes('permission denied')) {
    throw new Error(`${context}: no autorizado.`);
  }
  throw new Error(`${context}: ${msg || 'error desconocido.'}`);
}

export async function setEmployeeAttendanceToken(employeeId: string, token: string): Promise<void> {
  const supabase = getSupabaseClient();

  requireNonEmpty(employeeId, 'employeeId');
  const tokenTrimmed = normalizeAttendanceToken(token);

  // This RPC is admin-only; ensure we have a real JWT session.
  const sess = await supabase.auth.getSession();
  if (!sess.data.session) {
    await ensureSupabaseSession();
  }

  const res = await supabase.rpc('set_employee_attendance_token', {
    p_employee_id: employeeId,
    p_token: tokenTrimmed,
  });
  if (res.error) rethrowAttendanceRpcError(res.error, 'No se pudo asignar/rotar el token de asistencia (requiere admin)');
}

export async function submitAttendanceWithToken(input: {
  token: string;
  action: 'check_in' | 'check_out';
  workDate?: string; // yyyy-mm-dd
  lat: number;
  lng: number;
  accuracyM?: number | null;
  biometric?: any | null;
  device?: any | null;
}): Promise<any> {
  const supabase = getSupabaseClient();

  const tokenTrimmed = normalizeAttendanceToken(input?.token);
  requireNonEmpty(input?.action, 'action');
  const lat = requireFiniteNumber(input?.lat, 'lat');
  const lng = requireFiniteNumber(input?.lng, 'lng');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('Ubicación inválida.');
  if (input?.biometric == null) throw new Error('Biometría requerida.');

  const args: Record<string, any> = {
    p_token: tokenTrimmed,
    p_action: input.action,
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: input.accuracyM ?? null,
    p_biometric: input.biometric ?? null,
    p_device: input.device ?? null,
  };
  if (typeof input.workDate === 'string' && input.workDate.length > 0) {
    args.p_work_date = input.workDate;
  }
  const res = await supabase.rpc('submit_attendance_with_token', args);
  if (res.error) rethrowAttendanceRpcError(res.error, 'No se pudo registrar la asistencia');
  return res.data;
}

export async function listAttendanceForDate(orgId: string, workDate: string): Promise<any[]> {
  const supabase = getSupabaseClient();

  requireNonEmpty(orgId, 'orgId');
  requireNonEmpty(workDate, 'workDate');
  const res = await supabase
    .from('v_attendance_daily')
    .select('*')
    .eq('org_id', orgId)
    .eq('work_date', workDate)
    .order('check_in', { ascending: false });

  if (res.error) throw res.error;
  return res.data ?? [];
}

export async function getAttendanceTokenInfo(token: string): Promise<{ orgId: string; employeeId: string; employeeName: string } | null> {
  const supabase = getSupabaseClient();
  const tokenTrimmed = normalizeAttendanceToken(token);
  const res = await supabase.rpc('get_attendance_token_info', { p_token: tokenTrimmed });
  if (res.error) rethrowAttendanceRpcError(res.error, 'No se pudo consultar el token');
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row?.org_id || !row?.employee_id) return null;
  return {
    orgId: String(row.org_id),
    employeeId: String(row.employee_id),
    employeeName: String(row.employee_name ?? row.name ?? ''),
  };
}

export async function webauthnInvoke(action: string, body: any): Promise<any> {
  const supabase = getSupabaseClient();
  const res = await supabase.functions.invoke('webauthn', {
    body: { action, ...body },
  });
  if (res.error) throw res.error;
  return res.data;
}
