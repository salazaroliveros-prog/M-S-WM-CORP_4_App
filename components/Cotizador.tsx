import React, { useState, useEffect } from 'react';
import { QUOTE_SERVICES } from '../constants';
import { QuoteInitialData } from '../types';
import { FileText, Share2, Printer } from 'lucide-react';

interface Props {
  initialData?: QuoteInitialData | null;
}

const Cotizador: React.FC<Props> = ({ initialData }) => {
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState('');

  // Effect to load initial data from project if available
  useEffect(() => {
    if (initialData) {
      setClient(initialData.clientName);
      setAddress(initialData.address);
    }
  }, [initialData]);

  const serviceData = QUOTE_SERVICES.find(s => s.name === selectedService);
  const total = serviceData ? serviceData.price * quantity : 0;

  const handleSend = () => {
    if (!client || !phone || !selectedService) {
      alert('Por favor complete los campos obligatorios (Cliente, Teléfono, Servicio).');
      return;
    }
    const message = `Hola ${client}, aquí está su cotización de ${selectedService}. Total estimado: Q${total.toFixed(2)}.`;
    const whatsappUrl = `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-lg border-t-8 border-mustard-500 print:shadow-none print:border-none print:w-full print:max-w-none">
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            .print-content, .print-content * {
              visibility: visible;
            }
            .print-content {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .no-print {
              display: none !important;
            }
          }
        `}
      </style>
      
      <div className="print-content">
        <div className="flex justify-between items-start mb-8 border-b pb-4">
           <div>
             <h2 className="text-2xl font-bold text-navy-900">CONSTRUCTORA WM/M&S</h2>
             <p className="text-gray-500 tracking-wider text-xs">EDIFICANDO EL FUTURO</p>
           </div>
           <div className="text-right text-xs text-gray-400">
             <p>Barrio El Centro, Quesada Jutiapa</p>
             <p>Tel: 55606172</p>
             <p>multiserviciosdeguatemal@gmail.com</p>
           </div>
        </div>

        <h3 className="text-xl font-bold mb-4 text-center">COTIZACIÓN DE SERVICIOS</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="flex flex-col">
            <label className="text-sm font-semibold text-gray-600 mb-1">Cliente</label>
            <input 
              placeholder="Nombre del Cliente" 
              value={client}
              onChange={e => setClient(e.target.value)}
              className="p-3 border rounded bg-gray-50 print:bg-transparent print:border-none print:p-0 print:font-bold"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm font-semibold text-gray-600 mb-1">Teléfono</label>
            <input 
              placeholder="Teléfono (WhatsApp)" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="p-3 border rounded bg-gray-50 print:bg-transparent print:border-none print:p-0"
            />
          </div>
          <div className="col-span-1 md:col-span-2 flex flex-col">
            <label className="text-sm font-semibold text-gray-600 mb-1">Dirección del Proyecto</label>
            <input 
              placeholder="Dirección del Proyecto (Opcional)" 
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="p-3 border rounded bg-gray-50 print:bg-transparent print:border-none print:p-0"
            />
          </div>
        </div>

        <div className="bg-navy-50 p-6 rounded-lg mb-6 border border-navy-100 print:bg-transparent print:border-gray-200">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-navy-900 mb-1">Servicio Requerido</label>
                <select 
                  className="w-full p-3 border rounded print:appearance-none print:border-none print:bg-transparent print:p-0 print:text-navy-900"
                  value={selectedService}
                  onChange={e => setSelectedService(e.target.value)}
                >
                  <option value="">Seleccione servicio...</option>
                  {QUOTE_SERVICES.map(s => (
                    <option key={s.name} value={s.name}>{s.name} - Q{s.price}/{s.unit}</option>
                  ))}
                </select>
                {/* Fallback for print to show text if select is weird in some browsers */}
                <div className="hidden print:block font-bold text-lg mt-1">{selectedService}</div>
              </div>
              <div>
                <label className="block text-sm font-bold text-navy-900 mb-1">Cantidad ({serviceData?.unit || 'Unidad'})</label>
                <input 
                  type="number" 
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(Number(e.target.value))}
                  className="w-full p-3 border rounded print:border-none print:bg-transparent print:p-0"
                />
              </div>
           </div>
           
           <div className="mt-6 flex justify-between items-center border-t border-navy-200 pt-4">
              <span className="text-lg font-bold text-navy-900">Total Estimado:</span>
              <span className="text-3xl font-bold text-mustard-600">Q{total.toFixed(2)}</span>
           </div>
        </div>
        
        <div className="hidden print:block mt-12 text-center text-xs text-gray-500 pt-4 border-t">
          <p>Esta cotización es válida por 15 días. Precios sujetos a cambios sin previo aviso.</p>
          <p>Generado automáticamente por Sistema M&S.</p>
        </div>
      </div>

      <div className="flex space-x-4 no-print">
        <button 
          onClick={handlePrint}
          className="flex-1 bg-navy-900 text-white py-3 rounded font-bold flex items-center justify-center space-x-2 hover:bg-navy-800 transition-colors"
        >
          <Printer size={20} />
          <span>Imprimir / Guardar PDF</span>
        </button>
        <button 
          onClick={handleSend}
          className="flex-1 bg-green-600 text-white py-3 rounded font-bold hover:bg-green-700 flex items-center justify-center space-x-2 transition-colors"
        >
          <Share2 size={20} />
          <span>Enviar por WhatsApp</span>
        </button>
      </div>
    </div>
  );
};

export default Cotizador;