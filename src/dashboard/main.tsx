import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../shared/theme';
import { App } from './App';

initTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
