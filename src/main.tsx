import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { DialogHost } from './ui/Dialog';
import './styles/base.css';
import './styles/app.css';

const container = document.getElementById('app');
if (!container) throw new Error('#app 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <StrictMode>
    <DialogHost>
      <App />
    </DialogHost>
  </StrictMode>,
);
