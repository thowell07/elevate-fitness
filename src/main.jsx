import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
// Self-hosted faces: the Content-Security-Policy blocks outside font hosts.
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
