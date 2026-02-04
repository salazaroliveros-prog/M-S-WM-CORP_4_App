import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Project, BudgetLine, Typology, MaterialItem, RequisitionData } from '../types';
import { DEFAULT_BUDGET_LINES, calculateAPU } from '../constants';
import { Printer, Save, RefreshCw, Upload, Download, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Plus, Trash2, Calculator, ShoppingCart, ArrowRight, X, List } from 'lucide-react';

interface Props {
  projects: Project[];
  initialProjectId?: string;
  onQuickBuy?: (data: RequisitionData) => void;
  onLoadBudget?: (projectId: string) => Promise<{ indirectPct: string; lines: BudgetLine[] } | null>;
  onSaveBudget?: (projectId: string, typology: string, indirectPct: string, lines: BudgetLine[]) => Promise<void>;
  onImportMaterialPrices?: (input: { url: string; vendor: string; currency: string }) => Promise<{ materialsUpserted: number; quotesUpserted: number }>;
  onImportMaterialPricesText?: (input: { csvText: string; vendor: string; currency: string }) => Promise<{ materialsUpserted: number; quotesUpserted: number }>;
  onSuggestLineFromCatalog?: (typology: string, lineName: string) => Promise<Partial<BudgetLine> | null>;
  onImportApuTemplates?: (input: { url: string; source?: string; currency?: string }) => Promise<{ templatesUpserted: number }>;
  onImportApuTemplatesCsv?: (input: { url: string; source?: string; currency?: string }) => Promise<{ templatesUpserted: number }>;
  onImportApuTemplatesCsvText?: (input: { csvText: string; source?: string; currency?: string }) => Promise<{ templatesUpserted: number }>;
}

const Presupuestos: React.FC<Props> = ({ projects, initialProjectId, onQuickBuy, onLoadBudget, onSaveBudget, onImportMaterialPrices, onImportMaterialPricesText, onSuggestLineFromCatalog, onImportApuTemplates, onImportApuTemplatesCsv, onImportApuTemplatesCsvText }) => {
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || '');
  const [typology, setTypology] = useState<Typology | ''>('');
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [reportLine, setReportLine] = useState<BudgetLine | null>(null); // State for the report modal
  const [indirectCostPercentageStr, setIndirectCostPercentageStr] = useState<string>("35"); // Default to 35% as string for better input handling
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customLineOpen, setCustomLineOpen] = useState(false);
  const [customLineName, setCustomLineName] = useState('');
  const [customLineUnit, setCustomLineUnit] = useState('Glb');
  const [customLineAutoFill, setCustomLineAutoFill] = useState(true);
  const [customLineUseCloudCatalog, setCustomLineUseCloudCatalog] = useState(true);

  const [priceImportOpen, setPriceImportOpen] = useState(false);
  const [priceImportUrl, setPriceImportUrl] = useState('');
  const [priceImportVendor, setPriceImportVendor] = useState('');
  const [priceImportCurrency, setPriceImportCurrency] = useState('GTQ');
  const [priceImportMode, setPriceImportMode] = useState<'file' | 'url'>('file');
  const [priceImportFile, setPriceImportFile] = useState<File | null>(null);

  const [apuImportOpen, setApuImportOpen] = useState(false);
  const [apuImportUrl, setApuImportUrl] = useState('');
  const [apuImportSource, setApuImportSource] = useState('');
  const [apuImportCurrency, setApuImportCurrency] = useState('GTQ');
  const [apuImportFormat, setApuImportFormat] = useState<'json' | 'csv'>('csv');
  const [apuImportMode, setApuImportMode] = useState<'file' | 'url'>('file');
  const [apuImportFile, setApuImportFile] = useState<File | null>(null);

  const toPublicGoogleSheetsCsvUrl = (u: string): string => {
    const url = (u || '').trim();
    if (!url) return url;
    if (!url.includes('docs.google.com/spreadsheets')) return url;

    // Common publish pattern already
    if (url.includes('output=csv')) return url;

    // Convert /edit#gid=... to /export?format=csv&gid=...
    const gidMatch = url.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : null;
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const id = idMatch ? idMatch[1] : null;
    if (!id) return url;

    const base = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
    return gid ? `${base}&gid=${gid}` : base;
  };

  const loadImportPrefs = () => {
    try {
      const raw = localStorage.getItem('wm_import_prefs_v1');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p?.priceUrl) setPriceImportUrl(String(p.priceUrl));
      if (p?.priceVendor) setPriceImportVendor(String(p.priceVendor));
      if (p?.priceCurrency) setPriceImportCurrency(String(p.priceCurrency));
      if (p?.apuUrl) setApuImportUrl(String(p.apuUrl));
      if (p?.apuSource) setApuImportSource(String(p.apuSource));
      if (p?.apuCurrency) setApuImportCurrency(String(p.apuCurrency));
      if (p?.apuFormat === 'json' || p?.apuFormat === 'csv') setApuImportFormat(p.apuFormat);
    } catch {
      // ignore
    }
  };

  const saveImportPrefs = (patch: any) => {
    try {
      const raw = localStorage.getItem('wm_import_prefs_v1');
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem('wm_import_prefs_v1', JSON.stringify({ ...prev, ...patch }));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadImportPrefs();
  }, []);
  
  // Sync if prop changes
  useEffect(() => {
    if (initialProjectId) {
        setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId]);

  // Handler for project selection auto-setting typology and resetting lines if new project
  useEffect(() => {
    const project = projects.find(p => p.id === selectedProjectId);
    if (project) {
      if (project.typology !== typology) {
          setBudgetLines([]); // Reset lines when typology changes
      }
      setTypology(project.typology);
    } else {
        setTypology('');
        setBudgetLines([]);
    }
  }, [selectedProjectId, projects]);

  // Load saved budget from DB (Supabase) when handler provided
  useEffect(() => {
    if (!onLoadBudget) return;
    if (!selectedProjectId) return;

    let cancelled = false;
    (async () => {
      try {
        const loaded = await onLoadBudget(selectedProjectId);
        if (cancelled) return;
        if (loaded) {
          setBudgetLines(loaded.lines);
          setIndirectCostPercentageStr(loaded.indirectPct);
          setImportStatus({ type: 'info', message: 'Presupuesto cargado desde Supabase.' });
        }
      } catch (e: any) {
        if (cancelled) return;
        setImportStatus({ type: 'error', message: e?.message || 'Error cargando presupuesto' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onLoadBudget, selectedProjectId]);

  const handleSaveBudget = async () => {
    if (!onSaveBudget) {
      setImportStatus({ type: 'info', message: 'Guardado no configurado.' });
      return;
    }
    if (!selectedProjectId || !typology) {
      setImportStatus({ type: 'error', message: 'Seleccione un proyecto para guardar.' });
      return;
    }

    try {
      await onSaveBudget(selectedProjectId, String(typology), indirectCostPercentageStr, budgetLines);
      setImportStatus({ type: 'success', message: 'Presupuesto guardado en Supabase.' });
      if (onLoadBudget) {
        const loaded = await onLoadBudget(selectedProjectId);
        if (loaded) {
          setBudgetLines(loaded.lines);
          setIndirectCostPercentageStr(loaded.indirectPct);
        }
      }
    } catch (e: any) {
      setImportStatus({ type: 'error', message: e?.message || 'Error guardando presupuesto' });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLineId(expandedLineId === id ? null : id);
  };

  // Helper to calculate the total cost of a line based on current inputs
  const calculateLineTotal = (line: BudgetLine) => {
    // 1. Calculate total cost of materials per unit
    const matCost = line.materials.reduce((sum, m) => sum + (m.quantityPerUnit * m.unitPrice), 0);
    // 2. Calculate Unit Direct Cost (Materials + Labor + Equipment)
    const unitDirectCost = matCost + line.laborCost + line.equipmentCost;
    // 3. Return Total Line Cost
    return unitDirectCost * line.quantity;
  };

  const handleAddNextLine = () => {
    if (!typology || !DEFAULT_BUDGET_LINES[typology]) return;

    const masterList = DEFAULT_BUDGET_LINES[typology];
    const nextIndex = budgetLines.length;

    if (nextIndex >= masterList.length) {
        setImportStatus({ type: 'info', message: 'Se han agregado todos los renglones disponibles para esta tipología.' });
        return;
    }

    const nextItem = masterList[nextIndex];
    if (nextItem) {
        const newLine: BudgetLine = {
            id: `line-${Date.now()}-${nextIndex}`,
            projectId: selectedProjectId,
            name: nextItem.name || 'Renglón sin nombre',
            unit: nextItem.unit || 'Glb',
            quantity: 0, // User inputs this
            directCost: 0,
            laborCost: nextItem.laborCost || 0,
            equipmentCost: nextItem.equipmentCost || 0,
            materials: nextItem.materials ? [...nextItem.materials] : []
        };
        setBudgetLines(prev => [...prev, newLine]);
        setImportStatus(null);
        // Automatically expand the new line for data entry
        setExpandedLineId(newLine.id);
    }
  };

  const normalizeLineName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/^\s*\d+\s*[\.|\)]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const suggestFromCatalog = (name: string, t: Typology) => {
    const catalog = DEFAULT_BUDGET_LINES[t] ?? [];
    const q = normalizeLineName(name);
    if (!q) return null;

    let best: { item: any; score: number } | null = null;
    for (const item of catalog) {
      const target = normalizeLineName(String(item.name ?? ''));
      if (!target) continue;
      let score = 0;
      if (target === q) score += 100;
      if (target.includes(q) || q.includes(target)) score += 50;

      const words = q.split(' ').filter(Boolean);
      for (const w of words) {
        if (w.length <= 2) continue;
        if (target.includes(w)) score += 5;
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (!best || best.score < 10) return null;
    return best.item as Partial<BudgetLine>;
  };

  const saveCustomTemplateLocal = (t: Typology, line: BudgetLine) => {
    try {
      const key = `wm_custom_line_templates_${t}`;
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as any[];
      const template = {
        name: line.name,
        unit: line.unit,
        laborCost: line.laborCost,
        equipmentCost: line.equipmentCost,
        materials: line.materials,
        savedAt: new Date().toISOString(),
      };
      const next = [template, ...existing].slice(0, 50);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleAddCustomLine = () => {
    if (!selectedProjectId || !typology) {
      setImportStatus({ type: 'error', message: 'Seleccione un proyecto para agregar renglones.' });
      return;
    }
    setCustomLineName('');
    setCustomLineUnit('Glb');
    setCustomLineAutoFill(true);
    setCustomLineUseCloudCatalog(true);
    setCustomLineOpen(true);
  };

  const confirmAddCustomLine = async () => {
    if (!selectedProjectId || !typology) return;
    if (!customLineName.trim()) {
      setImportStatus({ type: 'error', message: 'Ingrese el nombre del renglón.' });
      return;
    }

    let base: any = {};
    let usedCloud = false;
    if (customLineAutoFill && customLineUseCloudCatalog && onSuggestLineFromCatalog) {
      try {
        const cloud = await onSuggestLineFromCatalog(String(typology), customLineName);
        if (cloud) {
          base = cloud;
          usedCloud = true;
        }
      } catch (e: any) {
        setImportStatus({ type: 'error', message: e?.message || 'Error consultando catálogo (Supabase)' });
      }
    }

    if (!usedCloud) {
      const suggestion = customLineAutoFill ? suggestFromCatalog(customLineName, typology as Typology) : null;
      base = suggestion ?? {};
    }

    const newLine: BudgetLine = {
      id: `custom-${Date.now()}`,
      projectId: selectedProjectId,
      name: customLineName.trim(),
      unit: (customLineUnit || base.unit || 'Glb') as string,
      quantity: 0,
      directCost: 0,
      laborCost: Number((base as any).laborCost ?? 0),
      equipmentCost: Number((base as any).equipmentCost ?? 0),
      materials: (base as any).materials ? [...((base as any).materials as MaterialItem[])] : [],
    };

    // Pre-calculate like other lines
    newLine.directCost = calculateLineTotal(newLine);

    setBudgetLines((prev) => [...prev, newLine]);
    setExpandedLineId(newLine.id);
    setCustomLineOpen(false);
    setImportStatus({ type: 'success', message: usedCloud ? 'Renglón agregado con parámetros del catálogo (Supabase).' : (customLineAutoFill ? 'Renglón agregado con parámetros sugeridos del catálogo interno.' : 'Renglón agregado.') });

    saveCustomTemplateLocal(typology as Typology, newLine);
  };

  const openPriceImport = () => {
    // keep last used (loaded from localStorage)
    setPriceImportMode('file');
    setPriceImportFile(null);
    setPriceImportOpen(true);
  };

  const openApuImport = () => {
    // keep last used (loaded from localStorage)
    setApuImportMode('file');
    setApuImportFile(null);
    setApuImportOpen(true);
  };

  const confirmPriceImport = async () => {
    try {
      const vendor = priceImportVendor.trim();
      const currency = (priceImportCurrency || 'GTQ').trim();

      if (priceImportMode === 'file') {
        if (!onImportMaterialPricesText) {
          setImportStatus({ type: 'info', message: 'Importación por archivo no configurada (requiere Supabase).' });
          setPriceImportOpen(false);
          return;
        }
        if (!priceImportFile) {
          setImportStatus({ type: 'error', message: 'Seleccione un archivo CSV.' });
          return;
        }
        const csvText = await priceImportFile.text();
        const r = await onImportMaterialPricesText({ csvText, vendor, currency });
        setImportStatus({ type: 'success', message: `Catálogo actualizado. Materiales: ${r.materialsUpserted}, Precios: ${r.quotesUpserted}.` });
        saveImportPrefs({ priceVendor: vendor, priceCurrency: currency });
        setPriceImportOpen(false);
        return;
      }

      if (!onImportMaterialPrices) {
        setImportStatus({ type: 'info', message: 'Importación por URL no configurada (requiere Supabase).' });
        setPriceImportOpen(false);
        return;
      }
      if (!priceImportUrl.trim()) {
        setImportStatus({ type: 'error', message: 'Ingrese una URL de CSV.' });
        return;
      }
      const normalized = toPublicGoogleSheetsCsvUrl(priceImportUrl.trim());
      const r = await onImportMaterialPrices({ url: normalized, vendor, currency });
      setImportStatus({ type: 'success', message: `Catálogo actualizado. Materiales: ${r.materialsUpserted}, Precios: ${r.quotesUpserted}.` });
      saveImportPrefs({ priceUrl: normalized, priceVendor: vendor, priceCurrency: currency });
      setPriceImportOpen(false);
    } catch (e: any) {
      setImportStatus({ type: 'error', message: e?.message || 'Error importando lista de precios' });
    }
  };

  const confirmApuImport = async () => {
    try {
      const currency = (apuImportCurrency || 'GTQ').trim();
      const source = apuImportSource.trim() || undefined;

      if (apuImportMode === 'file') {
        if (apuImportFormat !== 'csv') {
          setImportStatus({ type: 'error', message: 'En modo archivo solo soportamos CSV por ahora.' });
          return;
        }
        if (!onImportApuTemplatesCsvText) {
          setImportStatus({ type: 'info', message: 'Importación APU por archivo no configurada (requiere Supabase).' });
          setApuImportOpen(false);
          return;
        }
        if (!apuImportFile) {
          setImportStatus({ type: 'error', message: 'Seleccione un archivo CSV.' });
          return;
        }
        const csvText = await apuImportFile.text();
        const r = await onImportApuTemplatesCsvText({ csvText, source, currency });
        setImportStatus({ type: 'success', message: `APUs actualizados. Plantillas: ${r.templatesUpserted}.` });
        saveImportPrefs({ apuSource: apuImportSource.trim(), apuCurrency: currency, apuFormat: apuImportFormat });
        setApuImportOpen(false);
        return;
      }

      const handler = apuImportFormat === 'json' ? onImportApuTemplates : onImportApuTemplatesCsv;
      if (!handler) {
        setImportStatus({ type: 'info', message: 'Importación APU no configurada (requiere Supabase).' });
        setApuImportOpen(false);
        return;
      }
      if (!apuImportUrl.trim()) {
        setImportStatus({ type: 'error', message: `Ingrese una URL de ${apuImportFormat.toUpperCase()}.` });
        return;
      }

      const normalized = apuImportFormat === 'csv' ? toPublicGoogleSheetsCsvUrl(apuImportUrl.trim()) : apuImportUrl.trim();
      const r = await handler({ url: normalized, source, currency });
      setImportStatus({ type: 'success', message: `APUs actualizados. Plantillas: ${r.templatesUpserted}.` });
      saveImportPrefs({ apuUrl: normalized, apuSource: apuImportSource.trim(), apuCurrency: (apuImportCurrency || 'GTQ').trim(), apuFormat: apuImportFormat });
      setApuImportOpen(false);
    } catch (e: any) {
      setImportStatus({ type: 'error', message: e?.message || 'Error importando APUs' });
    }
  };

  // Helper to prevent negative inputs
  const preventNegativeInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
      e.preventDefault();
    }
  };

  const handleQuantityChange = (id: string, qty: number) => {
    const validatedQty = isNaN(qty) ? 0 : Math.max(0, qty);
    setBudgetLines(prev => prev.map(line => {
      if (line.id === id) {
        const updatedLine = { ...line, quantity: validatedQty };
        return {
          ...updatedLine,
          directCost: calculateLineTotal(updatedLine)
        };
      }
      return line;
    }));
  };

  const handleMaterialChange = (lineId: string, index: number, field: keyof MaterialItem, value: any) => {
    let validatedValue = value;
    
    // Strict numeric validation for cost/quantity fields
    if (field === 'quantityPerUnit' || field === 'unitPrice') {
        const parsed = parseFloat(value);
        // Default to 0 if NaN (empty string) or ensure positive if number
        validatedValue = isNaN(parsed) ? 0 : Math.max(0, parsed);
    }

    setBudgetLines(prev => prev.map(line => {
      if (line.id === lineId) {
        // Create new materials array
        const newMaterials = [...line.materials];
        // Update specific material field
        newMaterials[index] = { ...newMaterials[index], [field]: validatedValue };
        
        const updatedLine = { ...line, materials: newMaterials };
        // Recalculate the TOTAL line cost based on updated material costs
        const newDirectCost = calculateLineTotal(updatedLine);

        return {
          ...updatedLine,
          directCost: newDirectCost
        };
      }
      return line;
    }));
  };

  const handleAddMaterial = (lineId: string) => {
    setBudgetLines(prev => prev.map(line => {
      if (line.id === lineId) {
        // Create new empty material for easier data entry
        const newMaterial: MaterialItem = { name: '', unit: '', quantityPerUnit: 0, unitPrice: 0 };
        const updatedLine = { ...line, materials: [...line.materials, newMaterial] };
        return {
          ...updatedLine,
          directCost: calculateLineTotal(updatedLine)
        };
      }
      return line;
    }));
  };

  const handleRemoveMaterial = (lineId: string, index: number) => {
    setBudgetLines(prev => prev.map(line => {
      if (line.id === lineId) {
        const newMaterials = [...line.materials];
        newMaterials.splice(index, 1);
        const updatedLine = { ...line, materials: newMaterials };
        return {
          ...updatedLine,
          directCost: calculateLineTotal(updatedLine)
        };
      }
      return line;
    }));
  };

  const handleUpdateLineCost = (lineId: string, field: 'laborCost' | 'equipmentCost', value: number) => {
    const validatedValue = isNaN(value) ? 0 : Math.max(0, value);
    setBudgetLines(prev => prev.map(line => {
      if (line.id === lineId) {
        const updatedLine = { ...line, [field]: validatedValue };
        return {
          ...updatedLine,
          directCost: calculateLineTotal(updatedLine)
        };
      }
      return line;
    }));
  };

  // CSV Export
  const handleExportCSV = () => {
    if (budgetLines.length === 0) return;
    
    const headers = ['Renglon', 'Unidad', 'Cantidad', 'CostoDirecto'];
    const rows = budgetLines.map(line => 
      `"${line.name}","${line.unit}",${line.quantity},${line.directCost.toFixed(2)}`
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `presupuesto_${typology}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // CSV Import and Validation
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processImportContent(content);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const processImportContent = (content: string) => {
    try {
      const lines = content.split('\n').filter(line => line.trim() !== '');
      if (lines.length < 2) {
        setImportStatus({ type: 'error', message: 'El archivo está vacío o no contiene datos.' });
        return;
      }

      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
      const requiredColumns = ['renglon', 'cantidad'];
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));

      if (missingColumns.length > 0) {
        setImportStatus({ 
          type: 'error', 
          message: `Formato inválido. Faltan columnas requeridas: ${missingColumns.join(', ')}. Estándar: Renglon, Unidad, Cantidad` 
        });
        return;
      }

      const renglonIndex = headers.indexOf('renglon');
      const cantidadIndex = headers.indexOf('cantidad');
      const unidadIndex = headers.indexOf('unidad');

      const newLines: BudgetLine[] = [];
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        if (cols.length < headers.length) continue;

        const name = cols[renglonIndex];
        const qty = parseFloat(cols[cantidadIndex]);
        const unit = unidadIndex !== -1 ? cols[unidadIndex] : 'Glb';

        if (isNaN(qty)) {
          errorCount++;
          continue;
        }

        newLines.push({
          id: `imported-${Date.now()}-${i}`,
          projectId: selectedProjectId || 'temp-import-placeholder',
          name: name,
          unit: unit,
          quantity: qty,
          directCost: qty * 100,
          materials: [],
          laborCost: 0,
          equipmentCost: 0
        });
      }

      if (newLines.length > 0) {
        setBudgetLines(prev => [...prev, ...newLines]);
        setImportStatus({ 
          type: 'success', 
          message: `Importación exitosa. ${newLines.length} renglones procesados. ${errorCount > 0 ? `${errorCount} filas ignoradas por errores de datos.` : ''}` 
        });
      } else {
         setImportStatus({ type: 'info', message: 'No se encontraron filas válidas para importar.' });
      }

    } catch (error) {
      setImportStatus({ type: 'error', message: 'Error crítico al procesar el archivo. Verifique el formato CSV/TXT.' });
    }
  };

  const handleQuickBuyClick = (line: BudgetLine) => {
    if (!onQuickBuy) return;
    if (!selectedProjectId) {
        alert("Seleccione un proyecto primero.");
        return;
    }
    
    // Calculate total quantities needed: Line Quantity * Material per Unit
    const requisitionItems = line.materials.map(m => ({
        name: m.name,
        unit: m.unit,
        quantity: parseFloat((m.quantityPerUnit * line.quantity).toFixed(2))
    }));

    const data: RequisitionData = {
        projectId: selectedProjectId,
        sourceLineName: line.name,
      sourceBudgetLineId: line.id,
        items: requisitionItems
    };

    onQuickBuy(data);
  };

  const handleDeleteLine = (id: string) => {
      setBudgetLines(prev => prev.filter(l => l.id !== id));
  };

  // Recalculate totals automatically when lines change
  const totalDirectCost = useMemo(() => 
    budgetLines.reduce((sum, line) => sum + line.directCost, 0), 
  [budgetLines]);

  // Recalculate APU automatically when Direct Cost OR Indirect Percentage changes
  const { indirectCost, priceNoTax, tax, finalPrice } = useMemo(() => {
    const percentage = parseFloat(indirectCostPercentageStr) || 0;
    return calculateAPU(totalDirectCost, percentage / 100);
  }, [totalDirectCost, indirectCostPercentageStr]);

  // Determine next line name for button label
  const nextLineName = typology && DEFAULT_BUDGET_LINES[typology] && budgetLines.length < DEFAULT_BUDGET_LINES[typology].length 
    ? DEFAULT_BUDGET_LINES[typology][budgetLines.length].name 
    : null;

  return (
    <div className="space-y-6 relative">
      {/* APU Import Modal */}
      {apuImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="bg-navy-900 text-white p-4 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Actualizar APUs desde Web (JSON)</h3>
                <p className="text-xs text-gray-300">Importa plantillas APU (con rendimientos/meta) desde una URL y las guarda en Supabase.</p>
              </div>
              <button onClick={() => setApuImportOpen(false)} className="text-gray-200 hover:text-white" aria-label="Cerrar" title="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-700">Formato</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setApuImportFormat('csv')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${apuImportFormat === 'csv' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                    title="Ideal para Google Sheets"
                  >
                    CSV
                  </button>
                  <button
                    onClick={() => setApuImportFormat('json')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${apuImportFormat === 'json' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                    title="Para catálogos JSON versionados"
                  >
                    JSON
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-700">Modo</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setApuImportMode('file')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${apuImportMode === 'file' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    Archivo
                  </button>
                  <button
                    onClick={() => setApuImportMode('url')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${apuImportMode === 'url' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    URL
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del {apuImportFormat.toUpperCase()}</label>
                {apuImportMode === 'url' ? (
                  <input
                    className="w-full p-3 border rounded"
                    value={apuImportUrl}
                    onChange={(e) => setApuImportUrl(e.target.value)}
                    placeholder={apuImportFormat === 'csv' ? 'https://.../apus.csv' : 'https://.../apus.json'}
                  />
                ) : (
                  <input
                    type="file"
                    accept={apuImportFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'}
                    className="w-full p-3 border rounded"
                    onChange={(e) => setApuImportFile(e.target.files?.[0] || null)}
                    aria-label="Subir archivo APU"
                  />
                )}
                <div className="text-xs text-gray-500 mt-1">
                  {apuImportFormat === 'json'
                    ? <>JSON recomendado: arreglo de objetos con <span className="font-mono">typology</span>, <span className="font-mono">name</span>, <span className="font-mono">unit</span>, <span className="font-mono">laborCost</span>, <span className="font-mono">equipmentCost</span>, <span className="font-mono">materials[]</span>, <span className="font-mono">meta</span>.</>
                    : <>CSV requerido: columnas <span className="font-mono">typology</span>, <span className="font-mono">name</span>. Opcional: <span className="font-mono">unit</span>, <span className="font-mono">labor_cost</span>, <span className="font-mono">equipment_cost</span>, <span className="font-mono">materials</span>, <span className="font-mono">meta</span>. En <span className="font-mono">materials</span> puede usar JSON o formato <span className="font-mono">Nombre|Unidad|QtyPerUnit|UnitPrice; ...</span>.</>
                  }
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fuente</label>
                  <input
                    className="w-full p-3 border rounded"
                    value={apuImportSource}
                    onChange={(e) => setApuImportSource(e.target.value)}
                    placeholder="Ej: Base APU 2026"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
                  <input
                    className="w-full p-3 border rounded"
                    value={apuImportCurrency}
                    onChange={(e) => setApuImportCurrency(e.target.value)}
                    placeholder="GTQ"
                  />
                </div>
                <div className="flex items-end">
                  <div className="text-xs text-gray-500">
                    Tip: publique un JSON versionado en GitHub Pages o un storage propio.
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Seguridad: importación explícita desde URL. No hacemos scraping automático.
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
              <button onClick={() => setApuImportOpen(false)} className="px-4 py-2 bg-white border border-gray-300 rounded font-bold hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={confirmApuImport} className="px-4 py-2 bg-mustard-500 hover:bg-mustard-600 text-navy-900 rounded font-bold">
                Importar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Import Modal */}
      {priceImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
            <div className="bg-navy-900 text-white p-4 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Actualizar Precios desde Web (CSV)</h3>
                <p className="text-xs text-gray-300">Importa una lista de precios desde una URL pública y la guarda en Supabase.</p>
              </div>
              <button onClick={() => setPriceImportOpen(false)} className="text-gray-200 hover:text-white" aria-label="Cerrar" title="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-700">Modo</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPriceImportMode('file')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${priceImportMode === 'file' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    Archivo
                  </button>
                  <button
                    onClick={() => setPriceImportMode('url')}
                    className={`px-3 py-1 rounded font-bold text-xs border ${priceImportMode === 'url' ? 'bg-mustard-500 border-mustard-600 text-navy-900' : 'bg-white border-gray-300 text-gray-700'}`}
                  >
                    URL
                  </button>
                </div>
              </div>
              <div>
                {priceImportMode === 'url' ? (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-1">URL del CSV</label>
                    <input
                      className="w-full p-3 border rounded"
                      value={priceImportUrl}
                      onChange={(e) => setPriceImportUrl(e.target.value)}
                      placeholder="https://.../precios.csv"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Archivo CSV</label>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="w-full p-3 border rounded"
                      onChange={(e) => setPriceImportFile(e.target.files?.[0] || null)}
                      aria-label="Subir CSV de precios"
                    />
                    <div className="text-xs text-gray-500 mt-1">Use la plantilla en la carpeta <span className="font-mono">templates/</span>.</div>
                  </>
                )}
                <div className="text-xs text-gray-500 mt-1">
                  Columnas requeridas: <span className="font-mono">name</span> (o <span className="font-mono">descripcion</span>), <span className="font-mono">unit_price</span> (o <span className="font-mono">precio</span>). Opcional: <span className="font-mono">unit</span>.
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
                  <input
                    className="w-full p-3 border rounded"
                    value={priceImportVendor}
                    onChange={(e) => setPriceImportVendor(e.target.value)}
                    placeholder="Ej: Ferretería X"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
                  <input
                    className="w-full p-3 border rounded"
                    value={priceImportCurrency}
                    onChange={(e) => setPriceImportCurrency(e.target.value)}
                    placeholder="GTQ"
                  />
                </div>
                <div className="flex items-end">
                  <div className="text-xs text-gray-500">
                    Sugerencia: use una Google Sheet publicada como CSV para mantener precios actuales.
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-500">
                Seguridad: no hacemos scraping de sitios. Solo importamos desde una URL que usted decida (o APIs oficiales con permiso).
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
              <button onClick={() => setPriceImportOpen(false)} className="px-4 py-2 bg-white border border-gray-300 rounded font-bold hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={confirmPriceImport} className="px-4 py-2 bg-mustard-500 hover:bg-mustard-600 text-navy-900 rounded font-bold">
                Importar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Line Modal */}
      {customLineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="bg-navy-900 text-white p-4 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">Agregar Renglón Personalizado</h3>
                <p className="text-xs text-gray-300">Se guardará como plantilla local para reutilizar.</p>
              </div>
              <button onClick={() => setCustomLineOpen(false)} className="text-gray-200 hover:text-white" aria-label="Cerrar" title="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del renglón</label>
                <input
                  className="w-full p-3 border rounded"
                  value={customLineName}
                  onChange={(e) => setCustomLineName(e.target.value)}
                  placeholder="Ej: Drenaje pluvial adicional"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unidad</label>
                  <input
                    className="w-full p-3 border rounded"
                    value={customLineUnit}
                    onChange={(e) => setCustomLineUnit(e.target.value)}
                    placeholder="Ej: m2, ml, m3"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={customLineAutoFill}
                      onChange={(e) => setCustomLineAutoFill(e.target.checked)}
                    />
                    Sugerir parámetros desde catálogo interno
                  </label>
                </div>
              </div>
              {onSuggestLineFromCatalog && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={customLineUseCloudCatalog}
                    onChange={(e) => setCustomLineUseCloudCatalog(e.target.checked)}
                  />
                  Intentar autocompletar desde catálogo Supabase (APU + precios cacheados)
                </label>
              )}
              <div className="text-xs text-gray-500">
                Nota: para precios actuales, use "Actualizar Precios desde Web" y luego active el catálogo Supabase.
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
              <button onClick={() => setCustomLineOpen(false)} className="px-4 py-2 bg-white border border-gray-300 rounded font-bold hover:bg-gray-100">
                Cancelar
              </button>
              <button onClick={confirmAddCustomLine} className="px-4 py-2 bg-mustard-500 hover:bg-mustard-600 text-navy-900 rounded font-bold">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Material Report Modal */}
      {reportLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="bg-navy-900 text-white p-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <List size={20} className="text-mustard-500" />
                  Reporte Detallado de Materiales
                </h3>
                <p className="text-sm text-gray-300">
                  {reportLine.name} — Cantidad: {reportLine.quantity} {reportLine.unit}
                </p>
              </div>
              <button onClick={() => setReportLine(null)} className="text-gray-400 hover:text-white transition-colors" aria-label="Cerrar" title="Cerrar">
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow">
              <div className="bg-mustard-50 border-l-4 border-mustard-500 p-4 mb-6 rounded-r-lg">
                <p className="text-sm text-navy-900">
                  Este reporte muestra el desglose total de materiales requeridos para la ejecución completa de este renglón, 
                  calculado en base a la cantidad total del renglón ingresada en el presupuesto.
                </p>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead className="bg-gray-100 text-gray-700 uppercase font-bold text-xs sticky top-0">
                  <tr>
                    <th className="p-3 text-left border-b">Material</th>
                    <th className="p-3 text-center border-b">Unidad</th>
                    <th className="p-3 text-right border-b">Cant. Unitaria</th>
                    <th className="p-3 text-right border-b bg-yellow-50 text-yellow-900">Total Requerido</th>
                    <th className="p-3 text-right border-b">Precio Unit.</th>
                    <th className="p-3 text-right border-b">Costo Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {reportLine.materials.map((mat, idx) => {
                    const totalQty = mat.quantityPerUnit * reportLine.quantity;
                    const totalCost = totalQty * mat.unitPrice;
                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="p-3 font-medium text-navy-900">{mat.name}</td>
                        <td className="p-3 text-center text-gray-500">{mat.unit}</td>
                        <td className="p-3 text-right">{mat.quantityPerUnit.toFixed(4)}</td>
                        <td className="p-3 text-right font-bold bg-yellow-50 text-yellow-900">{totalQty.toFixed(2)}</td>
                        <td className="p-3 text-right">Q{mat.unitPrice.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-gray-800">Q{totalCost.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                  {reportLine.materials.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400 italic">No hay materiales registrados.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-300">
                   <tr>
                     <td colSpan={5} className="p-3 text-right text-gray-700">COSTO TOTAL MATERIALES:</td>
                     <td className="p-3 text-right text-navy-900 text-lg">
                       Q{reportLine.materials.reduce((acc, m) => acc + (m.quantityPerUnit * reportLine.quantity * m.unitPrice), 0).toFixed(2)}
                     </td>
                   </tr>
                </tfoot>
              </table>
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button 
                onClick={() => window.print()}
                className="px-4 py-2 bg-white border border-gray-300 rounded shadow-sm text-gray-700 font-bold hover:bg-gray-100 flex items-center gap-2"
              >
                <Printer size={16} />
                Imprimir
              </button>
              <button 
                onClick={() => setReportLine(null)}
                className="px-4 py-2 bg-navy-900 text-white rounded shadow-sm font-bold hover:bg-navy-800"
              >
                Cerrar Reporte
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="presupuestos-project" className="block text-sm font-medium text-gray-700 mb-1">Proyecto a Presupuestar</label>
            <select 
              id="presupuestos-project"
              className="w-full p-2 border rounded"
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
            >
              <option value="">Seleccione...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="presupuestos-typology" className="block text-sm font-medium text-gray-700 mb-1">Tipología (Automática)</label>
            <input 
              id="presupuestos-typology"
              className="w-full p-2 border rounded bg-gray-100" 
              value={typology} 
              readOnly 
            />
          </div>
        </div>
      </div>

      {selectedProjectId && typology && (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="p-4 bg-navy-900 text-white flex justify-between items-center flex-wrap gap-2">
            <h3 className="font-bold">Renglones de Trabajo - {typology}</h3>
            <div className="flex space-x-2">
               <input 
                 type="file" 
                 accept=".csv,.txt" 
                 ref={fileInputRef} 
                 aria-label="Importar archivo CSV"
                 className="hidden" 
                 onChange={handleFileChange}
               />
               <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center space-x-1 bg-mustard-600 text-navy-900 px-3 py-1 rounded text-xs font-bold hover:bg-mustard-500"
               >
                 <Upload size={14} />
                 <span>Importar CSV</span>
               </button>
               <button 
                onClick={handleExportCSV}
                className="flex items-center space-x-1 bg-white/10 text-white px-3 py-1 rounded text-xs font-bold hover:bg-white/20"
               >
                 <Download size={14} />
                 <span>Exportar</span>
               </button>
               <button
                onClick={openPriceImport}
                className="flex items-center space-x-1 bg-emerald-400 text-navy-900 px-3 py-1 rounded text-xs font-bold hover:bg-emerald-300"
                title="Importar lista de precios desde una URL (requiere Supabase)"
               >
                 <RefreshCw size={14} />
                 <span>Actualizar Precios Web</span>
               </button>
               <button
                onClick={openApuImport}
                className="flex items-center space-x-1 bg-sky-400 text-navy-900 px-3 py-1 rounded text-xs font-bold hover:bg-sky-300"
                title="Importar catálogo APU desde una URL JSON (requiere Supabase)"
               >
                 <List size={14} />
                 <span>Actualizar APUs Web</span>
               </button>
            </div>
          </div>
          
          {importStatus && (
            <div className={`p-3 text-sm flex items-center space-x-2 ${
              importStatus.type === 'error' ? 'bg-red-100 text-red-800' : 
              importStatus.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
            }`}>
              {importStatus.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle size={16} />}
              <span>{importStatus.message}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 text-gray-700 font-bold uppercase">
                <tr>
                  <th className="p-4 w-10"></th>
                  <th className="p-4">Renglón</th>
                  <th className="p-4">Unidad</th>
                  <th className="p-4 w-32">Cantidad</th>
                  <th className="p-4 text-right">Costo Directo Unit.</th>
                  <th className="p-4 text-right">Subtotal (CD)</th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {budgetLines.length === 0 && (
                   <tr>
                       <td colSpan={7} className="p-8 text-center text-gray-500">
                           <p className="mb-2">No hay renglones agregados aún.</p>
                           <p className="text-xs">Utilice el botón "Agregar Siguiente Renglón" para comenzar a presupuestar cronológicamente.</p>
                       </td>
                   </tr>
                )}
                {budgetLines.map(line => {
                  // Automatic Calculation of Unit Direct Cost
                  const matCost = line.materials.reduce((sum, m) => sum + (m.quantityPerUnit * m.unitPrice), 0);
                  const unitDirectCost = matCost + line.laborCost + line.equipmentCost;
                  const isExpanded = expandedLineId === line.id;

                  return (
                    <React.Fragment key={line.id}>
                      <tr className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-blue-50' : ''}`}>
                        <td className="p-4">
                            <button 
                                onClick={() => toggleExpand(line.id)}
                                className="text-gray-500 hover:text-navy-900 focus:outline-none"
                            >
                                {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                            </button>
                        </td>
                        <td className="p-4 font-medium text-navy-900">{line.name}</td>
                        <td className="p-4 text-gray-500">{line.unit}</td>
                        <td className="p-4">
                          <input 
                            type="number" 
                            min="0"
                            onKeyDown={preventNegativeInput}
                            className="w-full p-2 border border-mustard-200 rounded focus:ring-mustard-500 focus:border-mustard-500"
                            value={line.quantity || ''}
                            onChange={(e) => handleQuantityChange(line.id, parseFloat(e.target.value) || 0)}
                            placeholder="Ingrese Cantidad"
                          />
                        </td>
                        <td className="p-4 text-right font-mono text-gray-600">Q{unitDirectCost.toFixed(2)}</td>
                        <td className="p-4 text-right font-bold text-gray-800 font-mono">Q{line.directCost.toFixed(2)}</td>
                        <td className="p-4 text-center">
                            <button 
                              onClick={() => handleDeleteLine(line.id)}
                              className="text-gray-400 hover:text-red-500"
                              title="Eliminar Renglón"
                            >
                                <Trash2 size={16} />
                            </button>
                        </td>
                      </tr>
                      {/* Expanded Section for Materials and APU Details */}
                      {isExpanded && (
                          <tr className="bg-gray-50 animate-fade-in">
                              <td colSpan={7} className="p-4 border-b border-gray-200">
                                  <div className="bg-white rounded border border-gray-200 p-4 shadow-inner">
                                      <h4 className="font-bold text-sm text-mustard-600 mb-3 uppercase tracking-wide flex items-center gap-2">
                                          <Calculator size={16} />
                                          Análisis de Precio Unitario (APU) - Calculado automáticamente base a cantidad: {line.quantity} {line.unit}
                                      </h4>
                                      
                                      {/* APU Main Inputs */}
                                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 pb-4 border-b border-gray-100">
                                          {/* MATERIAL CARD */}
                                          <div className="flex flex-col p-3 bg-gray-50 rounded border border-gray-200">
                                              <span className="text-xs font-bold text-gray-500 mb-1">MATERIALES (Unitario)</span>
                                              <div className="flex items-center justify-between mb-2">
                                                  <span className="font-mono text-gray-400">Q</span>
                                                  <span className="font-bold text-lg text-gray-700">{matCost.toFixed(2)}</span>
                                              </div>
                                              <div className="border-t pt-2 border-gray-200 flex justify-between items-center text-xs">
                                                  <span className="text-gray-500">Total Renglón:</span>
                                                  <span className="font-bold text-gray-800">Q{(matCost * line.quantity).toFixed(2)}</span>
                                              </div>
                                          </div>
                                          
                                          {/* LABOR CARD */}
                                          <div className="flex flex-col p-3 bg-blue-50 rounded border border-blue-200">
                                              <span className="text-xs font-bold text-blue-800 mb-1">MANO DE OBRA (Unitario)</span>
                                              <div className="flex items-center mb-2">
                                                  <span className="font-mono text-blue-800 mr-1">Q</span>
                                                  <input 
                                                      type="number" 
                                                      min="0"
                                                      onKeyDown={preventNegativeInput}
                                                      className="w-full bg-white border border-blue-300 rounded px-2 py-1 text-right font-bold text-blue-900 focus:ring-2 focus:ring-blue-400 outline-none"
                                                      aria-label={`Mano de obra unitario para ${line.name}`}
                                                      value={line.laborCost}
                                                      onChange={(e) => handleUpdateLineCost(line.id, 'laborCost', parseFloat(e.target.value) || 0)}
                                                  />
                                              </div>
                                              <div className="border-t pt-2 border-blue-200 flex justify-between items-center text-xs">
                                                  <span className="text-blue-700">Total Renglón:</span>
                                                  <span className="font-bold text-blue-900">Q{(line.laborCost * line.quantity).toFixed(2)}</span>
                                              </div>
                                          </div>

                                          {/* EQUIPMENT CARD */}
                                          <div className="flex flex-col p-3 bg-orange-50 rounded border border-orange-200">
                                              <span className="text-xs font-bold text-orange-800 mb-1">MAQUINARIA (Unitario)</span>
                                              <div className="flex items-center mb-2">
                                                  <span className="font-mono text-orange-800 mr-1">Q</span>
                                                  <input 
                                                      type="number" 
                                                      min="0"
                                                      onKeyDown={preventNegativeInput}
                                                      className="w-full bg-white border border-orange-300 rounded px-2 py-1 text-right font-bold text-orange-900 focus:ring-2 focus:ring-orange-400 outline-none"
                                                      aria-label={`Maquinaria unitario para ${line.name}`}
                                                      value={line.equipmentCost}
                                                      onChange={(e) => handleUpdateLineCost(line.id, 'equipmentCost', parseFloat(e.target.value) || 0)}
                                                  />
                                              </div>
                                              <div className="border-t pt-2 border-orange-200 flex justify-between items-center text-xs">
                                                  <span className="text-orange-700">Total Renglón:</span>
                                                  <span className="font-bold text-orange-900">Q{(line.equipmentCost * line.quantity).toFixed(2)}</span>
                                              </div>
                                          </div>

                                          {/* TOTAL CARD */}
                                          <div className="flex flex-col p-3 bg-mustard-50 rounded border border-mustard-200 relative">
                                              <div className="absolute -top-3 right-2 bg-mustard-500 text-navy-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                  UNITARIO
                                              </div>
                                              <span className="text-xs font-bold text-mustard-800 mb-1">COSTO DIRECTO UNITARIO</span>
                                              <div className="flex items-center mb-2">
                                                  <span className="font-mono text-mustard-800 mr-1">Q</span>
                                                  <input 
                                                      type="number" 
                                                      readOnly
                                                      className="w-full bg-transparent border-none text-right font-bold text-navy-900 focus:ring-0 outline-none cursor-default"
                                                      aria-label={`Costo directo unitario para ${line.name}`}
                                                      value={unitDirectCost.toFixed(2)}
                                                  />
                                              </div>
                                              <div className="border-t pt-2 border-mustard-200 flex justify-between items-center text-xs">
                                                  <span className="text-mustard-700">Total Directo Renglón:</span>
                                                  <span className="font-bold text-navy-900">Q{line.directCost.toFixed(2)}</span>
                                              </div>
                                              <span className="text-[9px] text-gray-500 mt-1 text-center italic">Calculado autom.</span>
                                          </div>
                                      </div>

                                      {/* Materials Table */}
                                      <div className="mb-2 flex justify-between items-end">
                                        <label className="text-xs font-bold text-gray-500 uppercase">Desglose de Materiales</label>
                                        <button 
                                            onClick={() => handleAddMaterial(line.id)}
                                            className="text-xs flex items-center space-x-1 bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 transition"
                                        >
                                            <Plus size={14} /> <span>Agregar Material</span>
                                        </button>
                                      </div>
                                      
                                      <table className="w-full text-xs border border-gray-200 rounded overflow-hidden">
                                          <thead className="bg-gray-100 text-gray-600 font-semibold">
                                              <tr>
                                                  <th className="p-2 text-left">Descripción Material</th>
                                                  <th className="p-2 text-left w-24">Unidad</th>
                                                  <th className="p-2 text-right w-24">Cant/Unit</th>
                                                  <th className="p-2 text-right w-28 bg-blue-50 text-blue-800" title="Cantidad x Cantidad Renglón">Cant. Total Requerida</th>
                                                  <th className="p-2 text-right w-28">Precio Unit.</th>
                                                  <th className="p-2 text-right w-28">Subtotal (U)</th>
                                                  <th className="p-2 text-right w-28 bg-yellow-50 text-yellow-800">Costo Total Material</th>
                                                  <th className="p-2 w-10"></th>
                                              </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100">
                                              {line.materials.length === 0 && (
                                                  <tr>
                                                      <td colSpan={8} className="p-4 text-center text-gray-400 italic bg-gray-50">No hay materiales registrados para este renglón.</td>
                                                  </tr>
                                              )}
                                              {line.materials.map((mat, idx) => (
                                                  <tr key={`${line.id}-mat-${idx}`} className="hover:bg-gray-50">
                                                      <td className="p-2">
                                                          <input 
                                                            className="w-full p-1 border border-gray-300 rounded focus:border-blue-400 outline-none bg-white"
                                                            value={mat.name}
                                                            onChange={(e) => handleMaterialChange(line.id, idx, 'name', e.target.value)}
                                                            placeholder="Nombre del material"
                                                          />
                                                      </td>
                                                      <td className="p-2">
                                                          <input 
                                                            className="w-full p-1 border border-gray-300 rounded focus:border-blue-400 outline-none bg-white"
                                                            value={mat.unit}
                                                            onChange={(e) => handleMaterialChange(line.id, idx, 'unit', e.target.value)}
                                                            placeholder="Unidad"
                                                          />
                                                      </td>
                                                      <td className="p-2">
                                                          <input 
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            onKeyDown={preventNegativeInput}
                                                            className="w-full p-1 border border-gray-300 rounded text-right focus:border-blue-400 outline-none bg-white"
                                                            aria-label={`Cantidad por unidad de ${mat.name || 'material'}`}
                                                            value={mat.quantityPerUnit}
                                                            onChange={(e) => handleMaterialChange(line.id, idx, 'quantityPerUnit', e.target.value)}
                                                          />
                                                      </td>
                                                      {/* AUTOMATIC TOTAL QUANTITY CALCULATION */}
                                                      <td className="p-2 text-right font-bold text-blue-900 bg-blue-50">
                                                          {(mat.quantityPerUnit * line.quantity).toFixed(2)}
                                                      </td>
                                                      <td className="p-2">
                                                          <input 
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            onKeyDown={preventNegativeInput}
                                                            className="w-full p-1 border border-gray-300 rounded text-right focus:border-blue-400 outline-none bg-white"
                                                            aria-label={`Precio unitario de ${mat.name || 'material'}`}
                                                            value={mat.unitPrice}
                                                            onChange={(e) => handleMaterialChange(line.id, idx, 'unitPrice', e.target.value)}
                                                          />
                                                      </td>
                                                      <td className="p-2 text-right font-mono text-gray-700 bg-gray-50">
                                                          Q{(mat.quantityPerUnit * mat.unitPrice).toFixed(2)}
                                                      </td>
                                                      {/* AUTOMATIC TOTAL COST CALCULATION */}
                                                      <td className="p-2 text-right font-bold text-yellow-900 bg-yellow-50">
                                                          Q{((mat.quantityPerUnit * mat.unitPrice) * line.quantity).toFixed(2)}
                                                      </td>
                                                      <td className="p-2 text-center">
                                                          <button 
                                                            onClick={() => handleRemoveMaterial(line.id, idx)}
                                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                                            title="Eliminar material"
                                                          >
                                                              <Trash2 size={14} />
                                                          </button>
                                                      </td>
                                                  </tr>
                                              ))}
                                          </tbody>
                                          <tfoot className="bg-gray-50">
                                              <tr>
                                                  <td colSpan={8} className="p-2 flex gap-2">
                                                      <button 
                                                          onClick={() => handleAddMaterial(line.id)}
                                                          className="flex-1 flex items-center justify-center space-x-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-mustard-500 hover:text-mustard-600 hover:bg-mustard-50 transition-colors text-xs font-bold"
                                                      >
                                                          <Plus size={16} />
                                                          <span>Añadir Nuevo Material</span>
                                                      </button>
                                                      
                                                      {/* View Report Button */}
                                                      <button 
                                                          onClick={() => setReportLine(line)}
                                                          className="flex-1 flex items-center justify-center space-x-2 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-xs font-bold"
                                                      >
                                                          <List size={16} />
                                                          <span>Ver Reporte Materiales</span>
                                                      </button>

                                                      {line.materials.length > 0 && line.quantity > 0 && (
                                                          <button 
                                                            onClick={() => handleQuickBuyClick(line)}
                                                            className="flex-1 flex items-center justify-center space-x-2 py-2 bg-navy-900 text-white rounded-lg hover:bg-navy-800 transition-colors text-xs font-bold shadow-sm"
                                                            title="Enviar lista de materiales a Compras con cantidades totales calculadas"
                                                          >
                                                            <ShoppingCart size={16} />
                                                            <span>Compra Rápida ({line.materials.length} items)</span>
                                                            <ArrowRight size={14} />
                                                          </button>
                                                      )}
                                                  </td>
                                              </tr>
                                              {line.materials.length > 0 && (
                                                  <tr>
                                                      <td colSpan={5} className="p-2 text-right font-bold text-gray-500 text-xs">TOTAL MATERIALES (UNITARIO):</td>
                                                      <td className="p-2 text-right font-bold text-gray-800 font-mono text-xs">
                                                          Q{line.materials.reduce((sum, m) => sum + (m.quantityPerUnit * m.unitPrice), 0).toFixed(2)}
                                                      </td>
                                                      <td className="p-2 text-right font-bold text-mustard-600 font-mono text-xs">
                                                          Q{((line.materials.reduce((sum, m) => sum + (m.quantityPerUnit * m.unitPrice), 0)) * line.quantity).toFixed(2)}
                                                      </td>
                                                      <td></td>
                                                  </tr>
                                              )}
                                          </tfoot>
                                      </table>
                                  </div>
                              </td>
                          </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                
                {/* Footer Row with Add Next Line Button */}
                {nextLineName && (
                  <tr>
                    <td colSpan={7} className="p-4 bg-gray-50 border-t border-dashed border-gray-300">
                      <button 
                        onClick={handleAddNextLine}
                        className="w-full flex items-center justify-center space-x-2 py-3 bg-white border border-gray-300 shadow-sm rounded-lg hover:bg-mustard-50 hover:border-mustard-500 hover:text-mustard-700 transition-all font-bold text-gray-600"
                      >
                         <div className="bg-mustard-500 text-white rounded-full p-1">
                            <Plus size={16} />
                         </div>
                         <span>Agregar Siguiente: <span className="underline">{nextLineName}</span></span>
                      </button>
                    </td>
                  </tr>
                )}
                {!nextLineName && budgetLines.length > 0 && (
                   <tr>
                       <td colSpan={7} className="p-4 text-center text-green-600 font-bold bg-green-50">
                           <CheckCircle className="inline mr-2" size={18} />
                           ¡Presupuesto Completado! (Todos los renglones estándar han sido agregados)
                       </td>
                   </tr>
                )}
                {typology && (
                  <tr>
                    <td colSpan={7} className="p-4 bg-gray-50">
                      <button
                        onClick={handleAddCustomLine}
                        className="w-full flex items-center justify-center space-x-2 py-3 bg-white border border-gray-300 shadow-sm rounded-lg hover:bg-mustard-50 hover:border-mustard-500 hover:text-mustard-700 transition-all font-bold text-gray-600"
                        title="Agregar un renglón que no esté en la lista estándar"
                      >
                        <div className="bg-navy-900 text-white rounded-full p-1">
                          <Plus size={16} />
                        </div>
                        <span>Agregar Renglón Personalizado</span>
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-6 bg-gray-50 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                 <h4 className="font-bold text-lg mb-2">Resumen APU (Global)</h4>
                 <div className="flex justify-between text-sm">
                   <span>Costo Directo Total:</span>
                   <span className="font-mono">Q{totalDirectCost.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-sm text-gray-600 items-center">
                   <div className="flex items-center gap-2">
                     <span>Costos Indirectos (%):</span>
                     <input 
                       type="number"
                       min="0"
                       max="100"
                       step="1"
                       className="w-16 p-1 border rounded text-right bg-white focus:ring-mustard-500 focus:border-mustard-500 text-sm"
                       aria-label="Porcentaje de costos indirectos"
                       value={indirectCostPercentageStr}
                       onKeyDown={preventNegativeInput}
                       onChange={(e) => setIndirectCostPercentageStr(e.target.value)}
                     />
                   </div>
                   <span className="font-mono">Q{indirectCost.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-sm text-gray-600">
                   <span>Subtotal (Precio Venta sin IVA):</span>
                   <span className="font-mono">Q{priceNoTax.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-sm text-gray-600">
                   <span>IVA (12%):</span>
                   <span className="font-mono">Q{tax.toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-xl font-bold text-navy-900 border-t pt-2 border-gray-300">
                   <span>Precio Final:</span>
                   <span>Q{finalPrice.toFixed(2)}</span>
                 </div>
              </div>

              <div className="flex flex-col justify-end space-y-2">
                <button onClick={handleSaveBudget} className="w-full py-3 bg-mustard-500 hover:bg-mustard-600 text-black font-bold rounded flex items-center justify-center space-x-2">
                  <Save size={18} />
                  <span>Guardar Presupuesto</span>
                </button>
                <button className="w-full py-3 bg-navy-900 hover:bg-navy-800 text-white font-bold rounded flex items-center justify-center space-x-2">
                  <Printer size={18} />
                  <span>Imprimir Reporte Ejecutivo (PDF)</span>
                </button>
                 <button className="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded flex items-center justify-center space-x-2">
                  <RefreshCw size={18} />
                  <span>Sincronizar Factores</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Presupuestos;