export type ViewState = 'WELCOME' | 'DASHBOARD' | 'INICIO' | 'PROYECTOS' | 'PRESUPUESTOS' | 'SEGUIMIENTO' | 'COMPRAS' | 'RRHH' | 'COTIZADOR' | 'DIAGNOSTICO';

export interface Project {
  id: string;
  name: string;
  clientName: string;
  location: string;
  lot?: string;
  block?: string;
  coordinates?: string; // GPS Coordinates (Lat, Lng)
  areaLand: number;
  areaBuild: number;
  needs: string; // Programa de necesidades
  status: 'standby' | 'active' | 'completed';
  startDate: string;
  typology: Typology;
  projectManager: string;
}

export type Typology = 'RESIDENCIAL' | 'COMERCIAL' | 'INDUSTRIAL' | 'CIVIL' | 'PUBLICA';

export type RoofType =
  | 'LOSA_SOLIDA'
  | 'LOSA_PREFABRICADA'
  | 'ESTRUCTURA_METALICA'
  | 'PERGOLA_MADERA'
  | 'PERGOLA_METAL';

export interface Transaction {
  id: string;
  projectId: string;
  type: 'INGRESO' | 'GASTO';
  description: string;
  amount: number;
  unit: string;
  cost: number;
  category: string;
  date: string;
  provider?: string;
  rentEndDate?: string;
}

export interface BudgetLine {
  id: string;
  projectId?: string;
  name: string;
  unit: string;
  quantity: number;
  directCost: number; // calculated from materials + labor
  materials: MaterialItem[];
  laborCost: number;
  equipmentCost: number;
}

export interface MaterialItem {
  name: string;
  unit: string;
  quantityPerUnit: number;
  unitPrice: number;
}

export interface Employee {
  id: string;
  name: string;
  dpi: string;
  phone: string;
  position: 'Supervisor' | 'Encargado' | 'Maestro' | 'Albañil' | 'Ayudante' | 'Peón';
  dailyRate: number;
  status: 'active' | 'inactive';
  projectId?: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut?: string;
  locationLat: number;
  locationLng: number;
}

export interface QuoteItem {
  service: string;
  unitCost: number;
  quantity: number;
}

export interface RequisitionItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface RequisitionData {
  projectId: string;
  sourceLineName?: string;
  sourceBudgetLineId?: string;
  items: RequisitionItem[];
}

export interface QuoteInitialData {
  clientName: string;
  address: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  projectId?: string | null;
  actorUserId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  tableName: string;
  recordId?: string | null;
  oldSnapshot?: any;
  newSnapshot?: any;
  createdAt: string;
}