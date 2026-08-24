/**
 * /tide 의 진입점.
 *
 * 예전에는 앱이 하나였고 main.tsx 가 window.location.pathname 을 보고 어느 화면을
 * 그릴지 정했다. 그 방식은 배포 환경에 기대는 부분이 있었다 — 정적 파일과
 * _redirects 룰과 캐시 중 무엇이 먼저 잡히느냐에 따라 pathname 이 기대와 달라지면
 * /tide 로 들어와도 캘린더X 가 떴다.
 *
 * 지금은 HTML 도 번들도 따로다. 무엇이 먼저 잡히든 이 파일이 실행되면 잔고캘린더고,
 * 캘린더X 는 이 번들에 들어 있지도 않다. 덤으로 Firebase 를 아예 싣지 않는다 —
 * 이 페이지는 계정도 서버도 쓰지 않는다.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogHost } from '../../ui/Dialog';
import { TidePage } from './TidePage';
import '../../styles/base.css';
import '../../styles/app.css';

const container = document.getElementById('app');
if (!container) throw new Error('#app 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <StrictMode>
    <DialogHost>
      <TidePage />
    </DialogHost>
  </StrictMode>,
);
