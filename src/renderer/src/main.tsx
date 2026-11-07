import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { instalarCapturaDeErrores } from './utils/reportarError';
import './index.css';

instalarCapturaDeErrores();

const contenedor = document.getElementById('root');

if (!contenedor) {
  throw new Error('No se encontró el contenedor #root');
}

createRoot(contenedor).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
