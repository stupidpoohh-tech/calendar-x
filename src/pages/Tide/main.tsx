/**
 * /tide 의 진입점.
 *
 * 예전에는 앱이 하나였고 main.tsx 가 window.location.pathname 을 보고 어느 화면을
 * 그릴지 정했다. 그 방식은 배포 환경에 기대는 부분이 있었다 — 정적 파일과
 * _redirects 룰과 캐시 중 무엇이 먼저 잡히느냐에 따라 /tide 로 들어와도
 * 캘린더X 가 떴다.
 *
 * 지금은 HTML 도 번들도 CSS 도 따로다. 이 파일이 실행되면 잔고캘린더고,
 * 캘린더X 는 이 번들에 들어 있지도 않다. 스타일도 캘린더X 토큰이 아니라
 * 원본 styles.css 하나만 쓴다 — 두 앱은 디자인 언어부터 다르다.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TideApp } from './TideApp';
import { migrateLegacyTide } from './lib/migrateLegacy';
import './styles.css';

// 중간 이식판이 남긴 값이 있으면 원본 형식으로 옮긴 뒤 앱을 띄운다.
migrateLegacyTide();

const container = document.getElementById('app');
if (!container) throw new Error('#app 엘리먼트를 찾을 수 없습니다.');

createRoot(container).render(
  <StrictMode>
    <TideApp />
  </StrictMode>,
);
