import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Global error catcher for debugging blank pages
window.onerror = function(message, source, lineno, colno, error) {
  console.error("GLOBAL ERROR CAUGHT:", message, "at", source, lineno, colno);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 20px; color: red; font-family: monospace;">
      <h1>Critical Startup Error</h1>
      <pre>${message}</pre>
    </div>`;
  }
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}