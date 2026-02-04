import React, { useEffect, useMemo, useState } from 'react';
import { Project, Employee } from '../types';
import { PAY_RATES } from '../constants';
import { UserPlus, MapPin } from 'lucide-react';

interface Props {
  projects: Project[];
  onListEmployees?: () => Promise<any[] | null>;
  onCreateEmployee?: (input: { name: string; dpi?: string; phone?: string; position: string; dailyRate: number; projectId?: string | null }) => Promise<any>;
}

const RRHH: React.FC<Props> = ({ projects, onListEmployees, onCreateEmployee }) => {
  const [activeTab, setActiveTab] = useState<'CONTRATOS' | 'ASISTENCIA' | 'PLANILLA'>('CONTRATOS');
  
  const mockEmployees: Employee[] = useMemo(
    () => [
      { id: '1', name: 'Juan Pérez', dpi: '1234', position: 'Albañil', dailyRate: 175, status: 'active', phone: '55555555' },
      { id: '2', name: 'Carlos López', dpi: '5678', position: 'Peón', dailyRate: 100, status: 'active', phone: '44444444' }
    ],
    []
  );

  const [employees, setEmployees] = useState<Employee[]>(mockEmployees);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const [contractProjectId, setContractProjectId] = useState('');
  const [contractRole, setContractRole] = useState<keyof typeof PAY_RATES | ''>('');
  const [contractName, setContractName] = useState('');
  const [contractDpi, setContractDpi] = useState('');
  const [contractPhone, setContractPhone] = useState('');

  const refreshEmployees = async () => {
    if (!onListEmployees) return;
    setLoadingEmployees(true);
    try {
      const rows = await onListEmployees();
      if (!rows) return;
      const mapped: Employee[] = rows.map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        dpi: r.dpi ? String(r.dpi) : '',
        position: String(r.position ?? ''),
        dailyRate: Number(r.daily_rate ?? r.dailyRate ?? 0),
        status: (r.status as any) ?? 'active',
        phone: r.phone ? String(r.phone) : ''
      }));
      setEmployees(mapped.length > 0 ? mapped : []);
    } catch {
      // Keep existing list if cloud fails
    } finally {
      setLoadingEmployees(false);
    }
  };

  useEffect(() => {
    if (!onListEmployees) return;
    refreshEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onListEmployees]);

  const handleSendContractLink = async () => {
    if (!contractName.trim()) {
      alert('Ingrese el nombre del empleado.');
      return;
    }
    if (!contractRole) {
      alert('Seleccione un puesto.');
      return;
    }

    const dailyRate = PAY_RATES[contractRole];

    try {
      if (onCreateEmployee) {
        await onCreateEmployee({
          name: contractName.trim(),
          dpi: contractDpi.trim() || undefined,
          phone: contractPhone.trim() || undefined,
          position: contractRole,
          dailyRate,
          projectId: contractProjectId || null,
        });
        await refreshEmployees();
      }
    } catch (e: any) {
      alert(e?.message || 'Error creando empleado');
      return;
    }

    alert('Link de contrato por WhatsApp es una simulación.');
    setContractName('');
    setContractDpi('');
    setContractPhone('');
    setContractRole('');
  };

  return (
    <div className="space-y-6">
      <div className="flex space-x-2 border-b">
         <button onClick={() => setActiveTab('CONTRATOS')} className={`px-4 py-2 font-bold ${activeTab === 'CONTRATOS' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Contratación</button>
         <button onClick={() => setActiveTab('ASISTENCIA')} className={`px-4 py-2 font-bold ${activeTab === 'ASISTENCIA' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Asistencia (GPS)</button>
         <button onClick={() => setActiveTab('PLANILLA')} className={`px-4 py-2 font-bold ${activeTab === 'PLANILLA' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Planillas</button>
      </div>

      {activeTab === 'CONTRATOS' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
           <h3 className="font-bold text-lg mb-4 flex items-center space-x-2">
             <UserPlus size={24} className="text-mustard-500" />
             <span>Generar Contrato Digital</span>
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <select
               className="p-3 border rounded"
               aria-label="Seleccionar proyecto"
               value={contractProjectId}
               onChange={(e) => setContractProjectId(e.target.value)}
             >
               <option>Seleccionar Proyecto...</option>
               {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
             </select>
             <select
               className="p-3 border rounded"
               aria-label="Seleccionar puesto"
               value={contractRole}
               onChange={(e) => setContractRole(e.target.value as any)}
             >
               <option>Seleccionar Puesto...</option>
               {Object.entries(PAY_RATES).map(([role, rate]) => (
                 <option key={role} value={role}>{role} - Q{rate}/día</option>
               ))}
             </select>
             <input
               placeholder="Nombre Completo"
               className="p-3 border rounded"
               value={contractName}
               onChange={(e) => setContractName(e.target.value)}
             />
             <input
               placeholder="DPI / CUI"
               className="p-3 border rounded"
               value={contractDpi}
               onChange={(e) => setContractDpi(e.target.value)}
             />
             <input
               placeholder="Teléfono"
               className="p-3 border rounded"
               value={contractPhone}
               onChange={(e) => setContractPhone(e.target.value)}
             />
             <button
               onClick={handleSendContractLink}
               className="col-span-1 md:col-span-2 bg-navy-900 text-white py-3 rounded font-bold hover:bg-navy-800"
             >
               Enviar Link de Contrato (WhatsApp)
             </button>
           </div>
           
           <div className="mt-8">
             <h4 className="font-bold text-gray-700 mb-2">Personal Activo</h4>
             {loadingEmployees && (
               <div className="text-sm text-gray-500 mb-2">Cargando personal...</div>
             )}
             <ul className="divide-y">
               {employees.map(e => (
                 <li key={e.id} className="py-3 flex justify-between items-center">
                   <div>
                     <p className="font-bold text-navy-900">{e.name}</p>
                     <p className="text-xs text-gray-500">{e.position} - {e.phone}</p>
                   </div>
                   <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">ACTIVO</span>
                 </li>
               ))}
               {!loadingEmployees && employees.length === 0 && (
                 <li className="py-3 text-sm text-gray-400 italic">Sin personal registrado.</li>
               )}
             </ul>
           </div>
        </div>
      )}

      {activeTab === 'ASISTENCIA' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
          <div className="flex justify-between items-center mb-6">
             <h3 className="font-bold text-lg">Control de Asistencia Biométrico/GPS</h3>
             <button className="bg-green-600 text-white px-4 py-2 rounded font-bold hover:bg-green-700">
               Modo Kiosco (Tablet Obra)
             </button>
          </div>
          
          {/* Simulated Map */}
          <div className="bg-gray-100 w-full h-64 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300 mb-6 relative overflow-hidden">
             <div className="absolute inset-0 bg-blue-50 opacity-50"></div>
             <p className="z-10 text-gray-500 font-medium flex flex-col items-center">
               <MapPin size={32} className="mb-2 text-red-500" />
               <span>Mapa de Calor - Ubicación Trabajadores</span>
               <span className="text-xs">Radio: 100m del centro de proyecto</span>
             </p>
             {/* Fake dots */}
             <div className="absolute top-1/2 left-1/2 w-4 h-4 bg-green-500 rounded-full border-2 border-white transform -translate-x-4 -translate-y-4" title="Juan Pérez"></div>
             <div className="absolute top-1/2 left-1/2 w-4 h-4 bg-green-500 rounded-full border-2 border-white transform translate-x-8 translate-y-2" title="Carlos López"></div>
          </div>

          <div className="space-y-2">
            {employees.map(e => (
              <div key={e.id} className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold text-white">
                    {e.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold">{e.name}</p>
                    <p className="text-xs text-gray-500">Entrada: 07:02 AM - <span className="text-green-600">En Radio</span></p>
                  </div>
                </div>
                <button className="text-blue-600 hover:underline text-sm">Mensaje</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'PLANILLA' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
          <h3 className="font-bold text-lg mb-4">Planilla Semanal Calculada</h3>
          <table className="w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="p-2 text-left">Empleado</th>
                <th className="p-2 text-center">Días</th>
                <th className="p-2 text-center">Extras</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id} className="border-b">
                  <td className="p-3">{e.name} <br/><span className="text-xs text-gray-500">{e.position}</span></td>
                  <td className="p-3 text-center">6</td>
                  <td className="p-3 text-center">0</td>
                  <td className="p-3 text-right font-bold">Q{(e.dailyRate * 6).toFixed(2)}</td>
                  <td className="p-3 text-center"><span className="text-yellow-600 font-bold">Pendiente</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-right">
             <button className="bg-mustard-500 text-black px-6 py-2 rounded font-bold shadow-md hover:bg-mustard-600">
               Imprimir y Pagar
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RRHH;