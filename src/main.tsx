import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { syncPlanWithUrl } from '@/store/planStore';
import '@/index.css';

syncPlanWithUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
