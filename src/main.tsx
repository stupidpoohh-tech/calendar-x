import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { DialogHost } from './ui/Dialog';
import './styles/base.css';
import './styles/app.css';

/**
 * 캘린더X 의 진입점. 이 번들에는 캘린더X 만 들어 있다.
 * 잔고캘린더(/tide)는 tide/index.html 과 src/pages/Tide/main.tsx 로 따로 빌드된다 —
 * 경로를 보고 갈래를 정하지 않으므로 두 앱이 서로를 대신 띄울 수 없다.
 */
const container = document.getElementById('app');
if (!container) throw new Error('#app 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <StrictMode>
    <DialogHost>
      <App />
    </DialogHost>
  </StrictMode>,
);
