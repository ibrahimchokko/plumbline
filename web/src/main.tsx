import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { captureReferral } from './lib/growth.ts';
import { registerServiceWorker } from './lib/push.ts';
import { initTelemetry } from './lib/telemetry.ts';
import './styles/app.css';

initTelemetry();
captureReferral();
void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
