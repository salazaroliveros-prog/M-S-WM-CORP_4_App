import React, { useMemo, useState, useEffect } from 'react';
import { BudgetLine, Project, RequisitionData, RequisitionItem } from '../types';
import { ShoppingCart, Send, Plus, Trash2, ClipboardList, X } from 'lucide-react';

interface Props {
  projects: Project[];
  initialData?: RequisitionData | null;
  onLoadBudget?: (projectId: string) => Promise<{ lines: BudgetLine[] } | null>;
  onCreateRequisition?: (data: RequisitionData, supplierName: string | null) => Promise<void>;
  onListRequisitions?: () => Promise<Array<{ id: string; projectId: string | null; requestedAt: string; supplierName?: string | null; supplierNote?: string | null; total: number; status: string }>>;
  onUpdateRequisitionStatus?: (requisitionId: string, status: 'sent' | 'confirmed' | 'received' | 'cancelled') => Promise<void>;
  canApproveRequisitions?: boolean;
  onListSuppliers?: () => Promise<Array<{ id: string; name: string; whatsapp?: string | null; phone?: string | null; defaultNoteTemplate?: string | null; termsTemplate?: string | null }> | null>;
  onUpsertSupplier?: (input: { id?: string | null; name: string; whatsapp?: string | null; phone?: string | null; defaultNoteTemplate?: string | null; termsTemplate?: string | null }) => Promise<{ id: string } | null>;
  onDeleteSupplier?: (supplierId: string) => Promise<void>;
}

type DerivedMaterial = {
  key: string;
  name: string;
  unit: string;
  budgetQty: number;
  suggestedUnitPrice?: number;
};

type Supplier = {
  id: string;
  name: string;
  whatsappPhone: string;
  defaultNoteTemplate: string;
  termsTemplate: string;
};

type MessageFormat = 'formal' | 'short';

const normalizeKey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

const formatQty = (n: number) => {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
};

const buildWhatsAppLink = (phoneRaw: string | null, text: string) => {
  const encoded = encodeURIComponent(text);
  const digits = (phoneRaw || '').replace(/\D/g, '');
  if (digits) return `https://wa.me/${digits}?text=${encoded}`;
  return `https://wa.me/?text=${encoded}`;
};

const DEFAULT_TERMS = [
  'Precio unitario y total (incluye IVA si aplica).',
  'Disponibilidad inmediata y fecha/hora estimada de entrega.',
  'Costo de flete/descarga y condiciones de pago.',
].join('\n');

const buildRequisitionMessage = (input: {
  companyName: string;
  project: Project;
  supplierName: string;
  supplierPhone: string;
  note: string;
  items: RequisitionItem[];
  format: MessageFormat;
  includeTerms: boolean;
  terms: string;
}) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-GT', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });

  const lines: string[] = [];

  if (input.format === 'short') {
    lines.push(`REQ MATERIALES - ${input.companyName}`);
    lines.push(`${dateStr} ${timeStr}`);
    lines.push(`Proyecto: ${input.project.name}`);
    if (input.project.location) lines.push(`Ubicación: ${input.project.location}`);
    if (input.supplierName) lines.push(`Proveedor: ${input.supplierName}`);
    lines.push('');
    lines.push('Items:');
    input.items.forEach(it => {
      const qty = Number.isFinite(it.quantity) ? it.quantity : 0;
      lines.push(`- ${formatQty(qty)} ${it.unit} ${it.name}`);
    });
    if (input.note.trim()) {
      lines.push('');
      lines.push(`Obs: ${input.note.trim()}`);
    }
    if (input.includeTerms && input.terms.trim()) {
      lines.push('');
      lines.push('Confirmar:');
      input.terms
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(t => lines.push(`- ${t}`));
    }
    return lines.join('\n');
  }

  // formal
  lines.push(input.companyName);
  lines.push('REQUISICIÓN DE MATERIALES');
  lines.push(`${dateStr} ${timeStr}`);
  lines.push('');
  lines.push(`Proyecto: ${input.project.name}`);
  if (input.project.clientName) lines.push(`Cliente: ${input.project.clientName}`);
  if (input.project.location) lines.push(`Ubicación: ${input.project.location}`);
  lines.push('');

  if (input.supplierName || input.supplierPhone) {
    lines.push('Proveedor');
    if (input.supplierName) lines.push(`- Nombre: ${input.supplierName}`);
    if (input.supplierPhone) lines.push(`- Tel: ${input.supplierPhone}`);
    lines.push('');
  }

  lines.push('Ítems solicitados');
  input.items.forEach((it, idx) => {
    const qty = Number.isFinite(it.quantity) ? it.quantity : 0;
    lines.push(`${idx + 1}) ${formatQty(qty)} ${it.unit} - ${it.name}`);
  });

  if (input.note.trim()) {
    lines.push('');
    lines.push('Observaciones');
    lines.push(input.note.trim());
  }

  if (input.includeTerms && input.terms.trim()) {
    lines.push('');
    lines.push('Por favor confirmar');
    input.terms
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(t => lines.push(`- ${t}`));
  }

  lines.push('');
  lines.push('Gracias.');
  return lines.join('\n');
};

const Compras: React.FC<Props> = ({
  projects,
  initialData,
  onLoadBudget,
  onCreateRequisition,
  onListRequisitions,
  onUpdateRequisitionStatus,
  canApproveRequisitions,
  onListSuppliers,
  onUpsertSupplier,
  onDeleteSupplier,
}) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [supplierName, setSupplierName] = useState('Cemaco');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierNote, setSupplierNote] = useState('');
  const [orderItems, setOrderItems] = useState<RequisitionItem[]>([
    // Defaults for demo if no data provided
    { name: 'Cemento UGC (Sacos)', quantity: 50, unit: 'Sacos' },
    { name: 'Hierro 3/8" (Varillas)', quantity: 100, unit: 'Varillas' }
  ]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const SUPPLIERS_STORAGE_KEY = 'wm_suppliers_v1';
  const defaultSuppliers: Supplier[] = useMemo(
    () => [
      { id: 'cemaco', name: 'Cemaco', whatsappPhone: '', defaultNoteTemplate: '', termsTemplate: DEFAULT_TERMS },
      { id: 'martillo', name: 'Ferretería El Martillo', whatsappPhone: '', defaultNoteTemplate: '', termsTemplate: DEFAULT_TERMS },
      { id: 'lapaz', name: 'Distribuidora La Paz', whatsappPhone: '', defaultNoteTemplate: '', termsTemplate: DEFAULT_TERMS },
    ],
    []
  );

  const [suppliers, setSuppliers] = useState<Supplier[]>(defaultSuppliers);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('cemaco');

  useEffect(() => {
    if (!onListSuppliers) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await onListSuppliers();
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        if (list.length > 0) {
          const hydrated: Supplier[] = list
            .filter(s => typeof (s as any)?.id === 'string' && typeof (s as any)?.name === 'string')
            .map(s => ({
              id: String((s as any).id),
              name: String((s as any).name),
              whatsappPhone: String((s as any).whatsapp ?? (s as any).phone ?? ''),
              defaultNoteTemplate: String((s as any).defaultNoteTemplate ?? ''),
              termsTemplate: String((s as any).termsTemplate ?? DEFAULT_TERMS),
            }));
          setSuppliers(hydrated);
          setSelectedSupplierId(hydrated[0]?.id || '');
          return;
        }

        // If cloud has no suppliers yet, seed defaults (best effort)
        if (onUpsertSupplier) {
          for (const s of defaultSuppliers) {
            try {
              await onUpsertSupplier({
                name: s.name,
                whatsapp: s.whatsappPhone || null,
                defaultNoteTemplate: s.defaultNoteTemplate || null,
                termsTemplate: s.termsTemplate || DEFAULT_TERMS,
              });
            } catch {
              // ignore
            }
          }
          const seeded = await onListSuppliers();
          if (cancelled) return;
          const seededList = Array.isArray(seeded) ? seeded : [];
          if (seededList.length > 0) {
            const hydrated: Supplier[] = seededList.map(s => ({
              id: String((s as any).id),
              name: String((s as any).name),
              whatsappPhone: String((s as any).whatsapp ?? (s as any).phone ?? ''),
              defaultNoteTemplate: String((s as any).defaultNoteTemplate ?? ''),
              termsTemplate: String((s as any).termsTemplate ?? DEFAULT_TERMS),
            }));
            setSuppliers(hydrated);
            setSelectedSupplierId(hydrated[0]?.id || '');
          }
        }
      } catch {
        // ignore and keep local
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onListSuppliers, onUpsertSupplier, defaultSuppliers]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUPPLIERS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<Partial<Supplier>>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hydrated: Supplier[] = parsed
          .filter(s => typeof s?.id === 'string' && typeof s?.name === 'string')
          .map(s => ({
            id: String(s.id),
            name: String(s.name),
            whatsappPhone: String(s.whatsappPhone || ''),
            defaultNoteTemplate: String(s.defaultNoteTemplate || ''),
            termsTemplate: String(s.termsTemplate || DEFAULT_TERMS),
          }));
        if (hydrated.length > 0) {
          setSuppliers(hydrated);
          setSelectedSupplierId(hydrated[0]?.id || '');
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SUPPLIERS_STORAGE_KEY, JSON.stringify(suppliers));
    } catch {
      // ignore
    }
  }, [suppliers]);

  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId]
  );

  // Keep the send-form fields in sync when user changes supplier
  useEffect(() => {
    if (!selectedSupplier) return;
    setSupplierName(selectedSupplier.name);
    setSupplierPhone(selectedSupplier.whatsappPhone);
    if (!supplierNote.trim() && selectedSupplier.defaultNoteTemplate.trim()) {
      setSupplierNote(selectedSupplier.defaultNoteTemplate);
    }
  }, [selectedSupplierId]);

  // Load initial data if provided (from Presupuestos Quick Buy)
  useEffect(() => {
    if (initialData) {
      setSelectedProjectId(initialData.projectId);
      if (initialData.items.length > 0) {
        setOrderItems(initialData.items);
      }
    }
  }, [initialData]);

  useEffect(() => {
    // When coming from QuickBuy, keep existing supplier choice but ensure fields are present.
    if (!initialData) return;
    if (selectedSupplier) {
      setSupplierName(selectedSupplier.name);
      setSupplierPhone(selectedSupplier.whatsappPhone);
    }
  }, [initialData]);

  const [derivedMaterials, setDerivedMaterials] = useState<DerivedMaterial[]>([]);
  const [isLoadingBudget, setIsLoadingBudget] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProjectId) {
      setDerivedMaterials([]);
      setBudgetError(null);
      return;
    }
    if (!onLoadBudget) {
      setDerivedMaterials([]);
      setBudgetError('Supabase no configurado (o presupuesto no disponible).');
      return;
    }

    let cancelled = false;
    setIsLoadingBudget(true);
    setBudgetError(null);
    (async () => {
      try {
        const budget = await onLoadBudget(selectedProjectId);
        const lines = budget?.lines || [];
        const map = new Map<string, DerivedMaterial>();

        for (const line of lines) {
          const lineQty = Number.isFinite(line.quantity) ? Number(line.quantity) : 0;
          if (!line.materials || line.materials.length === 0) continue;

          for (const m of line.materials) {
            const name = (m.name || '').trim();
            const unit = (m.unit || '').trim() || 'Unidad';
            if (!name) continue;
            const qtyPer = Number.isFinite(m.quantityPerUnit) ? Number(m.quantityPerUnit) : 0;
            const addQty = lineQty * qtyPer;
            const key = `${normalizeKey(name)}__${normalizeKey(unit)}`;

            const existing = map.get(key);
            const next: DerivedMaterial = existing
              ? { ...existing, budgetQty: existing.budgetQty + addQty }
              : {
                  key,
                  name,
                  unit,
                  budgetQty: addQty,
                  suggestedUnitPrice: Number.isFinite(m.unitPrice) ? Number(m.unitPrice) : undefined,
                };
            if (next.suggestedUnitPrice === undefined && Number.isFinite(m.unitPrice)) {
              next.suggestedUnitPrice = Number(m.unitPrice);
            }
            map.set(key, next);
          }
        }

        const list = Array.from(map.values())
          .filter(x => Number.isFinite(x.budgetQty) && x.budgetQty > 0)
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) {
          setDerivedMaterials(list);
          if (list.length === 0) setBudgetError('No se encontraron materiales en el presupuesto de este proyecto.');
        }
      } catch (e: any) {
        if (!cancelled) setBudgetError(e?.message || 'Error cargando presupuesto');
      } finally {
        if (!cancelled) setIsLoadingBudget(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, onLoadBudget]);

  const [history, setHistory] = useState<Array<{ id: string; projectId: string | null; requestedAt: string; supplierName?: string | null; supplierNote?: string | null; total: number; status: string }>>([]);

  const statusLabel = (s: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'draft') return 'BORRADOR';
    if (v === 'sent') return 'ENVIADO';
    if (v === 'confirmed') return 'APROBADO';
    if (v === 'received') return 'RECIBIDO';
    if (v === 'cancelled') return 'CANCELADO';
    return String(s || '').toUpperCase();
  };

  const handleStatusAction = async (requisitionId: string, nextStatus: 'sent' | 'confirmed' | 'received' | 'cancelled') => {
    if (!onUpdateRequisitionStatus) return;
    try {
      await onUpdateRequisitionStatus(requisitionId, nextStatus);
      if (onListRequisitions) {
        const res = await onListRequisitions();
        setHistory(res);
      }
    } catch (e: any) {
      alert(e?.message || 'No se pudo actualizar el estado.');
    }
  };

  const visibleHistory = useMemo(() => {
    if (!selectedProjectId) return history;
    return history.filter((h) => String(h.projectId || '') === String(selectedProjectId));
  }, [history, selectedProjectId]);

  useEffect(() => {
    if (!onListRequisitions) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await onListRequisitions();
        if (!cancelled) setHistory(res);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onListRequisitions]);

  const handleUpdateQuantity = (index: number, val: number) => {
    setOrderItems(prev => {
      const next = [...prev];
      next[index].quantity = val;
      return next;
    });
  };

  const handleUpdateName = (index: number, val: string) => {
    setOrderItems(prev => {
      const next = [...prev];
      next[index].name = val;
      return next;
    });
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddItem = () => {
    setOrderItems(prev => [...prev, { name: '', quantity: 1, unit: 'Unidad' }]);
  };

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelectedKeys, setPickerSelectedKeys] = useState<Record<string, boolean>>({});
  const [pickerQtyOverride, setPickerQtyOverride] = useState<Record<string, number>>({});

  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierDraftName, setSupplierDraftName] = useState('');
  const [supplierDraftPhone, setSupplierDraftPhone] = useState('');
  const [supplierDraftNoteTemplate, setSupplierDraftNoteTemplate] = useState('');
  const [supplierDraftTermsTemplate, setSupplierDraftTermsTemplate] = useState(DEFAULT_TERMS);

  const openNewSupplier = () => {
    setEditingSupplierId(null);
    setSupplierDraftName('');
    setSupplierDraftPhone('');
    setSupplierDraftNoteTemplate('');
    setSupplierDraftTermsTemplate(DEFAULT_TERMS);
    setIsSupplierModalOpen(true);
  };

  const openEditSupplier = () => {
    if (!selectedSupplier) return;
    setEditingSupplierId(selectedSupplier.id);
    setSupplierDraftName(selectedSupplier.name);
    setSupplierDraftPhone(selectedSupplier.whatsappPhone);
    setSupplierDraftNoteTemplate(selectedSupplier.defaultNoteTemplate || '');
    setSupplierDraftTermsTemplate(selectedSupplier.termsTemplate || DEFAULT_TERMS);
    setIsSupplierModalOpen(true);
  };

  const saveSupplier = async () => {
    const name = supplierDraftName.trim();
    const phone = supplierDraftPhone.trim();
    const defaultNoteTemplate = supplierDraftNoteTemplate;
    const termsTemplate = supplierDraftTermsTemplate;
    if (!name) {
      alert('Ingrese el nombre del proveedor.');
      return;
    }

    if (editingSupplierId) {
      setSuppliers(prev => prev.map(s => (s.id === editingSupplierId ? ({ ...s, name, whatsappPhone: phone, defaultNoteTemplate, termsTemplate }) : s)));
      setSelectedSupplierId(editingSupplierId);
      setSupplierName(name);
      setSupplierPhone(phone);
      setIsSupplierModalOpen(false);

      if (onUpsertSupplier) {
        try {
          await onUpsertSupplier({
            id: editingSupplierId,
            name,
            whatsapp: phone || null,
            defaultNoteTemplate: defaultNoteTemplate || null,
            termsTemplate: termsTemplate || DEFAULT_TERMS,
          });
        } catch {
          // ignore cloud failure; local already updated
        }
      }
      return;
    }

    if (onUpsertSupplier) {
      try {
        const created = await onUpsertSupplier({
          name,
          whatsapp: phone || null,
          defaultNoteTemplate: defaultNoteTemplate || null,
          termsTemplate: termsTemplate || DEFAULT_TERMS,
        });
        const newId = created?.id ? String(created.id) : crypto.randomUUID();
        const next: Supplier = { id: newId, name, whatsappPhone: phone, defaultNoteTemplate, termsTemplate };
        setSuppliers(prev => [next, ...prev]);
        setSelectedSupplierId(newId);
        setSupplierName(name);
        setSupplierPhone(phone);
        setIsSupplierModalOpen(false);
        return;
      } catch {
        // fall through to local-only create
      }
    }

    const newId = crypto.randomUUID();
    const next: Supplier = { id: newId, name, whatsappPhone: phone, defaultNoteTemplate, termsTemplate };
    setSuppliers(prev => [next, ...prev]);
    setSelectedSupplierId(newId);
    setSupplierName(name);
    setSupplierPhone(phone);
    setIsSupplierModalOpen(false);
  };

  const applySupplierNoteTemplate = () => {
    if (!selectedSupplier) return;
    if (!selectedSupplier.defaultNoteTemplate.trim()) {
      alert('Este proveedor no tiene plantilla de observaciones.');
      return;
    }
    setSupplierNote(selectedSupplier.defaultNoteTemplate);
  };

  const saveCurrentNoteAsTemplate = () => {
    if (!selectedSupplier) return;
    const ok = confirm('¿Guardar las observaciones actuales como plantilla del proveedor?');
    if (!ok) return;
    setSuppliers(prev => prev.map(s => (s.id === selectedSupplier.id ? ({ ...s, defaultNoteTemplate: supplierNote }) : s)));

    if (onUpsertSupplier) {
      void (async () => {
        try {
          await onUpsertSupplier({
            id: selectedSupplier.id,
            name: selectedSupplier.name,
            whatsapp: selectedSupplier.whatsappPhone || null,
            defaultNoteTemplate: supplierNote || null,
            termsTemplate: (selectedSupplier.termsTemplate || DEFAULT_TERMS) as any,
          });
        } catch {
          // ignore
        }
      })();
    }
  };

  const deleteSupplier = () => {
    if (!editingSupplierId) return;
    const s = suppliers.find(x => x.id === editingSupplierId);
    const ok = confirm(`¿Eliminar proveedor “${s?.name || ''}”?`);
    if (!ok) return;
    setSuppliers(prev => prev.filter(x => x.id !== editingSupplierId));
    const next = suppliers.filter(x => x.id !== editingSupplierId);
    setSelectedSupplierId(next[0]?.id || '');
    setIsSupplierModalOpen(false);

    if (onDeleteSupplier) {
      void (async () => {
        try {
          await onDeleteSupplier(editingSupplierId);
        } catch {
          // ignore
        }
      })();
    }
  };

  useEffect(() => {
    if (!isPickerOpen) return;
    // reset selection each time it opens for predictable UX
    const nextSel: Record<string, boolean> = {};
    const nextQty: Record<string, number> = {};
    for (const m of derivedMaterials) {
      nextSel[m.key] = false;
      nextQty[m.key] = m.budgetQty;
    }
    setPickerSelectedKeys(nextSel);
    setPickerQtyOverride(nextQty);
    setPickerSearch('');
  }, [isPickerOpen, derivedMaterials]);

  const filteredDerived = useMemo(() => {
    const q = normalizeKey(pickerSearch);
    if (!q) return derivedMaterials;
    return derivedMaterials.filter(m => normalizeKey(m.name).includes(q) || normalizeKey(m.unit).includes(q));
  }, [derivedMaterials, pickerSearch]);

  const handleAddSelectedFromBudget = () => {
    const selected = derivedMaterials.filter(m => pickerSelectedKeys[m.key]);
    if (selected.length === 0) return;

    setOrderItems(prev => {
      const next = [...prev];
      for (const m of selected) {
        const qty = pickerQtyOverride[m.key];
        const safeQty = Number.isFinite(qty) && qty > 0 ? qty : m.budgetQty;
        // merge by name+unit (case-insensitive)
        const existingIndex = next.findIndex(
          it => normalizeKey(it.name) === normalizeKey(m.name) && normalizeKey(it.unit) === normalizeKey(m.unit)
        );
        if (existingIndex >= 0) {
          next[existingIndex] = {
            ...next[existingIndex],
            quantity: (Number(next[existingIndex].quantity) || 0) + safeQty,
          };
        } else {
          next.push({ name: m.name, unit: m.unit, quantity: safeQty });
        }
      }
      return next;
    });

    setIsPickerOpen(false);
  };

  const handleSendOrder = async () => {
    if (!selectedProjectId) {
      alert('Seleccione un proyecto.');
      return;
    }
    if (orderItems.length === 0) {
      alert('La lista de pedido está vacía.');
      return;
    }

    const project = selectedProject;
    if (!project) {
      alert('Proyecto no encontrado.');
      return;
    }

    const cleanItems = orderItems
      .map(it => ({
        name: (it.name || '').trim(),
        unit: (it.unit || '').trim() || 'Unidad',
        quantity: Number.isFinite(it.quantity) ? Number(it.quantity) : 0,
      }))
      .filter(it => it.name && it.quantity > 0);

    if (cleanItems.length === 0) {
      alert('Debe ingresar al menos 1 item válido.');
      return;
    }

    const payload: RequisitionData = {
      projectId: selectedProjectId,
      sourceLineName: initialData?.sourceLineName,
      sourceBudgetLineId: initialData?.sourceBudgetLineId,
      items: cleanItems,
    };

    const message = buildRequisitionMessage({
      companyName: 'M&S Construcción',
      project,
      supplierName: supplierName || '',
      supplierPhone: supplierPhone || '',
      note: supplierNote || '',
      items: cleanItems,
      format: messageFormat,
      includeTerms,
      terms: termsText,
    });

    const ok = confirm('¿Guardar la requisición y abrir WhatsApp con el mensaje?');
    if (!ok) return;

    try {
      if (onCreateRequisition) {
        await onCreateRequisition(payload, supplierName || null);
        if (onListRequisitions) {
          const res = await onListRequisitions();
          setHistory(res);
        }
      }
    } catch (e: any) {
      alert(e?.message || 'Error guardando requisición');
      return;
    }

    const link = buildWhatsAppLink(supplierPhone || null, message);
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const [messageFormat, setMessageFormat] = useState<MessageFormat>('formal');
  const [includeTerms, setIncludeTerms] = useState(true);
  const termsText = useMemo(() => {
    if (selectedSupplier?.termsTemplate?.trim()) return selectedSupplier.termsTemplate;
    return DEFAULT_TERMS;
  }, [selectedSupplierId]);

  const messagePreview = useMemo(() => {
    if (!selectedProject) return '';
    const cleanItems = orderItems
      .map(it => ({
        name: (it.name || '').trim(),
        unit: (it.unit || '').trim() || 'Unidad',
        quantity: Number.isFinite(it.quantity) ? Number(it.quantity) : 0,
      }))
      .filter(it => it.name && it.quantity > 0);

    if (cleanItems.length === 0) return '';

    return buildRequisitionMessage({
      companyName: 'M&S Construcción',
      project: selectedProject,
      supplierName: supplierName || '',
      supplierPhone: supplierPhone || '',
      note: supplierNote || '',
      items: cleanItems,
      format: messageFormat,
      includeTerms,
      terms: termsText,
    });
  }, [selectedProject, orderItems, supplierName, supplierPhone, supplierNote, messageFormat, includeTerms, termsText]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-md">
        <h3 className="font-bold text-lg mb-4 text-navy-900 flex items-center gap-2">
          <ShoppingCart className="text-mustard-500" />
          Requisición de Materiales
        </h3>
        
        {initialData?.sourceLineName && (
           <div className="mb-4 bg-blue-50 p-3 rounded text-sm text-blue-800 border border-blue-200">
             <strong>Info:</strong> Pedido generado desde presupuesto: <u>{initialData.sourceLineName}</u>
           </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
           <div>
             <label htmlFor="compras-project" className="block text-sm text-gray-600">Proyecto</label>
             <select 
               id="compras-project"
               className="w-full p-2 border rounded"
               value={selectedProjectId}
               onChange={e => setSelectedProjectId(e.target.value)}
             >
                <option value="">Seleccionar...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
             </select>
           </div>
           <div>
             <label htmlFor="compras-supplier" className="block text-sm text-gray-600">Proveedor Sugerido</label>
             <div className="flex gap-2">
               <select
                 id="compras-supplier"
                 className="w-full p-2 border rounded"
                 value={selectedSupplierId}
                 onChange={e => setSelectedSupplierId(e.target.value)}
               >
                 {suppliers.map(s => (
                   <option key={s.id} value={s.id}>{s.name}</option>
                 ))}
               </select>
               <button
                 type="button"
                 onClick={openEditSupplier}
                 className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                 disabled={!selectedSupplier}
                 title="Editar proveedor"
                 aria-label="Editar proveedor"
               >
                 Editar
               </button>
               <button
                 type="button"
                 onClick={openNewSupplier}
                 className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
                 title="Nuevo proveedor"
                 aria-label="Nuevo proveedor"
               >
                 Nuevo
               </button>
             </div>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="compras-supplier-phone" className="block text-sm text-gray-600">WhatsApp Proveedor (opcional)</label>
            <input
              id="compras-supplier-phone"
              className="w-full p-2 border rounded"
              value={supplierPhone}
              onChange={e => setSupplierPhone(e.target.value)}
              placeholder="Ej: +502 5555 5555"
              inputMode="tel"
            />
            <p className="text-xs text-gray-500 mt-1">Si no se ingresa, se abrirá WhatsApp con el texto para seleccionar chat.</p>
          </div>
          <div>
            <label htmlFor="compras-note" className="block text-sm text-gray-600">Observaciones (opcional)</label>
            <input
              id="compras-note"
              className="w-full p-2 border rounded"
              value={supplierNote}
              onChange={e => setSupplierNote(e.target.value)}
              placeholder="Ej: Entregar en obra / Urgente / Incluir factura"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={applySupplierNoteTemplate}
                className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                disabled={!selectedSupplier || !selectedSupplier.defaultNoteTemplate.trim()}
                title="Aplicar plantilla del proveedor"
              >
                Usar plantilla
              </button>
              <button
                type="button"
                onClick={saveCurrentNoteAsTemplate}
                className="text-xs px-3 py-1 rounded bg-white border hover:bg-gray-50"
                disabled={!selectedSupplier}
                title="Guardar observaciones como plantilla"
              >
                Guardar como plantilla
              </button>
            </div>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-white mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="font-bold text-sm text-navy-900 flex items-center gap-2">
                <ClipboardList size={16} className="text-mustard-500" />
                Materiales del Presupuesto
              </h4>
              <p className="text-xs text-gray-500">Derivados del metrado del presupuesto (materiales × cantidades).</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              disabled={!selectedProjectId || derivedMaterials.length === 0}
              className="text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-50 px-3 py-2 rounded flex items-center gap-1"
              title="Seleccionar materiales del presupuesto"
            >
              <Plus size={14} /> Agregar desde presupuesto
            </button>
          </div>

          {isLoadingBudget && (
            <div className="text-sm text-gray-500">Cargando presupuesto…</div>
          )}
          {!isLoadingBudget && budgetError && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">{budgetError}</div>
          )}

          {!isLoadingBudget && !budgetError && derivedMaterials.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2">Material</th>
                    <th className="p-2">Unidad</th>
                    <th className="p-2 text-right">Cant. presupuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {derivedMaterials.slice(0, 8).map(m => (
                    <tr key={m.key} className="border-t">
                      <td className="p-2">{m.name}</td>
                      <td className="p-2 text-gray-600">{m.unit}</td>
                      <td className="p-2 text-right font-semibold">{formatQty(m.budgetQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {derivedMaterials.length > 8 && (
                <div className="text-xs text-gray-500 mt-2">Mostrando 8 de {derivedMaterials.length}. Use “Agregar desde presupuesto” para ver todo.</div>
              )}
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 mb-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-bold text-sm">Lista de Pedido</h4>
            <button onClick={handleAddItem} className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded flex items-center gap-1">
              <Plus size={12} /> Agregar Item
            </button>
          </div>
          
          <ul className="space-y-2 text-sm">
            {orderItems.map((item, idx) => (
              <li key={idx} className="flex gap-2 items-center border-b pb-1">
                <input 
                  type="text" 
                  className="flex-grow p-1 border rounded bg-white"
                  value={item.name}
                  onChange={e => handleUpdateName(idx, e.target.value)}
                  placeholder="Nombre del material"
                />
                <input 
                  type="number" 
                  className="w-20 p-1 border rounded bg-white text-right"
                  value={item.quantity}
                  onChange={e => handleUpdateQuantity(idx, parseFloat(e.target.value))}
                  placeholder="Cant"
                />
                <span className="text-gray-500 text-xs w-16 truncate" title={item.unit}>{item.unit}</span>
                <button onClick={() => handleRemoveItem(idx)} className="text-red-400 hover:text-red-600" aria-label="Eliminar item" title="Eliminar item">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
            {orderItems.length === 0 && (
              <li className="text-center text-gray-400 italic py-4">La lista de pedido está vacía.</li>
            )}
          </ul>
        </div>

        <button onClick={handleSendOrder} className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold flex items-center justify-center space-x-2">
          <Send size={18} />
          <span>Enviar Pedido por WhatsApp</span>
        </button>
        <p className="text-xs text-gray-500 mt-2 text-center">Se guarda la requisición y se abre WhatsApp con el texto formal.</p>

        <div className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
            <div>
              <label htmlFor="compras-format" className="block text-xs text-gray-600 mb-1">Formato</label>
              <select
                id="compras-format"
                className="w-full p-2 border rounded text-sm"
                value={messageFormat}
                onChange={e => setMessageFormat(e.target.value as MessageFormat)}
              >
                <option value="formal">Formal (encabezado + secciones)</option>
                <option value="short">Corto (texto compacto)</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={includeTerms}
                  onChange={e => setIncludeTerms(e.target.checked)}
                />
                Incluir condiciones (precio, entrega, pago)
              </label>
            </div>
          </div>

          <label htmlFor="compras-preview" className="block text-xs text-gray-600 mb-1">Vista previa del mensaje</label>
          <textarea
            id="compras-preview"
            className="w-full p-2 border rounded bg-white text-xs font-mono"
            value={messagePreview}
            readOnly
            rows={8}
            placeholder="Seleccione proyecto y agregue ítems para ver el mensaje."
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-md">
        <h3 className="font-bold text-lg mb-4 text-navy-900">Historial de Compras</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Proveedor</th>
                <th className="p-3">Total</th>
                <th className="p-3">Estado</th>
                {onUpdateRequisitionStatus && <th className="p-3">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibleHistory.length === 0 ? (
                <tr>
                  <td className="p-3" colSpan={onUpdateRequisitionStatus ? 5 : 4}>
                    <span className="text-gray-400 italic">Sin historial aún.</span>
                  </td>
                </tr>
              ) : (
                visibleHistory.map(h => (
                  <tr key={h.id}>
                    <td className="p-3">{new Date(h.requestedAt).toLocaleDateString()}</td>
                    <td className="p-3">{h.supplierName || h.supplierNote || '-'}</td>
                    <td className="p-3">Q{h.total.toFixed(2)}</td>
                    <td className="p-3"><span className="text-gray-700 font-bold">{statusLabel(h.status)}</span></td>
                    {onUpdateRequisitionStatus && (
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {(String(h.status).toLowerCase() === 'sent' && canApproveRequisitions) && (
                            <button
                              type="button"
                              onClick={() => handleStatusAction(h.id, 'confirmed')}
                              className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                              title="Aprobar requisición"
                            >
                              Aprobar
                            </button>
                          )}
                          {(String(h.status).toLowerCase() === 'confirmed' && canApproveRequisitions) && (
                            <button
                              type="button"
                              onClick={() => handleStatusAction(h.id, 'received')}
                              className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
                              title="Marcar como recibido"
                            >
                              Recibido
                            </button>
                          )}
                          {(['draft', 'sent', 'confirmed'].includes(String(h.status).toLowerCase())) && (
                            <button
                              type="button"
                              onClick={() => handleStatusAction(h.id, 'cancelled')}
                              className="text-xs px-3 py-1 rounded bg-white border hover:bg-gray-50"
                              title="Cancelar requisición"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isPickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Seleccionar materiales del presupuesto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <div className="font-bold text-navy-900">Seleccionar materiales del presupuesto</div>
                <div className="text-xs text-gray-500">Marque los materiales que desea ingresar al pedido.</div>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-2 rounded hover:bg-gray-100"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between mb-3">
                <div className="flex-grow">
                  <label htmlFor="compras-picker-search" className="block text-xs text-gray-600 mb-1">Buscar</label>
                  <input
                    id="compras-picker-search"
                    className="w-full p-2 border rounded"
                    value={pickerSearch}
                    onChange={e => setPickerSearch(e.target.value)}
                    placeholder="Ej: cemento, block, acero…"
                  />
                </div>
                <div className="text-xs text-gray-500">{filteredDerived.length} materiales</div>
              </div>

              <div className="max-h-[50vh] overflow-auto border rounded">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="p-2">Sel.</th>
                      <th className="p-2">Material</th>
                      <th className="p-2">Unidad</th>
                      <th className="p-2 text-right">Cant. sugerida</th>
                      <th className="p-2 text-right">Cant. a pedir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDerived.map(m => (
                      <tr key={m.key} className="border-t">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={!!pickerSelectedKeys[m.key]}
                            onChange={e => setPickerSelectedKeys(prev => ({ ...prev, [m.key]: e.target.checked }))}
                            aria-label={`Seleccionar ${m.name}`}
                            title={`Seleccionar ${m.name}`}
                          />
                        </td>
                        <td className="p-2">{m.name}</td>
                        <td className="p-2 text-gray-600">{m.unit}</td>
                        <td className="p-2 text-right font-semibold">{formatQty(m.budgetQty)}</td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            className="w-28 p-1 border rounded text-right"
                            value={Number.isFinite(pickerQtyOverride[m.key]) ? pickerQtyOverride[m.key] : m.budgetQty}
                            onChange={e => {
                              const v = parseFloat(e.target.value);
                              setPickerQtyOverride(prev => ({ ...prev, [m.key]: v }));
                            }}
                            aria-label={`Cantidad a pedir para ${m.name}`}
                            title={`Cantidad a pedir para ${m.name}`}
                            step="any"
                            min={0}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-end p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="px-4 py-2 rounded bg-white border hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddSelectedFromBudget}
                className="px-4 py-2 rounded bg-navy-900 text-white hover:bg-navy-800"
              >
                Agregar seleccionados al pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {isSupplierModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Administrar proveedor">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <div className="font-bold text-navy-900">{editingSupplierId ? 'Editar proveedor' : 'Nuevo proveedor'}</div>
                <div className="text-xs text-gray-500">Se guarda localmente en este navegador.</div>
              </div>
              <button
                type="button"
                onClick={() => setIsSupplierModalOpen(false)}
                className="p-2 rounded hover:bg-gray-100"
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="supplier-name" className="block text-sm text-gray-600">Nombre</label>
                <input
                  id="supplier-name"
                  className="w-full p-2 border rounded"
                  value={supplierDraftName}
                  onChange={e => setSupplierDraftName(e.target.value)}
                  placeholder="Ej: Ferretería XYZ"
                />
              </div>
              <div>
                <label htmlFor="supplier-phone" className="block text-sm text-gray-600">WhatsApp (opcional)</label>
                <input
                  id="supplier-phone"
                  className="w-full p-2 border rounded"
                  value={supplierDraftPhone}
                  onChange={e => setSupplierDraftPhone(e.target.value)}
                  placeholder="Ej: +502 5555 5555"
                  inputMode="tel"
                />
              </div>

              <div>
                <label htmlFor="supplier-note-template" className="block text-sm text-gray-600">Plantilla de observaciones</label>
                <textarea
                  id="supplier-note-template"
                  className="w-full p-2 border rounded"
                  value={supplierDraftNoteTemplate}
                  onChange={e => setSupplierDraftNoteTemplate(e.target.value)}
                  rows={3}
                  placeholder="Ej: Entregar en obra / Urgente / Incluir factura"
                />
              </div>

              <div>
                <label htmlFor="supplier-terms-template" className="block text-sm text-gray-600">Condiciones (se agregan al final del mensaje)</label>
                <textarea
                  id="supplier-terms-template"
                  className="w-full p-2 border rounded"
                  value={supplierDraftTermsTemplate}
                  onChange={e => setSupplierDraftTermsTemplate(e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_TERMS}
                />
                <p className="text-xs text-gray-500 mt-1">Una condición por línea. Se puede desactivar en el envío.</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 justify-between p-4 border-t bg-gray-50 rounded-b-xl">
              <div>
                {editingSupplierId && (
                  <button
                    type="button"
                    onClick={deleteSupplier}
                    className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700"
                  >
                    Eliminar
                  </button>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setIsSupplierModalOpen(false)}
                  className="px-4 py-2 rounded bg-white border hover:bg-gray-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveSupplier}
                  className="px-4 py-2 rounded bg-navy-900 text-white hover:bg-navy-800"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Compras;