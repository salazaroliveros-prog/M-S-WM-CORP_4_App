import React, { useState } from 'react';
import { Project, Transaction, ViewState } from '../types';
import { Save, DollarSign, CreditCard } from 'lucide-react';

interface Props {
  projects: Project[];
  onViewChange: (view: ViewState) => void;
  onCreateTransaction?: (tx: Transaction) => Promise<void>;
}

const Inicio: React.FC<Props> = ({ projects, onViewChange, onCreateTransaction }) => {
  const [activeTab, setActiveTab] = useState<'INGRESO' | 'GASTO'>('INGRESO');
  const [selectedProject, setSelectedProject] = useState('');
  
  // Form State
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('Quetzal');
  const [category, setCategory] = useState('');
  
  // Specific for Expense
  const [provider, setProvider] = useState('');
  const [rentEnd, setRentEnd] = useState('');

  const safeAmount = (raw: string): number | null => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const handleSave = async () => {
    if (!selectedProject) return alert('Seleccione un proyecto');
    if (!description.trim()) return alert('Ingrese una descripción');

    const amt = safeAmount(amount);
    if (amt === null) return alert('Ingrese un monto válido');
    if (amt <= 0) return alert('El monto debe ser mayor a 0');
    if (!category.trim()) return alert('Seleccione una categoría');
    
    // In a real app, this would dispatch to context or API
    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      projectId: selectedProject,
      type: activeTab,
      description: description.trim(),
      amount: amt,
      unit,
      cost: amt, // simplified logic
      category: category.trim(),
      date: new Date().toISOString(),
      provider: activeTab === 'GASTO' ? (provider.trim() || undefined) : undefined,
      rentEndDate: rentEnd || undefined
    };

    try {
      if (onCreateTransaction) {
        await onCreateTransaction(newTransaction);
      } else {
        const saved = JSON.parse(localStorage.getItem('transactions') || '[]');
        localStorage.setItem('transactions', JSON.stringify([...saved, newTransaction]));
      }
    } catch (e: any) {
      alert(e?.message || 'Error guardando transacción');
      return;
    }
    
    alert('Registro guardado exitosamente');
    // Reset form
    setDescription('');
    setAmount('');
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-navy-900 rounded-xl p-8 text-center text-white relative overflow-hidden shadow-lg">
        <div className="relative z-10">
          <h2 className="text-3xl font-bold text-mustard-500 mb-2">CONSTRUCTORA WM/M&S</h2>
          <p className="text-lg tracking-widest text-gray-300">EDIFICANDO EL FUTURO</p>
        </div>
        {/* Abstract farm/building bg simplified with css shapes */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl"></div>
      </div>

      {/* Project Selector */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <label htmlFor="inicio-active-project" className="block text-sm font-medium text-gray-700 mb-2">Seleccionar Proyecto Activo</label>
        <select 
          id="inicio-active-project"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-mustard-500 focus:border-mustard-500"
        >
          <option value="">-- Seleccione un proyecto --</option>
          {projects.filter(p => p.status === 'active').map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2">
        <button 
          onClick={() => setActiveTab('INGRESO')}
          className={`flex-1 py-3 px-4 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${activeTab === 'INGRESO' ? 'bg-green-600 text-white shadow-md transform -translate-y-1' : 'bg-gray-200 text-gray-600'}`}
        >
          <DollarSign size={20} />
          <span>REGISTRAR INGRESO</span>
        </button>
        <button 
          onClick={() => setActiveTab('GASTO')}
          className={`flex-1 py-3 px-4 rounded-lg font-bold flex items-center justify-center space-x-2 transition-all ${activeTab === 'GASTO' ? 'bg-red-600 text-white shadow-md transform -translate-y-1' : 'bg-gray-200 text-gray-600'}`}
        >
          <CreditCard size={20} />
          <span>REGISTRAR GASTO</span>
        </button>
      </div>

      {/* Form Area */}
      <div className="bg-white p-6 rounded-xl shadow-md border border-gray-100 animate-fade-in">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="col-span-2">
             <label htmlFor="inicio-desc" className="block text-sm font-semibold text-gray-700">Descripción</label>
             <input id="inicio-desc" type="text" value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full p-3 border rounded-lg" placeholder={activeTab === 'INGRESO' ? "Ej: Pago inicial cliente" : "Ej: Compra de cemento"} />
          </div>

          <div>
             <label htmlFor="inicio-amount" className="block text-sm font-semibold text-gray-700">Cantidad / Monto</label>
             <input id="inicio-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full p-3 border rounded-lg" placeholder="0" />
          </div>

          <div>
             <label htmlFor="inicio-unit" className="block text-sm font-semibold text-gray-700">Unidad</label>
             <select id="inicio-unit" value={unit} onChange={e => setUnit(e.target.value)} className="mt-1 w-full p-3 border rounded-lg">
               <option>Quetzal</option>
               {activeTab === 'GASTO' && (
                 <>
                  <option>m3</option>
                  <option>m2</option>
                  <option>Saco</option>
                  <option>Varilla</option>
                  <option>Viaje</option>
                  <option>Hora</option>
                 </>
               )}
             </select>
          </div>

          <div>
             <label htmlFor="inicio-category" className="block text-sm font-semibold text-gray-700">Categoría</label>
             <select id="inicio-category" value={category} onChange={e => setCategory(e.target.value)} className="mt-1 w-full p-3 border rounded-lg">
               <option value="">Seleccionar...</option>
               {activeTab === 'INGRESO' ? (
                 <>
                   <option>Aporte Cliente</option>
                   <option>Préstamo</option>
                   <option>Otros</option>
                 </>
               ) : (
                 <>
                   <option>Materiales</option>
                   <option>Planilla</option>
                   <option>Equipo/Herramienta</option>
                   <option>Sub-contrato</option>
                   <option>Administrativo</option>
                 </>
               )}
             </select>
          </div>

          {activeTab === 'GASTO' && (
            <>
              <div>
                 <label htmlFor="inicio-provider" className="block text-sm font-semibold text-gray-700">Proveedor</label>
                 <input id="inicio-provider" type="text" value={provider} onChange={e => setProvider(e.target.value)} className="mt-1 w-full p-3 border rounded-lg" placeholder="Ej: Cemaco" />
              </div>
              {provider && (
                <div className="col-span-2 bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <label htmlFor="inicio-rent-end" className="block text-sm font-semibold text-yellow-800">Fecha Fin Alquiler (Opcional - Genera Alerta)</label>
                  <input id="inicio-rent-end" type="date" value={rentEnd} onChange={e => setRentEnd(e.target.value)} className="mt-1 w-full p-3 border rounded-lg" />
                </div>
              )}
            </>
          )}

          <div className="col-span-2 pt-4">
            <button onClick={handleSave} className="w-full bg-navy-900 text-white font-bold py-4 rounded-lg hover:bg-navy-800 transition-colors flex items-center justify-center space-x-2">
              <Save size={20} />
              <span>GUARDAR TRANSACCIÓN</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick Navigation Footer */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
        <button onClick={() => onViewChange('PROYECTOS')} className="p-3 bg-gray-100 hover:bg-gray-200 rounded text-sm font-semibold text-gray-700">Ir a Proyectos</button>
        <button onClick={() => onViewChange('PRESUPUESTOS')} className="p-3 bg-gray-100 hover:bg-gray-200 rounded text-sm font-semibold text-gray-700">Ir a Presupuestos</button>
        <button onClick={() => onViewChange('DASHBOARD')} className="p-3 bg-gray-100 hover:bg-gray-200 rounded text-sm font-semibold text-gray-700">Ir a Dashboard</button>
        <button onClick={() => onViewChange('WELCOME')} className="p-3 bg-red-50 hover:bg-red-100 text-red-600 rounded text-sm font-semibold">Bloquear Pantalla</button>
      </div>
    </div>
  );
};

export default Inicio;