import React, { useMemo, useState, useEffect } from 'react';
import { QUOTE_SERVICES } from '../constants';
import { QuoteInitialData } from '../types';
import { Share2, Printer, Save, Trash2, RotateCcw } from 'lucide-react';
import jsPDF from 'jspdf';

type ServiceQuote = {
  id: string;
  client: string;
  phone: string | null;
  address: string | null;
  serviceName: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  createdAt: string;
  updatedAt: string;
};

interface Props {
  initialData?: QuoteInitialData | null;
  syncVersion?: number;
  onListQuotes?: () => Promise<ServiceQuote[]>;
  onUpsertQuote?: (input: {
    id?: string | null;
    client: string;
    phone?: string | null;
    address?: string | null;
    serviceName: string;
    quantity: number;
    unit?: string | null;
    unitPrice?: number | null;
    total?: number | null;
  }) => Promise<ServiceQuote>;
  onDeleteQuote?: (quoteId: string) => Promise<void>;
}

const Cotizador: React.FC<Props> = ({ initialData, syncVersion, onListQuotes, onUpsertQuote, onDeleteQuote }) => {
  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState('');

  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<ServiceQuote[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Effect to load initial data from project if available
  useEffect(() => {
    if (initialData) {
      setClient(initialData.clientName);
      setAddress(initialData.address);
    }
  }, [initialData]);

  const canUseHistory = Boolean(onListQuotes && onUpsertQuote && onDeleteQuote);

  const refreshHistory = async () => {
    if (!onListQuotes) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const rows = await onListQuotes();
      setQuotes(Array.isArray(rows) ? rows : []);
    } catch (e: any) {
      setHistoryError(String(e?.message ?? e ?? 'Error al cargar historial.'));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!onListQuotes) return;
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseHistory, syncVersion]);

  const serviceData = useMemo(() => QUOTE_SERVICES.find(s => s.name === selectedService), [selectedService]);
  const total = serviceData ? serviceData.price * quantity : 0;

  const buildQuotePdf = () => {
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    const padX = 48;
    let y = 56;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('CONSTRUCTORA WM/M&S', padX, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text('Barrio El Centro, Quesada Jutiapa', pageWidth - padX, y - 10, { align: 'right' });
    doc.text('Tel: 55606172', pageWidth - padX, y + 2, { align: 'right' });
    doc.text('multiserviciosdeguatemal@gmail.com', pageWidth - padX, y + 14, { align: 'right' });

    y += 36;
    doc.setDrawColor(220);
    doc.line(padX, y, pageWidth - padX, y);

    y += 28;
    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('COTIZACIÓN DE SERVICIOS', pageWidth / 2, y, { align: 'center' });

    y += 26;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40);

    const safe = (v: string) => String(v || '').trim();
    const row = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, padX, y);
      doc.setFont('helvetica', 'normal');
      doc.text(value || '-', padX + 120, y);
      y += 16;
    };

    const now = new Date();
    row('Fecha:', `${now.toLocaleDateString('es-GT')} ${now.toLocaleTimeString('es-GT')}`);
    row('Cliente:', safe(client));
    row('Teléfono:', safe(phone));
    row('Dirección:', safe(address) || '-');

    y += 10;
    doc.setDrawColor(235);
    doc.line(padX, y, pageWidth - padX, y);
    y += 22;

    const unit = serviceData?.unit || '';
    const unitPrice = Number(serviceData?.price ?? 0) || 0;
    const qty = Number(quantity) || 0;

    row('Servicio:', safe(selectedService));
    row('Cantidad:', `${qty} ${unit}`.trim());
    row('Precio Unit:', `Q${unitPrice.toFixed(2)}${unit ? `/${unit}` : ''}`);

    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(`TOTAL ESTIMADO: Q${total.toFixed(2)}`, padX, y);

    return doc;
  };

  const downloadPdf = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSend = async () => {
    if (!client || !phone || !selectedService) {
      alert('Por favor complete los campos obligatorios (Cliente, Teléfono, Servicio).');
      return;
    }

    try {
      const doc = buildQuotePdf();
      const blob = doc.output('blob') as Blob;
      const digits = phone.replace(/\D/g, '');
      const fileName = `Cotizacion_${String(client || 'Cliente').replace(/\s+/g, '_')}_${digits || 'sin_numero'}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const canShareFiles =
        typeof navigator !== 'undefined' &&
        typeof (navigator as any).share === 'function' &&
        (typeof (navigator as any).canShare !== 'function' || (navigator as any).canShare({ files: [file] }));

      if (canShareFiles) {
        await (navigator as any).share({
          title: 'Cotización de servicios',
          files: [file],
        });
        return;
      }

      // Fallback: at least generate the PDF file for the user to attach manually.
      downloadPdf(blob, fileName);
      alert('PDF generado. Adjunte el archivo en WhatsApp manualmente (su navegador no permite compartir archivos directamente).');
    } catch (e: any) {
      alert(String(e?.message ?? e ?? 'No se pudo generar/compartir el PDF.'));
    }
  };

  const handlePrint = () => {
    if (!client || !phone || !selectedService) {
      alert('Por favor complete los campos obligatorios (Cliente, Teléfono, Servicio).');
      return;
    }
    try {
      const doc = buildQuotePdf();
      const blob = doc.output('blob') as Blob;
      const digits = phone.replace(/\D/g, '');
      const fileName = `Cotizacion_${String(client || 'Cliente').replace(/\s+/g, '_')}_${digits || 'sin_numero'}.pdf`;
      downloadPdf(blob, fileName);
    } catch (e: any) {
      alert(String(e?.message ?? e ?? 'No se pudo generar el PDF.'));
    }
  };

  const resetForm = () => {
    setEditingQuoteId(null);
    setSelectedService('');
    setQuantity(1);
    setPhone('');
    setAddress(initialData?.address || '');
    setClient(initialData?.clientName || '');
  };

  const handleSaveToHistory = async () => {
    if (!onUpsertQuote) return;
    if (!client || !phone || !selectedService) {
      alert('Por favor complete los campos obligatorios (Cliente, Teléfono, Servicio).');
      return;
    }
    const payload = {
      id: editingQuoteId,
      client,
      phone,
      address: address || null,
      serviceName: selectedService,
      quantity,
      unit: serviceData?.unit || null,
      unitPrice: serviceData?.price ?? null,
      total,
    };

    try {
      const saved = await onUpsertQuote(payload);
      setEditingQuoteId(saved.id);
      setQuotes((prev) => [saved, ...prev.filter((q) => q.id !== saved.id)]);
    } catch (e: any) {
      alert(String(e?.message ?? e ?? 'No se pudo guardar la cotización.'));
    }
  };

  const handleLoadQuote = (q: ServiceQuote) => {
    setEditingQuoteId(q.id);
    setClient(q.client || '');
    setPhone(q.phone || '');
    setAddress(q.address || '');
    setSelectedService(q.serviceName || '');
    setQuantity(Number.isFinite(q.quantity) && q.quantity > 0 ? q.quantity : 1);
  };

  const handleDeleteFromHistory = async (quoteId: string) => {
    if (!onDeleteQuote) return;
    try {
      await onDeleteQuote(quoteId);
      setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
      if (editingQuoteId === quoteId) setEditingQuoteId(null);
    } catch (e: any) {
      alert(String(e?.message ?? e ?? 'No se pudo eliminar la cotización.'));
    }
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
                  title="Seleccionar servicio"
                  aria-label="Seleccionar servicio"
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
                  placeholder="1"
                  title="Cantidad"
                  aria-label="Cantidad"
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
        {canUseHistory && (
          <button 
            onClick={handleSaveToHistory}
            className="flex-1 bg-mustard-500 text-navy-900 py-3 rounded font-bold hover:bg-mustard-600 flex items-center justify-center space-x-2 transition-colors"
          >
            <Save size={20} />
            <span>Guardar al Historial</span>
          </button>
        )}
        <button 
          onClick={handleSend}
          className="flex-1 bg-green-600 text-white py-3 rounded font-bold hover:bg-green-700 flex items-center justify-center space-x-2 transition-colors"
        >
          <Share2 size={20} />
          <span>Enviar por WhatsApp</span>
        </button>
      </div>

      {canUseHistory && (
        <div className="mt-6 no-print">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-navy-900">Historial de cotizaciones</h4>
            <div className="flex items-center gap-2">
              <button
                onClick={resetForm}
                className="px-3 py-2 text-sm font-semibold rounded border hover:bg-gray-50 flex items-center gap-2"
                title="Nueva cotización"
              >
                <RotateCcw size={16} />
                Nueva
              </button>
              <button
                onClick={refreshHistory}
                disabled={historyLoading}
                className="px-3 py-2 text-sm font-semibold rounded border hover:bg-gray-50 disabled:opacity-60"
              >
                {historyLoading ? 'Cargando...' : 'Actualizar'}
              </button>
            </div>
          </div>

          {historyError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-3">{historyError}</div>
          )}

          {quotes.length === 0 ? (
            <div className="text-sm text-gray-500 border rounded p-4">No hay cotizaciones guardadas.</div>
          ) : (
            <div className="border rounded overflow-hidden">
              <div className="grid grid-cols-12 gap-2 bg-gray-50 text-xs font-bold text-gray-600 px-3 py-2">
                <div className="col-span-3">Cliente</div>
                <div className="col-span-3">Servicio</div>
                <div className="col-span-2">Total</div>
                <div className="col-span-2">Fecha</div>
                <div className="col-span-2 text-right">Acciones</div>
              </div>
              {quotes.slice(0, 20).map((q) => (
                <div key={q.id} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t items-center">
                  <div className="col-span-3">
                    <div className="font-semibold text-navy-900">{q.client}</div>
                    <div className="text-xs text-gray-500">{q.phone || ''}</div>
                  </div>
                  <div className="col-span-3">
                    <div className="font-semibold">{q.serviceName}</div>
                    <div className="text-xs text-gray-500">{q.quantity} {q.unit || ''}</div>
                  </div>
                  <div className="col-span-2 font-bold text-mustard-600">Q{Number(q.total ?? 0).toFixed(2)}</div>
                  <div className="col-span-2 text-xs text-gray-500">{new Date(q.createdAt).toLocaleString()}</div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button
                      onClick={() => handleLoadQuote(q)}
                      className="px-3 py-2 text-xs font-bold rounded bg-navy-900 text-white hover:bg-navy-800"
                    >
                      Cargar
                    </button>
                    <button
                      onClick={() => handleDeleteFromHistory(q.id)}
                      className="px-3 py-2 text-xs font-bold rounded border hover:bg-gray-50 text-red-700 flex items-center gap-1"
                      title="Eliminar"
                    >
                      <Trash2 size={14} />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Cotizador;