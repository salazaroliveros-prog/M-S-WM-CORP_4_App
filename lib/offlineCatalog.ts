export type OfflineCatalogVersion = 1;

export type OfflineMaterialPrice = {
  name: string;
  nameNorm: string;
  unit: string;
  unitPrice: number;
  vendor?: string;
  currency?: string;
  priceDate?: string; // YYYY-MM-DD
  sourceUrl?: string | null;
  updatedAt: string;
};

export type OfflineApuTemplate = {
  typology: string;
  name: string;
  nameNorm: string;
  unit: string;
  laborCost: number;
  equipmentCost: number;
  materials: Array<{ name: string; unit: string; quantityPerUnit: number; unitPrice: number }>;
  meta?: any;
  currency?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  updatedAt: string;
};

export type OfflineCatalog = {
  version: OfflineCatalogVersion;
  updatedAt: string;
  apuTemplates: OfflineApuTemplate[];
  materialPrices: OfflineMaterialPrice[];
};

const DB_NAME = 'wm_offline_catalog_db';
const DB_VERSION = 1;
const STORE = 'kv';

const KEY_CATALOG = 'wm_offline_catalog_v1';
const KEY_URL_CACHE_PREFIX = 'wm_url_cache_v1:';

let memCatalog: OfflineCatalog | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/^\s*\d+\s*[\.|\)]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function templateKey(typology: string, nameNorm: string): string {
  return `${String(typology || '').trim().toUpperCase()}||${nameNorm}`;
}

function materialKey(nameNorm: string, unit: string): string {
  return `${nameNorm}||${String(unit || '').trim()}`;
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

    if (ch === '\r') continue;
    cell += ch;
  }

  pushCell();
  if (row.length > 0) pushRow();
  return rows;
}

function parseMaterialsCell(cell: string): Array<{ name: string; unit: string; quantityPerUnit: number; unitPrice: number }> {
  const raw = String(cell || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((m: any) => ({
          name: String(m.name || m.nombre || '').trim(),
          unit: String(m.unit || m.unidad || '').trim(),
          quantityPerUnit: Number(m.quantityPerUnit ?? m.quantity_per_unit ?? m.cantidad_por_unidad ?? 0) || 0,
          unitPrice: Number(m.unitPrice ?? m.unit_price ?? m.precio_unitario ?? 0) || 0,
        }))
        .filter((m: any) => m.name);
    }
  } catch {
    // fallthrough
  }

  // Fallback format: name|unit|qtyPerUnit|unitPrice ; ...
  const parts = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const out: Array<{ name: string; unit: string; quantityPerUnit: number; unitPrice: number }> = [];
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

function getIndexedDb(): IDBFactory | null {
  return typeof indexedDB !== 'undefined' ? indexedDB : null;
}

function idbOpen(): Promise<IDBDatabase> {
  const idb = getIndexedDb();
  if (!idb) return Promise.reject(new Error('IndexedDB no disponible.'));

  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Error abriendo IndexedDB'));
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result?.value as T) ?? null);
    req.onerror = () => reject(req.error || new Error('Error leyendo IndexedDB'));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ key, value });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('Error escribiendo IndexedDB'));
  });
}

async function storageGet<T>(key: string): Promise<T | null> {
  // Prefer IndexedDB; fallback to localStorage.
  try {
    return await idbGet<T>(key);
  } catch {
    return safeJsonParse<T>(localStorage.getItem(key));
  }
}

async function storageSet<T>(key: string, value: T): Promise<void> {
  try {
    await idbSet<T>(key, value);
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }
}

export async function loadOfflineCatalog(): Promise<OfflineCatalog> {
  if (memCatalog) return memCatalog;

  const stored = await storageGet<OfflineCatalog>(KEY_CATALOG);
  if (stored && stored.version === 1 && Array.isArray(stored.apuTemplates) && Array.isArray(stored.materialPrices)) {
    memCatalog = stored;
    return stored;
  }

  const fresh: OfflineCatalog = {
    version: 1,
    updatedAt: nowIso(),
    apuTemplates: [],
    materialPrices: [],
  };
  memCatalog = fresh;
  await storageSet(KEY_CATALOG, fresh);
  return fresh;
}

export async function saveOfflineCatalog(next: OfflineCatalog): Promise<void> {
  const payload: OfflineCatalog = {
    version: 1,
    updatedAt: nowIso(),
    apuTemplates: Array.isArray(next.apuTemplates) ? next.apuTemplates : [],
    materialPrices: Array.isArray(next.materialPrices) ? next.materialPrices : [],
  };
  memCatalog = payload;
  await storageSet(KEY_CATALOG, payload);
}

export async function getCachedUrlText(url: string): Promise<string | null> {
  const key = `${KEY_URL_CACHE_PREFIX}${String(url || '').trim()}`;
  const v = await storageGet<{ text: string }>(key);
  if (!v?.text) return null;
  return String(v.text);
}

export async function setCachedUrlText(url: string, text: string): Promise<void> {
  const key = `${KEY_URL_CACHE_PREFIX}${String(url || '').trim()}`;
  await storageSet(key, { text: String(text ?? ''), savedAt: nowIso() });
}

export async function getOfflineMaterialUnitPrice(input: { name: string; unit?: string | null }): Promise<number | null> {
  const catalog = await loadOfflineCatalog();
  const name = String(input.name || '').trim();
  if (!name) return null;

  const nameNorm = normalizeText(name);
  if (!nameNorm) return null;

  const unit = String(input.unit ?? '').trim();
  if (unit) {
    const key = materialKey(nameNorm, unit);
    const exact = catalog.materialPrices.find((p) => materialKey(p.nameNorm, p.unit) === key);
    const price = exact?.unitPrice;
    return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
  }

  // If unit is unknown, pick the most recently updated entry for that name.
  let best: OfflineMaterialPrice | null = null;
  for (const p of catalog.materialPrices) {
    if (p.nameNorm !== nameNorm) continue;
    if (!best) {
      best = p;
      continue;
    }
    if (String(p.updatedAt || '') > String(best.updatedAt || '')) best = p;
  }
  const price = best?.unitPrice;
  return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
}

export async function upsertMaterialPricesFromCsvText(input: {
  csvText: string;
  vendor?: string;
  currency?: string;
  sourceUrl?: string | null;
}): Promise<{ itemsUpserted: number }>
{
  const catalog = await loadOfflineCatalog();
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
  const updatedAt = nowIso();

  const idx = new Map<string, OfflineMaterialPrice>();
  for (const mp of catalog.materialPrices) idx.set(materialKey(mp.nameNorm, mp.unit), mp);

  let upserted = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[colName] ?? '').trim();
    const unit = String(r[colUnit] ?? '').trim();
    const priceRaw = String(r[colPrice] ?? '').trim().replace(/[^0-9.\-]/g, '');
    const unitPrice = Number.parseFloat(priceRaw);
    if (!name || !Number.isFinite(unitPrice) || unitPrice < 0) continue;

    const nameNorm = normalizeText(name);
    if (!nameNorm) continue;

    idx.set(materialKey(nameNorm, unit), {
      name,
      nameNorm,
      unit,
      unitPrice,
      vendor: vendor || undefined,
      currency,
      sourceUrl: input.sourceUrl ?? null,
      updatedAt,
    });
    upserted++;
  }

  const next: OfflineCatalog = {
    ...catalog,
    materialPrices: Array.from(idx.values()),
  };
  await saveOfflineCatalog(next);

  return { itemsUpserted: upserted };
}

export async function upsertApuTemplatesFromCsvText(input: {
  csvText: string;
  source?: string;
  currency?: string;
  sourceUrl?: string | null;
}): Promise<{ templatesUpserted: number }>
{
  const catalog = await loadOfflineCatalog();
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

  const updatedAt = nowIso();
  const currency = (input.currency || 'GTQ').trim();
  const source = input.source?.trim() || null;

  const idx = new Map<string, OfflineApuTemplate>();
  for (const t of catalog.apuTemplates) idx.set(templateKey(t.typology, t.nameNorm), t);

  let upserted = 0;
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

    let meta: any = {};
    if (metaCell && metaCell.trim()) {
      try {
        const parsed = JSON.parse(metaCell);
        if (parsed && typeof parsed === 'object') meta = parsed;
      } catch {
        meta = { notes: metaCell };
      }
    }

    const materials = parseMaterialsCell(materialsCell);
    const nameNorm = normalizeText(name);

    idx.set(templateKey(typology, nameNorm), {
      typology,
      name,
      nameNorm,
      unit,
      laborCost,
      equipmentCost,
      materials,
      meta,
      currency,
      source,
      sourceUrl: input.sourceUrl ?? null,
      updatedAt,
    });
    upserted++;
  }

  const next: OfflineCatalog = {
    ...catalog,
    apuTemplates: Array.from(idx.values()),
  };
  await saveOfflineCatalog(next);

  return { templatesUpserted: upserted };
}

export async function upsertApuTemplatesFromJsonText(input: {
  jsonText: string;
  source?: string;
  currency?: string;
  sourceUrl?: string | null;
}): Promise<{ templatesUpserted: number }>
{
  const catalog = await loadOfflineCatalog();
  const updatedAt = nowIso();

  let data: any;
  try {
    data = JSON.parse(input.jsonText ?? '');
  } catch {
    throw new Error('JSON inválido.');
  }

  const arr: any[] = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('JSON sin items.');

  const idx = new Map<string, OfflineApuTemplate>();
  for (const t of catalog.apuTemplates) idx.set(templateKey(t.typology, t.nameNorm), t);

  let upserted = 0;
  for (const it of arr) {
    const typology = String(it.typology || it.tipologia || '').trim();
    const name = String(it.name || it.nombre || '').trim();
    const unit = String(it.unit || it.unidad || 'Glb').trim();
    if (!typology || !name) continue;

    const materialsRaw = Array.isArray(it.materials) ? it.materials : [];
    const materials = materialsRaw
      .map((m: any) => ({
        name: String(m.name || m.nombre || '').trim(),
        unit: String(m.unit || m.unidad || '').trim(),
        quantityPerUnit: Number(m.quantityPerUnit ?? m.quantity_per_unit ?? m.cantidad_por_unidad ?? 0) || 0,
        unitPrice: Number(m.unitPrice ?? m.unit_price ?? m.precio_unitario ?? 0) || 0,
      }))
      .filter((m: any) => m.name);

    const nameNorm = normalizeText(name);
    idx.set(templateKey(typology, nameNorm), {
      typology,
      name,
      nameNorm,
      unit,
      laborCost: Number(it.laborCost ?? it.labor_cost ?? it.mano_obra ?? 0) || 0,
      equipmentCost: Number(it.equipmentCost ?? it.equipment_cost ?? it.equipo ?? 0) || 0,
      materials,
      meta: it.meta && typeof it.meta === 'object' ? it.meta : {},
      currency: (it.currency || input.currency || null) ? String(it.currency || input.currency) : null,
      source: (it.source || input.source || null) ? String(it.source || input.source) : null,
      sourceUrl: it.sourceUrl ? String(it.sourceUrl) : (input.sourceUrl ?? null),
      updatedAt,
    });
    upserted++;
  }

  const next: OfflineCatalog = {
    ...catalog,
    apuTemplates: Array.from(idx.values()),
  };
  await saveOfflineCatalog(next);

  return { templatesUpserted: upserted };
}

export async function suggestLineFromOfflineCatalog(input: {
  typology: string;
  lineName: string;
}): Promise<
  | {
      unit?: string;
      laborCost?: number;
      equipmentCost?: number;
      materials?: Array<{ name: string; unit: string; quantityPerUnit: number; unitPrice: number }>;
      source: 'offline';
    }
  | null
> {
  const catalog = await loadOfflineCatalog();
  const typology = String(input.typology || '').trim();
  const q = normalizeText(input.lineName);
  if (!typology || !q) return null;

  const templates = catalog.apuTemplates.filter((t) => String(t.typology || '').trim() === typology);
  if (templates.length === 0) return null;

  const exact = templates.find((t) => t.nameNorm === q);
  const starts = templates.find((t) => t.nameNorm.startsWith(q));
  const includes = templates.find((t) => t.nameNorm.includes(q) || q.includes(t.nameNorm));
  const picked = exact ?? starts ?? includes;
  if (!picked) return null;

  const prices = new Map<string, OfflineMaterialPrice>();
  for (const p of catalog.materialPrices) prices.set(materialKey(p.nameNorm, p.unit), p);

  const materials = (picked.materials || []).map((m) => {
    const key = materialKey(normalizeText(m.name), m.unit);
    const p = prices.get(key);
    const unitPrice = typeof p?.unitPrice === 'number' && Number.isFinite(p.unitPrice) && p.unitPrice >= 0 ? p.unitPrice : (Number(m.unitPrice) || 0);
    return {
      name: String(m.name || '').trim(),
      unit: String(m.unit || '').trim(),
      quantityPerUnit: Number(m.quantityPerUnit) || 0,
      unitPrice,
    };
  });

  return {
    unit: picked.unit,
    laborCost: picked.laborCost,
    equipmentCost: picked.equipmentCost,
    materials,
    source: 'offline',
  };
}
