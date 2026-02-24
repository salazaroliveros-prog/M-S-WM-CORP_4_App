export type CpmTaskInput = {
  key: string;
  durationDays: number; // working days, >= 1
  deps: string[]; // predecessor task keys
};

export type CpmTaskResult = {
  key: string;
  es: number; // earliest start offset (0-based working day index)
  ef: number; // earliest finish offset (inclusive)
  ls: number; // latest start offset
  lf: number; // latest finish offset (inclusive)
  slackDays: number;
  isCritical: boolean;
};

export type CpmResult = {
  projectEnd: number; // max EF (inclusive)
  tasks: Map<string, CpmTaskResult>;
  hasCycle: boolean;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function computeCpm(tasks: CpmTaskInput[]): CpmResult {
  const byKey = new Map<string, CpmTaskInput>();
  for (const t of tasks) {
    if (!t?.key) continue;
    const durationDays = Math.max(1, Math.trunc(Number(t.durationDays) || 1));
    byKey.set(String(t.key), { key: String(t.key), durationDays, deps: uniq((t.deps ?? []).map(String)).filter(Boolean) });
  }

  const keys = Array.from(byKey.keys());
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const indeg = new Map<string, number>();

  for (const k of keys) {
    preds.set(k, []);
    succs.set(k, []);
    indeg.set(k, 0);
  }

  for (const k of keys) {
    const t = byKey.get(k)!;
    const deps = (t.deps ?? []).filter((d) => byKey.has(d) && d !== k);
    preds.set(k, deps);
    for (const d of deps) {
      const arr = succs.get(d) ?? [];
      arr.push(k);
      succs.set(d, arr);
    }
  }

  for (const k of keys) {
    indeg.set(k, (preds.get(k) ?? []).length);
  }

  // Kahn topological sort
  const q: string[] = [];
  for (const k of keys) {
    if ((indeg.get(k) ?? 0) === 0) q.push(k);
  }

  const topo: string[] = [];
  while (q.length) {
    const n = q.shift()!;
    topo.push(n);
    for (const s of succs.get(n) ?? []) {
      const v = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, v);
      if (v === 0) q.push(s);
    }
  }

  const hasCycle = topo.length !== keys.length;
  if (hasCycle) {
    // Fallback order: preserve input order for any missing nodes.
    const inTopo = new Set(topo);
    for (const t of tasks) {
      const k = String(t?.key ?? '');
      if (k && byKey.has(k) && !inTopo.has(k)) topo.push(k);
    }
  }

  // Forward pass
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const k of topo) {
    const t = byKey.get(k)!;
    const predList = preds.get(k) ?? [];
    let bestEs = 0;
    for (const p of predList) {
      const pEf = ef.get(p);
      if (typeof pEf === 'number') bestEs = Math.max(bestEs, pEf + 1);
    }
    const dur = Math.max(1, Math.trunc(t.durationDays));
    es.set(k, bestEs);
    ef.set(k, bestEs + dur - 1);
  }

  let projectEnd = 0;
  for (const k of keys) {
    projectEnd = Math.max(projectEnd, ef.get(k) ?? 0);
  }

  // Backward pass
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (let i = topo.length - 1; i >= 0; i--) {
    const k = topo[i];
    const t = byKey.get(k)!;
    const succList = succs.get(k) ?? [];

    let bestLf: number | null = null;
    for (const s of succList) {
      const sLs = ls.get(s);
      if (typeof sLs === 'number') {
        const candidate = sLs - 1;
        bestLf = bestLf == null ? candidate : Math.min(bestLf, candidate);
      }
    }

    const dur = Math.max(1, Math.trunc(t.durationDays));
    const lfVal = bestLf == null ? projectEnd : bestLf;
    const lsVal = lfVal - dur + 1;
    lf.set(k, lfVal);
    ls.set(k, lsVal);
  }

  const out = new Map<string, CpmTaskResult>();
  for (const k of keys) {
    const t = byKey.get(k)!;
    const esVal = es.get(k) ?? 0;
    const efVal = ef.get(k) ?? (esVal + Math.max(1, t.durationDays) - 1);
    const lsVal = ls.get(k) ?? esVal;
    const lfVal = lf.get(k) ?? efVal;
    const slackDays = Math.max(0, lsVal - esVal);
    out.set(k, {
      key: k,
      es: esVal,
      ef: efVal,
      ls: lsVal,
      lf: lfVal,
      slackDays,
      isCritical: slackDays === 0,
    });
  }

  return { projectEnd, tasks: out, hasCycle };
}
