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
        </form>
        
        <p className="mt-8 text-gray-600 text-xs">CONSTRUCTORA WM/M&S &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
};

export default WelcomeScreen;