import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { TidePage } from './pages/Tide/TidePage';
import { DialogHost } from './ui/Dialog';
import './styles/base.css';
import './styles/app.css';

/**
 * /tide 는 잔고캘린더 독립 서브페이지.
 * 계정 · 서버 없이 localStorage 로만 도는 별개 앱이라 라우터 없이 pathname 만
 * 검사한다 — 두 앱은 데이터를 공유하지 않고 초기 로드만 갈린다.
 */
const isTide = window.location.pathname.replace(/\/$/, '') === '/tide';

const container = document.getElementById('app');
if (!container) throw new Error('#app 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <StrictMode>
    <DialogHost>
      {isTide ? <TidePage /> : <App />}
    </DialogHost>
  </StrictMode>,
);
