import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

interface Props {
  onLogin: (email: string, password: string) => Promise<void> | void;
}

const WelcomeScreen: React.FC<Props> = ({ onLogin }) => {
  const appIconUrl = `${import.meta.env.BASE_URL}header-logo.png`;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const LOCAL_PASSWORD_KEY = 'ms_local_admin_password_v1';
  const [storedPassword, setStoredPassword] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showStored, setShowStored] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedEmail = email.trim();
    if (!password) {
      setError('La contraseña es requerida');
      return;
    }
    try {
      await onLogin(trimmedEmail, password);
    } catch (err: any) {
      const msg = err?.message || 'No se pudo iniciar sesión. Verifique sus credenciales.';
      setError(msg);
    }
  };

  const handleRecoverPassword = () => {
    setRecoveryMessage('');
    try {
      const saved = localStorage.getItem(LOCAL_PASSWORD_KEY);
      if (!saved) {
        setStoredPassword(null);
        setShowStored(false);
        setRecoveryMessage('No hay ninguna contraseña guardada en este dispositivo (primera vez o se borró el dato).');
        return;
      }
      setStoredPassword(saved);
      setShowStored(true);
      setRecoveryMessage('Esta es la contraseña guardada actualmente en este dispositivo.');
    } catch {
      setStoredPassword(null);
      setShowStored(false);
      setRecoveryMessage('No se pudo leer la contraseña local.');
    }
  };

  const handleChangeLocalPassword = () => {
    setRecoveryMessage('');
    const next = String(newPassword || '').trim();
    if (!next) {
      setRecoveryMessage('Ingrese una nueva contraseña para actualizarla.');
      return;
    }
    try {
      localStorage.setItem(LOCAL_PASSWORD_KEY, next);
      setStoredPassword(next);
      setPassword(next);
      setNewPassword('');
      setShowStored(true);
      setRecoveryMessage('Contraseña actualizada para este dispositivo. Use esta nueva contraseña para ingresar.');
    } catch {
      setRecoveryMessage('No se pudo guardar la nueva contraseña.');
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black z-10"></div>
      <div className="absolute inset-0 flex items-center justify-center opacity-20">
         <div className="w-96 h-96 bg-mustard-500 rounded-full blur-[128px]"></div>
      </div>

      <div className="z-20 text-center p-8 max-w-md w-full">
        <div className="flex items-center justify-center mb-4">
          <img
            src={appIconUrl}
            alt="M&S"
            className="h-12 w-auto md:h-14 object-contain block max-w-full"
          />
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold text-mustard-500 tracking-tighter mb-2 drop-shadow-lg">
          M&S
        </h1>
        <p className="text-mustard-600 text-xl tracking-[0.3em] font-light mb-12">SISTEMA INTEGRAL</p>

        <form onSubmit={handleSubmit} className="space-y-6 backdrop-blur-sm bg-white/5 p-8 rounded-2xl border border-white/10">
          <div>
            <label className="block text-gray-400 text-sm mb-2 text-left">Correo electrónico</label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black/50 border border-gray-700 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-mustard-500 focus:ring-1 focus:ring-mustard-500 transition-all"
                placeholder="admin@empresa.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2 text-left">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-500" size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-gray-700 rounded-lg py-3 pl-10 pr-4 text-white focus:outline-none focus:border-mustard-500 focus:ring-1 focus:ring-mustard-500 transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>
          
          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button 
            type="submit"
            className="w-full bg-mustard-500 hover:bg-mustard-600 text-black font-bold py-3 rounded-lg transition-transform transform hover:scale-105 flex items-center justify-center space-x-2"
          >
            <span>ACCEDER</span>
            <ArrowRight size={20} />
          </button>

          <div className="pt-4 mt-2 border-t border-white/10 text-left text-xs text-gray-400 space-y-2">
            <button
              type="button"
              onClick={handleRecoverPassword}
              className="underline underline-offset-2 hover:text-mustard-400"
            >
              Recuperar / ver contraseña guardada en este dispositivo
            </button>

            {storedPassword !== null && (
              <div className="mt-2 space-y-2">
                <div className="text-gray-300">
                  <span className="block text-[11px] text-gray-400 mb-1">Contraseña actual guardada</span>
                  <span className="font-mono bg-black/40 px-2 py-1 rounded select-all">
                    {showStored ? storedPassword : '••••••••'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowStored((v) => !v)}
                    className="ml-2 text-[11px] underline underline-offset-2 hover:text-mustard-300"
                  >
                    {showStored ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>

                <div className="flex flex-col gap-2 mt-2">
                  <label className="text-[11px] text-gray-400">Cambiar contraseña (solo este dispositivo)</label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="flex-1 bg-black/40 border border-gray-700 rounded-lg py-2 px-3 text-white focus:outline-none focus:border-mustard-500 focus:ring-1 focus:ring-mustard-500 text-xs"
                      placeholder="Nueva contraseña"
                    />
                    <button
                      type="button"
                      onClick={handleChangeLocalPassword}
                      className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-[11px] font-semibold hover:bg-gray-700"
                    >
                      Guardar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {recoveryMessage && (
              <p className="text-[11px] text-gray-300 mt-1">{recoveryMessage}</p>
            )}

            <p className="text-[10px] text-gray-500 mt-2">
              Esta contraseña se guarda solo en este dispositivo y no se envía a Supabase ni a la nube.
            </p>
          </div>
        </form>
        
        <p className="mt-8 text-gray-600 text-xs">CONSTRUCTORA WM/M&S &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
};

export default WelcomeScreen;