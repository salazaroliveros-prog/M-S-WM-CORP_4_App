import React, { useState } from 'react';
import { Project } from '../types';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

interface Props {
  projects: Project[];
}

const Seguimiento: React.FC<Props> = ({ projects }) => {
  const [selectedProject, setSelectedProject] = useState('');

  // Mock data generation for charts
  const getChartData = (projectId: string) => {
    if (!projectId) return [];
    // Simulate phases based on standard construction
    return [
      { name: 'Cimentación', planificado: 45000, ejecutado: 47000, fisico: 100 },
      { name: 'Muros', planificado: 30000, ejecutado: 25000, fisico: 80 },
      { name: 'Losa', planificado: 55000, ejecutado: 10000, fisico: 20 },
      { name: 'Acabados', planificado: 20000, ejecutado: 0, fisico: 0 },
      { name: 'Instalaciones', planificado: 15000, ejecutado: 5000, fisico: 30 },
    ];
  };

  const data = getChartData(selectedProject);

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg shadow-sm">
        <label className="font-bold mr-4">Seleccionar Proyecto:</label>
        <select 
          className="border p-2 rounded"
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
        >
          <option value="">Vista General</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gantt / Progress Chart */}
        <div className="bg-white p-6 rounded-xl shadow-lg">
          <h3 className="text-lg font-bold text-navy-900 mb-4">Avance Financiero: Planificado vs Real</h3>
          <div className="h-80 w-full">
            {selectedProject ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="planificado" fill="#0A192F" name="Presupuesto" />
                  <Bar dataKey="ejecutado" fill="#E1AD01" name="Gasto Real" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                Seleccione un proyecto para ver métricas
              </div>
            )}
          </div>
        </div>

        {/* Physical Progress */}
        <div className="bg-white p-6 rounded-xl shadow-lg">
           <h3 className="text-lg font-bold text-navy-900 mb-4">Avance Físico (%)</h3>
           <div className="space-y-4">
             {selectedProject ? data.map((item, idx) => (
               <div key={idx}>
                 <div className="flex justify-between text-sm mb-1">
                   <span>{item.name}</span>
                   <span className="font-bold">{item.fisico}%</span>
                 </div>
                 <div className="w-full bg-gray-200 rounded-full h-2.5">
                   <div 
                    className="bg-green-600 h-2.5 rounded-full" 
                    style={{ width: `${item.fisico}%` }}
                   ></div>
                 </div>
               </div>
             )) : (
              <div className="flex items-center justify-center h-64 text-gray-400">
                Seleccione un proyecto
              </div>
             )}
           </div>
        </div>
      </div>

      {selectedProject && (
        <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded">
          <h4 className="font-bold text-yellow-800">Alertas de Gestión</h4>
          <p className="text-sm text-yellow-700 mt-1">
            ⚠ El renglón "Cimentación" presenta un sobrecosto del 4.4% respecto a lo planificado. 
            Verifique facturas de concreto del 12/05/2026.
          </p>
        </div>
      )}
    </div>
  );
};

export default Seguimiento;