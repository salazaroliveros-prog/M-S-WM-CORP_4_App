import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import './index.css';
import 'leaflet/dist/leaflet.css';

// Leaflet default marker icons don't bundle correctly in many build pipelines.
// Configure them once at app startup.
import './lib/leafletSetup';

// PWA (vite-plugin-pwa)
// Safe no-op if plugin is not enabled.
import { registerSW } from 'virtual:pwa-register';

registerSW({
  immediate: true,
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);