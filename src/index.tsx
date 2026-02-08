import { Buffer } from 'buffer';

// Assign Buffer to window before any other imports
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  // Minimal process polyfill for util library used by gramjs
  (window as any).process = { 
    env: { NODE_DEBUG: false },
    version: '',
    nextTick: (cb: any) => setTimeout(cb, 0)
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);