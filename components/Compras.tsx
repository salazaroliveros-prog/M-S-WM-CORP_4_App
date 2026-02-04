import React, { useState, useEffect } from 'react';
import { Project, RequisitionData, RequisitionItem } from '../types';
import { ShoppingCart, Send, Plus, Trash2 } from 'lucide-react';

interface Props {
  projects: Project[];
  initialData?: RequisitionData | null;
  onCreateRequisition?: (data: RequisitionData, supplierName: string | null) => Promise<void>;
  onListRequisitions?: () => Promise<Array<{ id: string; requestedAt: string; supplierName?: string | null; supplierNote?: string | null; total: number; status: string }>>;
}

const Compras: React.FC<Props> = ({ projects, initialData, onCreateRequisition, onListRequisitions }) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [supplierName, setSupplierName] = useState('Cemaco');
  const [orderItems, setOrderItems] = useState<RequisitionItem[]>([
    // Defaults for demo if no data provided
    { name: 'Cemento UGC (Sacos)', quantity: 50, unit: 'Sacos' },
    { name: 'Hierro 3/8" (Varillas)', quantity: 100, unit: 'Varillas' }
  ]);

  // Load initial data if provided (from Presupuestos Quick Buy)
  useEffect(() => {
    if (initialData) {
      setSelectedProjectId(initialData.projectId);
      if (initialData.items.length > 0) {
        setOrderItems(initialData.items);
      }
    }
  }, [initialData]);

  const [history, setHistory] = useState<Array<{ id: string; requestedAt: string; supplierName?: string | null; supplierNote?: string | null; total: number; status: string }>>([]);

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

  const handleSendOrder = async () => {
    if (!selectedProjectId) {
      alert('Seleccione un proyecto.');
      return;
    }
    if (orderItems.length === 0) {
      alert('La lista de pedido está vacía.');
      return;
    }

    const payload: RequisitionData = {
      projectId: selectedProjectId,
      sourceLineName: initialData?.sourceLineName,
      sourceBudgetLineId: initialData?.sourceBudgetLineId,
      items: orderItems,
    };

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

    // Keep existing WhatsApp behavior (simulado)
    alert('Pedido guardado. Enviar por WhatsApp es una simulación en esta versión.');
  };

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
             <select id="compras-supplier" className="w-full p-2 border rounded" value={supplierName} onChange={e => setSupplierName(e.target.value)}>
               <option>Cemaco</option>
               <option>Ferretería El Martillo</option>
               <option>Distribuidora La Paz</option>
             </select>
           </div>
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
        <p className="text-xs text-gray-500 mt-2 text-center">El proveedor recibirá un link para confirmar precios y disponibilidad.</p>
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
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td className="p-3" colSpan={4}>
                    <span className="text-gray-400 italic">Sin historial aún.</span>
                  </td>
                </tr>
              ) : (
                history.map(h => (
                  <tr key={h.id}>
                    <td className="p-3">{new Date(h.requestedAt).toLocaleDateString()}</td>
                    <td className="p-3">{h.supplierName || h.supplierNote || '-'}</td>
                    <td className="p-3">Q{h.total.toFixed(2)}</td>
                    <td className="p-3"><span className="text-gray-700 font-bold">{String(h.status).toUpperCase()}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Compras;