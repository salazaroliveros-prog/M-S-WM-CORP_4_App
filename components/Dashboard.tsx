import React from 'react';
import { Project } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Props {
  projects: Project[];
}

const Dashboard: React.FC<Props> = ({ projects }) => {
  const activeProjects = projects.filter(p => p.status === 'active').length;
  
  // Mock Data
  const dataPie = [
    { name: 'Residencial', value: 4 },
    { name: 'Comercial', value: 2 },
    { name: 'Industrial', value: 1 },
    { name: 'Pública', value: 1 },
  ];
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

  const dataLine = [
    { name: 'Ene', ingresos: 4000, gastos: 2400 },
    { name: 'Feb', ingresos: 3000, gastos: 1398 },
    { name: 'Mar', ingresos: 2000, gastos: 9800 },
    { name: 'Abr', ingresos: 2780, gastos: 3908 },
    { name: 'May', ingresos: 1890, gastos: 4800 },
    { name: 'Jun', ingresos: 2390, gastos: 3800 },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-mustard-500">
           <h4 className="text-gray-500 text-sm">Proyectos Activos</h4>
           <p className="text-3xl font-bold text-navy-900">{activeProjects}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-blue-500">
           <h4 className="text-gray-500 text-sm">Ingresos (Mes)</h4>
           <p className="text-3xl font-bold text-navy-900">Q45,200</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-red-500">
           <h4 className="text-gray-500 text-sm">Gastos (Mes)</h4>
           <p className="text-3xl font-bold text-navy-900">Q32,150</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-green-500">
           <h4 className="text-gray-500 text-sm">Utilidad Neta</h4>
           <p className="text-3xl font-bold text-green-600">Q13,050</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <div className="bg-white p-6 rounded-xl shadow">
            <h3 className="font-bold text-gray-700 mb-4">Flujo de Caja (6 meses)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dataLine}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="ingresos" stroke="#0A192F" strokeWidth={2} />
                  <Line type="monotone" dataKey="gastos" stroke="#E1AD01" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
         </div>

         <div className="bg-white p-6 rounded-xl shadow">
            <h3 className="font-bold text-gray-700 mb-4">Distribución por Tipología</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dataPie}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#8884d8"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {dataPie.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Dashboard;