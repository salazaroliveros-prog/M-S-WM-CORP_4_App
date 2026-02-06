export type IsoDate = `${number}-${number}-${number}`;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function toIsoDateKey(d: Date): IsoDate {
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${year}-${month}-${day}` as IsoDate;
}

export function parseIsoDateOnly(input: string): Date | null {
  const s = String(input || '').trim();
  if (!s) return null;
  // Accept either YYYY-MM-DD or full ISO; always normalize to local date.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(y, mo - 1, da);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Gregorian computus (Meeus/Jones/Butcher) for Easter Sunday.
export function easterSunday(year: number): Date {
  const y = Math.trunc(year);
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

// Guatemala-ish fixed holidays + Holy Thursday/Good Friday.
// This is a pragmatic default for construction scheduling.
export function guatemalaHolidays(year: number): Set<IsoDate> {
  const y = Math.trunc(year);
  const set = new Set<IsoDate>();
  const fixed: Array<[number, number]> = [
    [1, 1], // Año nuevo
    [5, 1], // Día del trabajo
    [6, 30], // Ejército
    [9, 15], // Independencia
    [10, 20], // Revolución
    [11, 1], // Todos los Santos
    [12, 24],
    [12, 25],
    [12, 31],
  ];
  for (const [m, d] of fixed) {
    set.add(`${y}-${pad2(m)}-${pad2(d)}` as IsoDate);
  }

  const easter = easterSunday(y);
  // Semana Santa: Jueves Santo (-3) y Viernes Santo (-2)
  set.add(toIsoDateKey(addDays(easter, -3)));
  set.add(toIsoDateKey(addDays(easter, -2)));

  return set;
}

export type WorkCalendar = {
  holidays: Set<IsoDate>;
  workDays: Set<number>; // 0=Sun..6=Sat
};

export function defaultWorkCalendarForYears(years: number[]): WorkCalendar {
  const holidays = new Set<IsoDate>();
  const unique = Array.from(new Set(years.map((y) => Math.trunc(y)).filter(Boolean)));
  for (const y of unique) {
    for (const k of guatemalaHolidays(y)) holidays.add(k);
  }
  // Construction default: Mon-Sat work, Sunday off.
  const workDays = new Set<number>([1, 2, 3, 4, 5, 6]);
  return { holidays, workDays };
}

export function isWorkingDay(d: Date, cal: WorkCalendar): boolean {
  const dow = d.getDay();
  if (!cal.workDays.has(dow)) return false;
  return !cal.holidays.has(toIsoDateKey(d));
}

export function nextWorkingDay(d: Date, cal: WorkCalendar): Date {
  let cur = new Date(d);
  let guard = 0;
  while (!isWorkingDay(cur, cal)) {
    cur = addDays(cur, 1);
    guard++;
    if (guard > 370) break;
  }
  return cur;
}

// Adds N working days, where n=1 means same day if it's working.
export function addWorkingDaysInclusive(start: Date, workingDays: number, cal: WorkCalendar): Date {
  const n = Math.max(1, Math.trunc(workingDays || 1));
  let cur = nextWorkingDay(start, cal);
  let count = 1;
  let guard = 0;
  while (count < n) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur, cal)) count++;
    guard++;
    if (guard > 20000) break;
  }
  return cur;
}

export function workingDaysBetweenInclusive(start: Date, end: Date, cal: WorkCalendar): number {
  const a = new Date(start);
  const b = new Date(end);
  if (b.getTime() < a.getTime()) return 0;
  let cur = new Date(a);
  let count = 0;
  let guard = 0;
  while (cur.getTime() <= b.getTime()) {
    if (isWorkingDay(cur, cal)) count++;
    cur = addDays(cur, 1);
    guard++;
    if (guard > 20000) break;
  }
  return count;
}
