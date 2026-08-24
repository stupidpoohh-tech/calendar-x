/**
 * 하단 브랜드 푸터. 세 앱(캘린더X, 잔고캘린더, clear-week) 공용 서명.
 * "만든사람 DADA" 옆 홈 아이콘이 https://dada-town.com/ 으로 이어진다.
 */
import { Icon } from './Icon';

export function BrandFooter() {
  return (
    <footer className="brand-footer" aria-label="만든사람">
      <span>만든사람 DADA</span>
      <a
        href="https://dada-town.com/"
        className="brand-footer-home"
        aria-label="DADA 홈으로"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon.Home size={13} />
      </a>
    </footer>
  );
}
