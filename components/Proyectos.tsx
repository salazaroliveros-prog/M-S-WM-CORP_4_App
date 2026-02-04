import React, { useMemo, useState } from 'react';
import { Project, Typology, ViewState } from '../types';
import { Plus, MapPin, Calendar, FileText, Trash2, CheckCircle, AlertTriangle, X, Filter, ArrowDownAZ, ArrowUpZA, ArrowRight, Search, Users, Calculator, CloudDownload, Crosshair } from 'lucide-react';

interface Props {
  projects: Project[];
  onCreateProject: (project: Partial<Project>) => Promise<Project>;
  onUpdateProject: (projectId: string, patch: Partial<Project>) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onViewChange: (view: ViewState) => void;
  onSelectProject: (id: string) => void;
  onQuoteProject: (project: Project) => void;
}

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  action: () => void;
  isDestructive?: boolean;
}

const Proyectos: React.FC<Props> = ({ projects, onCreateProject, onUpdateProject, onDeleteProject, onViewChange, onSelectProject, onQuoteProject }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [viewProject, setViewProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState<Partial<Project>>({
    status: 'standby',
    typology: 'RESIDENCIAL'
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Filter and Sort State
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'standby' | 'completed'>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [sortBy, setSortBy] = useState<'name' | 'manager'>('name');
  const [searchTerm, setSearchTerm] = useState('');

  const isEditMode = useMemo(() => Boolean(editingProjectId), [editingProjectId]);

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    action: () => {},
  });

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const coords = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setFormData(prev => ({ ...prev, coordinates: coords }));
      }, (error) => {
        alert('Error obteniendo ubicación: ' + error.message);
      });
    } else {
      alert('Geolocalización no soportada por este navegador.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setCreatedProject(null);

    // Validations
    if (!formData.clientName?.trim()) {
      setValidationError('El nombre del cliente es obligatorio.');
      return;
    }
    if (!formData.name?.trim()) {
      setValidationError('El nombre del proyecto es obligatorio.');
      return;
    }
    if (!formData.location?.trim()) {
      setValidationError('La ubicación del proyecto es obligatoria.');
      return;
    }
    if (!formData.areaLand || Number(formData.areaLand) <= 0) {
      setValidationError('El área del terreno debe ser un número positivo mayor a 0.');
      return;
    }
    if (!formData.areaBuild || Number(formData.areaBuild) <= 0) {
      setValidationError('El área de construcción debe ser un número positivo mayor a 0.');
      return;
    }
    if (!formData.projectManager?.trim()) {
      setValidationError('El Encargado del Proyecto / Gerente es obligatorio.');
      return;
    }

    setIsLoading(true);
    try {
      if (editingProjectId) {
        await onUpdateProject(editingProjectId, {
          name: formData.name,
          clientName: formData.clientName,
          location: formData.location,
          lot: formData.lot,
          block: formData.block,
          coordinates: formData.coordinates,
          areaLand: Number(formData.areaLand),
          areaBuild: Number(formData.areaBuild),
          needs: formData.needs || '',
          status: (formData.status || 'standby') as any,
          typology: formData.typology as Typology,
          projectManager: formData.projectManager,
        });
        setEditingProjectId(null);
        setShowForm(false);
        setFormData({ status: 'standby', typology: 'RESIDENCIAL' });
        setValidationError(null);
      } else {
        const created = await onCreateProject({
          name: formData.name,
          clientName: formData.clientName,
          location: formData.location,
          lot: formData.lot,
          block: formData.block,
          coordinates: formData.coordinates,
          areaLand: Number(formData.areaLand),
          areaBuild: Number(formData.areaBuild),
          needs: formData.needs || '',
          status: formData.status || 'standby',
          startDate: new Date().toISOString(),
          typology: formData.typology as Typology,
          projectManager: formData.projectManager,
        });
        setCreatedProject(created);
        setShowForm(false);
        setFormData({ status: 'standby', typology: 'RESIDENCIAL' });
        setValidationError(null);
      }
    } catch (err: any) {
      setValidationError(err?.message || 'Error creando proyecto');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoToBudget = () => {
    if (createdProject) {
      onSelectProject(createdProject.id);
      onViewChange('PRESUPUESTOS');
    }
  };

  const openEditProject = (project: Project) => {
    setCreatedProject(null);
    setValidationError(null);
    setEditingProjectId(project.id);
    setShowForm(true);
    setFormData({
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      location: project.location,
      lot: project.lot,
      block: project.block,
      coordinates: project.coordinates,
      areaLand: project.areaLand,
      areaBuild: project.areaBuild,
      needs: project.needs,
      status: project.status,
      startDate: project.startDate,
      typology: project.typology,
      projectManager: project.projectManager,
    });
  };

  const escapeHtml = (value: string) => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const printFichaPdf = (project: Project) => {
    const now = new Date();
    const statusLabel = project.status === 'active' ? 'ACTIVO' : project.status === 'completed' ? 'COMPLETADO' : 'EN ESPERA';

    const html = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Ficha Técnica - ${escapeHtml(project.name)}</title>
          <style>
            body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111827; margin: 24px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
            .brand { font-weight: 800; font-size: 18px; color: #0f172a; }
            .subtitle { font-size: 12px; color:#374151; margin-top:4px; }
            .meta { font-size: 12px; color:#374151; text-align:right; }
            .title { font-weight: 800; font-size: 18px; margin: 0 0 8px; }
            .pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size: 11px; font-weight: 800; background:#f3f4f6; color:#111827; border:1px solid #e5e7eb; }
            .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 18px; }
            .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
            .card h3 { margin: 0 0 8px; font-size: 13px; color: #0f172a; }
            .row { display:flex; justify-content:space-between; gap: 12px; font-size: 12px; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
            .row:last-child { border-bottom: none; }
            .muted { color:#6b7280; }
            .notes { white-space: pre-wrap; font-size: 12px; line-height: 1.35; }
            a { color: #1d4ed8; text-decoration: none; }
            a:hover { text-decoration: underline; }
            @media print {
              body { margin: 0.5in; }
              .card { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="brand">M&S Construcción</div>
              <div class="subtitle">Gestión de Proyectos · Ficha Técnica</div>
            </div>
            <div class="meta">
              <div><strong>Ficha Técnica</strong></div>
              <div class="muted">${now.toLocaleDateString('es-GT')} ${now.toLocaleTimeString('es-GT')}</div>
            </div>
          </div>

          <h1 class="title">${escapeHtml(project.name)}</h1>
          <div class="pill">${escapeHtml(project.typology)} · ${escapeHtml(statusLabel)}</div>

          <div class="grid">
            <div class="card">
              <h3>Datos Generales</h3>
              <div class="row"><span class="muted">Cliente</span><span>${escapeHtml(project.clientName)}</span></div>
              <div class="row"><span class="muted">Encargado</span><span>${escapeHtml(project.projectManager || '-')}</span></div>
              <div class="row"><span class="muted">Inicio</span><span>${escapeHtml(new Date(project.startDate).toLocaleDateString('es-GT'))}</span></div>
            </div>
            <div class="card">
              <h3>Metraje</h3>
              <div class="row"><span class="muted">Área Terreno</span><span>${escapeHtml(String(project.areaLand))} m²</span></div>
              <div class="row"><span class="muted">Área Construcción</span><span>${escapeHtml(String(project.areaBuild))} m²</span></div>
            </div>
            <div class="card" style="grid-column: 1 / -1;">
              <h3>Ubicación</h3>
              <div class="row"><span class="muted">Dirección</span><span>${escapeHtml(project.location)}</span></div>
              <div class="row"><span class="muted">Lote / Bloque</span><span>${escapeHtml(`${project.lot || '-'} / ${project.block || '-'}`)}</span></div>
              <div class="row"><span class="muted">Coordenadas</span><span>${project.coordinates ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.coordinates)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.coordinates)}</a>` : '-'}</span></div>
            </div>
            <div class="card" style="grid-column: 1 / -1;">
              <h3>Programa de Necesidades</h3>
              <div class="notes">${escapeHtml(project.needs || '—')}</div>
            </div>
          </div>

          <div style="margin-top:12px; font-size:11px; color:#6b7280;">
            Sugerencia: use “Guardar como PDF” desde el diálogo de impresión.
          </div>
        </body>
      </html>
    `;

    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      alert('No se pudo abrir la ventana de impresión (popup bloqueado).');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    try {
      w.focus();
      setTimeout(() => {
        try { w.print(); } catch { /* ignore */ }
      }, 250);
    } catch {
      // ignore
    }
  };

  const handleViewFichaPdf = (project: Project) => {
    // Open the printable ficha first (so popup blockers treat it as a user gesture)
    printFichaPdf(project);
    // Also open the edit form so the user can update fields
    openEditProject(project);
  };

  const syncProjects = () => {
    // Simulation of Schema Generation for cloud sync
    const schema = {
      tableName: 'projects',
      columns: ['id', 'name', 'client_name', 'location', 'lot', 'block', 'coordinates', 'area_land', 'area_build', 'status', 'start_date', 'typology', 'project_manager']
    };
    console.log("Syncing Schema:", schema);
    alert(`Sincronización simulada. Esquema generado en consola.`);
  };

  const handleFetchFromAPI = () => {
    setIsLoading(true);
    // Simulate API delay
    setTimeout(() => {
        const fetchedProjects: Project[] = [
            {
                id: 'api-simulation-001',
                name: "Torre Empresarial Z.10 (API)",
                clientName: "Inversiones Globales S.A.",
                location: "Zona 10, Guatemala",
                coordinates: "14.6020, -90.5120",
                areaLand: 1500,
                areaBuild: 12000,
                needs: "Edificio de oficinas de 12 niveles con 4 sótanos.",
                status: "active",
                startDate: new Date().toISOString(),
                typology: "COMERCIAL",
                projectManager: "Ing. Carlos API"
            },
            {
                id: 'api-simulation-002',
                name: "Residencia Las Cumbres (API)",
                clientName: "Familia Estrada",
                location: "Carr. El Salvador, Km 18",
                lot: "12",
                block: "B",
                coordinates: "14.5300, -90.4500",
                areaLand: 800,
                areaBuild: 450,
                needs: "Casa estilo moderno de 2 niveles con piscina.",
                status: "standby",
                startDate: new Date().toISOString(),
                typology: "RESIDENCIAL",
                projectManager: "Arq. Sofia Cloud"
            }
        ];
        
        (async () => {
          try {
            // Insert as new projects (IDs will be generated by DB/local layer)
            for (const p of fetchedProjects) {
              await onCreateProject({
                name: p.name,
                clientName: p.clientName,
                location: p.location,
                lot: p.lot,
                block: p.block,
                coordinates: p.coordinates,
                areaLand: p.areaLand,
                areaBuild: p.areaBuild,
                needs: p.needs,
                status: p.status,
                startDate: p.startDate,
                typology: p.typology,
                projectManager: p.projectManager,
              });
            }
            alert(`${fetchedProjects.length} proyectos procesados de la API simulada.`);
          } catch (e: any) {
            alert(e?.message || 'Error importando proyectos');
          } finally {
            setIsLoading(false);
          }
        })();
    }, 1500);
  };

  const handleDelete = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Eliminar Proyecto',
      message: '¿Estás seguro de que deseas eliminar este proyecto permanentemente? Se perderán todos los datos asociados.',
      isDestructive: true,
      action: () => {
        (async () => {
          try {
            await onDeleteProject(id);
          } catch (e: any) {
            alert(e?.message || 'Error eliminando proyecto');
          } finally {
            setConfirmDialog(prev => ({ ...prev, isOpen: false }));
          }
        })();
      }
    });
  };

  const handleComplete = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Finalizar Proyecto',
      message: '¿Marcar el proyecto como completado? Esto archivará el proyecto como finalizado.',
      isDestructive: false,
      action: () => {
        (async () => {
          try {
            await onUpdateProject(id, { status: 'completed' });
          } catch (e: any) {
            alert(e?.message || 'Error actualizando proyecto');
          } finally {
            setConfirmDialog(prev => ({ ...prev, isOpen: false }));
          }
        })();
      }
    });
  };

  const handleExecute = (id: string) => {
     (async () => {
       try {
         await onUpdateProject(id, { status: 'active' });
       } catch (e: any) {
         alert(e?.message || 'Error actualizando proyecto');
       }
     })();
  };

  // Logic for Filtering and Sorting
  const filteredProjects = projects
    .filter(p => {
      const matchesStatus = filterStatus === 'all' ? true : p.status === filterStatus;
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        p.name.toLowerCase().includes(searchLower) || 
        p.clientName.toLowerCase().includes(searchLower);
      
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => {
      const fieldA = (sortBy === 'name' ? a.name : a.projectManager) || '';
      const fieldB = (sortBy === 'name' ? b.name : b.projectManager) || '';
      
      if (sortOrder === 'asc') {
        return fieldA.localeCompare(fieldB);
      } else {
        return fieldB.localeCompare(fieldA);
      }
    });

  return (
    <div className="space-y-6 relative">
      {/* Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">
            <div className={`p-4 border-b flex items-center justify-between ${confirmDialog.isDestructive ? 'bg-red-50 text-red-700' : 'bg-navy-50 text-navy-900'}`}>
              <div className="flex items-center space-x-2 font-bold text-lg">
                {confirmDialog.isDestructive ? <AlertTriangle size={24} /> : <CheckCircle size={24} />}
                <h3>{confirmDialog.title}</h3>
              </div>
              <button onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} className="text-gray-500 hover:text-gray-700" aria-label="Cerrar" title="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-600 text-base leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end space-x-3 border-t">
              <button 
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDialog.action}
                className={`px-4 py-2 text-white rounded-lg font-bold shadow-md transition-colors ${
                  confirmDialog.isDestructive 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-navy-900 hover:bg-navy-800'
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {createdProject && !showForm && (
        <div className="bg-green-100 border border-green-200 text-green-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="bg-green-500 text-white p-2 rounded-full">
               <CheckCircle size={20} />
            </div>
            <div>
              <p className="font-bold">¡Proyecto "{createdProject.name}" creado con éxito!</p>
              <p className="text-sm">Ahora puedes proceder a generar el presupuesto detallado.</p>
            </div>
          </div>
          <button 
            onClick={handleGoToBudget}
            className="bg-navy-900 hover:bg-navy-800 text-white px-5 py-2 rounded-lg font-bold flex items-center space-x-2 shadow-lg transition-transform hover:scale-105"
          >
            <FileText size={18} />
            <span>Ir a Presupuesto</span>
            <ArrowRight size={18} />
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h3 className="text-lg font-bold text-gray-700">Cartera de Proyectos</h3>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button 
            onClick={handleFetchFromAPI} 
            disabled={isLoading}
            className="bg-green-600 text-white px-4 py-2 rounded-full border border-green-700 text-sm font-medium hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50 flex-grow md:flex-grow-0 justify-center"
          >
            <CloudDownload size={18} />
            <span>{isLoading ? 'Cargando...' : 'Obtener Datos (API)'}</span>
          </button>
          <button onClick={syncProjects} className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full border border-blue-200 text-sm font-medium hover:bg-blue-200 transition-colors flex-grow md:flex-grow-0 text-center">
            Sincronizar Nube
          </button>
          <button onClick={() => { setShowForm(!showForm); setCreatedProject(null); setEditingProjectId(null); }} className="bg-mustard-500 text-navy-900 px-4 py-2 rounded-lg font-bold flex items-center justify-center space-x-2 hover:bg-mustard-600 flex-grow md:flex-grow-0">
            <Plus size={18} />
            <span>Nuevo Proyecto</span>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-mustard-200 mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-4 border-b pb-2">
            <h4 className="font-bold text-navy-900">
              {isEditMode ? 'Editar Ficha Técnica' : 'Datos de Campo (Primera Visita)'}
            </h4>
            {isEditMode && (
              <button
                type="button"
                onClick={() => {
                  setEditingProjectId(null);
                  setShowForm(false);
                  setFormData({ status: 'standby', typology: 'RESIDENCIAL' });
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Cancelar edición
              </button>
            )}
          </div>
          
          {validationError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded flex items-center space-x-2">
                <AlertTriangle size={18} />
                <span>{validationError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              className="p-3 border rounded" 
              placeholder="Nombre del Cliente *" 
              value={formData.clientName || ''}
              onChange={e => setFormData({...formData, clientName: e.target.value})} 
            />
            <input 
              className="p-3 border rounded" 
              placeholder="Nombre del Proyecto *" 
              value={formData.name || ''}
              onChange={e => setFormData({...formData, name: e.target.value})} 
            />
            
            {/* New optional fields: Lote and Bloque */}
            <div className="flex space-x-2">
               <input 
                 className="p-3 border rounded w-1/2" 
                 placeholder="Lote (Opcional)" 
                 value={formData.lot || ''}
                 onChange={e => setFormData({...formData, lot: e.target.value})} 
               />
               <input 
                 className="p-3 border rounded w-1/2" 
                 placeholder="Bloque (Opcional)" 
                 value={formData.block || ''}
                 onChange={e => setFormData({...formData, block: e.target.value})} 
               />
            </div>

            <div className="flex space-x-2">
               <input 
                className="p-3 border rounded w-1/2" 
                placeholder="Área Terreno (m2) *" 
                type="number"
                min="0.01"
                step="0.01"
                value={formData.areaLand || ''}
                onChange={e => setFormData({...formData, areaLand: Number(e.target.value)})} 
              />
              <input 
                className="p-3 border rounded w-1/2" 
                placeholder="Área Const. (m2) *" 
                type="number"
                min="0.01"
                step="0.01"
                value={formData.areaBuild || ''}
                onChange={e => setFormData({...formData, areaBuild: Number(e.target.value)})} 
              />
            </div>
            
            <input 
              className="p-3 border rounded" 
              placeholder="Ubicación / Dirección *" 
              value={formData.location || ''}
              onChange={e => setFormData({...formData, location: e.target.value})} 
            />
            
            {/* GPS Coordinates Field */}
            <div className="flex space-x-2">
                <input 
                  className="p-3 border rounded w-full" 
                  placeholder="Coordenadas GPS (Lat, Lng)" 
                  value={formData.coordinates || ''}
                  onChange={e => setFormData({...formData, coordinates: e.target.value})} 
                />
                <button 
                  type="button" 
                  onClick={handleGetLocation}
                  className="bg-gray-100 text-gray-700 p-3 rounded hover:bg-gray-200 border"
                  title="Obtener Ubicación Actual"
                >
                  <Crosshair size={20} />
                </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <select 
                className="p-3 border rounded w-full"
                onChange={e => setFormData({...formData, typology: e.target.value as Typology})}
                value={formData.typology}
                title="Tipología"
              >
                <option value="RESIDENCIAL">Residencial</option>
                <option value="COMERCIAL">Comercial</option>
                <option value="INDUSTRIAL">Industrial</option>
                <option value="CIVIL">Civil (Puentes/Muros)</option>
                <option value="PUBLICA">Pública (Escuelas/Hospitales)</option>
              </select>

              <select 
                className="p-3 border rounded w-full"
                onChange={e => setFormData({...formData, status: e.target.value as 'active' | 'standby' | 'completed'})}
                value={formData.status}
                title="Estado Inicial"
              >
                <option value="standby">En Espera</option>
                <option value="active">Activo</option>
                <option value="completed">Completado</option>
              </select>
            </div>

            <input 
              className="p-3 border rounded" 
              placeholder="Encargado del Proyecto / Gerente *" 
              value={formData.projectManager || ''}
              onChange={e => setFormData({...formData, projectManager: e.target.value})} 
            />
            <textarea 
              className="col-span-1 md:col-span-2 p-3 border rounded h-24" 
              placeholder="Programa de Necesidades (Descripción de lo que cliente quiere)"
              value={formData.needs || ''}
              onChange={e => setFormData({...formData, needs: e.target.value})}
            ></textarea>
            
            <button type="submit" className="col-span-1 md:col-span-2 bg-navy-900 text-white py-3 rounded font-bold hover:bg-navy-800">
              {isEditMode ? 'Guardar Cambios' : 'Guardar Ficha Técnica'}
            </button>
          </form>
        </div>
      )}

      {/* View Project Sheet Modal */}
      {viewProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between bg-navy-900 text-white">
              <div>
                <div className="text-xs text-gray-300">Ficha Técnica</div>
                <h3 className="font-bold text-lg">{viewProject.name}</h3>
              </div>
              <button onClick={() => setViewProject(null)} className="text-gray-200 hover:text-white" aria-label="Cerrar" title="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Cliente</div>
                  <div className="font-semibold text-navy-900">{viewProject.clientName}</div>
                </div>
                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Encargado</div>
                  <div className="font-semibold text-navy-900">{viewProject.projectManager || '-'}</div>
                </div>

                <div className="bg-gray-50 border rounded p-3 md:col-span-2">
                  <div className="text-xs text-gray-500">Ubicación / Dirección</div>
                  <div className="font-semibold text-navy-900">{viewProject.location}</div>
                  {(viewProject.lot || viewProject.block) && (
                    <div className="text-xs text-gray-500 mt-1">
                      {viewProject.lot ? `Lote: ${viewProject.lot}` : ''}
                      {viewProject.lot && viewProject.block ? ' · ' : ''}
                      {viewProject.block ? `Bloque: ${viewProject.block}` : ''}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Tipología</div>
                  <div className="font-semibold text-navy-900">{viewProject.typology}</div>
                </div>
                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Estado</div>
                  <div className="font-semibold text-navy-900">{String(viewProject.status).toUpperCase()}</div>
                </div>
                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Área Terreno</div>
                  <div className="font-semibold text-navy-900">{viewProject.areaLand} m²</div>
                </div>
                <div className="bg-gray-50 border rounded p-3">
                  <div className="text-xs text-gray-500">Área Construcción</div>
                  <div className="font-semibold text-navy-900">{viewProject.areaBuild} m²</div>
                </div>

                {viewProject.coordinates && (
                  <div className="bg-gray-50 border rounded p-3 md:col-span-2">
                    <div className="text-xs text-gray-500">Coordenadas</div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${viewProject.coordinates}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-700 hover:underline"
                    >
                      {viewProject.coordinates}
                    </a>
                  </div>
                )}

                {viewProject.needs && (
                  <div className="bg-gray-50 border rounded p-3 md:col-span-2">
                    <div className="text-xs text-gray-500">Programa de Necesidades</div>
                    <div className="text-navy-900 whitespace-pre-wrap">{viewProject.needs}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
              <button
                onClick={() => {
                  onSelectProject(viewProject.id);
                  onViewChange('PRESUPUESTOS');
                  setViewProject(null);
                }}
                className="px-4 py-2 bg-white border border-gray-300 rounded font-bold hover:bg-gray-100"
                title="Ir a Presupuestos"
              >
                Ir a Presupuesto
              </button>
              <button
                onClick={() => {
                  const p = viewProject;
                  setViewProject(null);
                  handleViewFichaPdf(p);
                }}
                className="px-4 py-2 bg-navy-900 hover:bg-navy-800 text-white rounded font-bold"
                title="Ver ficha en PDF y editar"
              >
                Ver PDF
              </button>
              <button
                onClick={() => {
                  const p = viewProject;
                  setViewProject(null);
                  openEditProject(p);
                }}
                className="px-4 py-2 bg-mustard-500 hover:bg-mustard-600 text-navy-900 rounded font-bold"
                title="Editar ficha"
              >
                Editar
              </button>
              <button
                onClick={() => {
                  const p = viewProject;
                  setViewProject(null);
                  onQuoteProject(p);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
                title="Cotizar"
              >
                Cotizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Sort Toolbar */}
      <div className="flex flex-col lg:flex-row gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
        
        {/* Search Bar */}
        <div className="relative flex-grow">
           <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
           <input 
             type="text"
             placeholder="Buscar por nombre o cliente..."
             className="w-full pl-10 pr-4 py-2 border rounded focus:ring-mustard-500 focus:border-mustard-500 outline-none"
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
           />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center space-x-2">
            <Filter size={18} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Estado:</span>
            <select 
              className="border rounded p-2 bg-white text-sm focus:ring-mustard-500"
              aria-label="Filtrar por estado"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
            >
              <option value="all">Todos</option>
              <option value="standby">En Espera</option>
              <option value="active">Activo</option>
              <option value="completed">Completado</option>
            </select>
          </div>
          
          <div className="flex items-center space-x-2">
             <span className="text-sm font-semibold text-gray-700">Ordenar por:</span>
             <select 
               className="border rounded p-2 bg-white text-sm focus:ring-mustard-500"
               aria-label="Ordenar por"
               value={sortBy}
               onChange={(e) => setSortBy(e.target.value as 'name' | 'manager')}
             >
               <option value="name">Nombre</option>
               <option value="manager">Encargado</option>
             </select>
             <button 
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-2 border rounded hover:bg-gray-100 flex items-center justify-center text-gray-700"
                title={sortOrder === 'asc' ? "Ascendente" : "Descendente"}
              >
                {sortOrder === 'asc' ? <ArrowDownAZ size={18} /> : <ArrowUpZA size={18} />}
              </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProjects.map(project => (
          <div key={project.id} className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow border-l-4 border-mustard-500 relative group">
            {/* Delete Button */}
            <button 
              onClick={() => handleDelete(project.id)}
              className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors p-1 z-10"
              title="Eliminar Proyecto"
            >
              <Trash2 size={18} />
            </button>

            <div className="p-6">
              <div className="flex justify-between items-start mb-4 pr-6">
                 <h4 className="font-bold text-lg text-navy-900 truncate">{project.name}</h4>
              </div>
              <div className="mb-4">
                 <span className={`px-2 py-1 text-xs rounded-full font-semibold inline-flex items-center space-x-1 ${
                   project.status === 'active' ? 'bg-green-100 text-green-800' : 
                   project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                   'bg-gray-100 text-gray-800'
                 }`}>
                   {project.status === 'active' && <span>ACTIVO</span>}
                   {project.status === 'standby' && <span>EN ESPERA</span>}
                   {project.status === 'completed' && <span>COMPLETADO</span>}
                 </span>
              </div>
              
              <div className="space-y-2 text-sm text-gray-600 mb-4">
                <div className="flex items-center space-x-2">
                  <MapPin size={16} className="text-mustard-600 flex-shrink-0" />
                  <span className="truncate">{project.location} {project.lot ? `L:${project.lot}` : ''} {project.block ? `B:${project.block}` : ''}</span>
                </div>
                {project.coordinates && (
                  <div className="flex items-center space-x-2">
                    <Crosshair size={16} className="text-gray-400 flex-shrink-0" />
                    <a href={`https://www.google.com/maps/search/?api=1&query=${project.coordinates}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">
                      {project.coordinates}
                    </a>
                  </div>
                )}
                <div className="flex items-center space-x-2">
                  <FileText size={16} className="text-mustard-600 flex-shrink-0" />
                  <span>{project.typology} - {project.areaBuild} m²</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Calendar size={16} className="text-mustard-600 flex-shrink-0" />
                  <span>{new Date(project.startDate).toLocaleDateString()}</span>
                </div>
                {project.projectManager && (
                  <div className="flex items-center space-x-2">
                    <Users size={16} className="text-mustard-600 flex-shrink-0" />
                    <span className="truncate">Encargado: {project.projectManager}</span>
                  </div>
                )}
                <div className="text-xs text-gray-500 italic mt-1">
                    Cliente: {project.clientName}
                </div>
              </div>

              <div className="border-t pt-4 flex space-x-2">
                <button
                  onClick={() => setViewProject(project)}
                  className="flex-1 text-center py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 transition-colors"
                  title="Ver ficha"
                >
                  Ver Ficha
                </button>
                <button
                  onClick={() => handleViewFichaPdf(project)}
                  className="px-3 text-center py-2 bg-navy-900 text-white rounded text-sm hover:bg-navy-800 transition-colors"
                  title="Ver ficha en PDF y editar"
                >
                  PDF
                </button>
                <button 
                  onClick={() => onQuoteProject(project)}
                  className="flex-1 text-center py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded text-sm hover:bg-blue-100 transition-colors flex items-center justify-center space-x-1"
                  title="Cotizar Servicios"
                >
                  <Calculator size={14} />
                  <span>Cotizar</span>
                </button>
                {project.status === 'standby' && (
                  <button 
                    onClick={() => handleExecute(project.id)}
                    className="flex-1 text-center py-2 bg-navy-900 text-white rounded text-sm hover:bg-navy-800 transition-colors"
                  >
                    Ejecutar
                  </button>
                )}
                {project.status === 'active' && (
                  <button 
                    onClick={() => handleComplete(project.id)}
                    className="flex-1 text-center py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors"
                  >
                    Finalizar
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {filteredProjects.length === 0 && projects.length > 0 && (
          <div className="col-span-full text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            <p className="font-medium">No se encontraron proyectos con el filtro seleccionado.</p>
          </div>
        )}

        {projects.length === 0 && !showForm && (
          <div className="col-span-full text-center py-12 text-gray-500">
            <p>No hay proyectos registrados. Crea uno nuevo para comenzar.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Proyectos;