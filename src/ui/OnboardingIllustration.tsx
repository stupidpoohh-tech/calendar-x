import type { ReactNode } from 'react';
import { Icon } from './Icon';

function Card({ tone, title, icon, children }: { tone: string; title: string; icon: ReactNode; children: ReactNode }) {
  return <div className="ob-info-card" data-tone={tone}><span className="ob-info-icon">{icon}</span><strong>{title}</strong>{children}</div>;
}
function Calendar() {
  return <div className="ob-mini-calendar">{Array.from({ length: 21 }, (_, i) => <i key={i} className={[3, 9, 12, 18].includes(i) ? `event event-${i}` : ''}>{i + 1}</i>)}</div>;
}
/** Code-native illustrations stay legible at mobile widths and in dark mode. */
export function OnboardingIllustration({ step }: { step: number }) {
  return <div className={'ob-illustration ob-scene-' + step} aria-hidden="true">
    <div className="ob-illustration-label">기능을 이해하기 위한 예시</div>
    {step === 0 && <div className="ob-overview">
      <div className="ob-overview-center"><span className="ob-info-icon"><Icon.Calendar size={26} /></span><strong>오늘을 한눈에</strong><Calendar /><span>대시보드</span></div>
      <Card tone="blue" title="일정" icon={<Icon.Calendar size={23} />}><p>다가오는 7일을 확인</p></Card>
      <Card tone="green" title="할 일" icon={<Icon.Check size={23} />}><p>오늘 할 일에 체크</p></Card>
      <Card tone="amber" title="노트" icon={<Icon.List size={23} />}><p>이번 달 생각을 이어서</p></Card>
      <Card tone="coral" title="현금흐름" icon={<Icon.Wallet size={23} />}><p>쓸 수 있는 한도 확인</p></Card>
    </div>}
    {step === 5 && <div className="ob-two-panels">
      <Card tone="blue" title="내 공간" icon={<Icon.User size={25} />}><Calendar /><div className="ob-info-tags"><span>나의 일정</span><span>노트</span><span>가계부</span></div><p>개인 기록을 관리하는 곳</p></Card>
      <Card tone="coral" title="같이 보기" icon={<Icon.Users size={25} />}><Calendar /><div className="ob-info-tags"><span>캘린더</span><span>리스트</span><span>노트</span></div><p>연결한 상대와 공유하는 곳</p></Card>
    </div>}
    {step === 1 && <div className="ob-three-panels">
      <Card tone="blue" title="캘린더" icon={<Icon.Calendar size={24} />}><p>날짜와 시간을 한눈에</p><Calendar /></Card>
      <Card tone="green" title="리스트" icon={<Icon.Check size={24} />}><p>해야 할 일을 차례로</p><div className="ob-check-list"><span>✓ 자료 준비</span><span>□ 회의 내용 확인</span><span>□ 다음 일정 정리</span></div></Card>
      <Card tone="amber" title="노트" icon={<Icon.List size={24} />}><p>생각을 기록으로</p><div className="ob-note-paper"><strong>다음 프로젝트</strong><span>떠오른 아이디어</span><span>기억할 내용</span><i /></div></Card>
    </div>}
    {step === 2 && <div className="ob-finance-map">
      <Card tone="green" title="입력한 잔고" icon={<Icon.Wallet size={23} />}><p>계좌에 확인한 금액</p></Card>
      <div className="ob-flow-center"><strong>현금흐름</strong><svg viewBox="0 0 240 96"><path className="ob-chart-area" d="M5 80L45 60L90 67L135 28L185 38L235 15V96H5Z" /><path d="M5 80L45 60L90 67L135 28L185 38L235 15" fill="none" stroke="currentColor" strokeWidth="3" /><circle cx="235" cy="15" r="5" fill="currentColor" /></svg><span>직접 기록한 입출금 일정 반영</span></div>
      <Card tone="violet" title="생활비 외 가용" icon={<Icon.Check size={23} />}><p>다음 입금 전까지 쓸 수 있는 한도</p></Card>
      <div className="ob-finance-foot"><span>생활비 확보</span><span>세이브 확보</span><span>카드 미결제 반영</span></div>
    </div>}
    {step === 3 && <div className="ob-two-panels">
      <Card tone="blue" title="생활비" icon={<Icon.Wallet size={25} />}><p>정한 기간 동안 사용할 돈</p><div className="ob-example-amount">식비 · 교통비</div><div className="ob-color-meter"><i /></div><span className="ob-info-caption">사용한 금액과 남은 몫 확인</span></Card>
      <Card tone="violet" title="세이브 · Save" icon={<Icon.Star size={25} />}><p>목적을 위해 남겨 둘 돈</p><div className="ob-info-tags"><span>비상금</span><span>여행</span><span>새 장비</span></div><div className="ob-color-meter"><i /></div><span className="ob-info-caption">확보한 몫은 가용 한도에서 구분</span></Card>
    </div>}
    {step === 4 && <div className="ob-recovery-map">
      <div className="ob-recovery-banner"><span className="ob-info-icon"><Icon.Undo size={26} /></span><div><strong>쉬는 시간도 일정으로</strong><p>예시 · 3일마다 저녁 OFF</p></div></div>
      <div className="ob-three-panels"><Card tone="blue" title="01 간격 설정" icon={<Icon.Settings size={22} />}><p>회복 간격 · 시간대<br />끌 것 · 할 것 선택</p></Card><Card tone="green" title="02 실제로 쉬기" icon={<Icon.Check size={22} />}><p>캘린더의 Recovery를 열고<br />회복 후 완료</p></Card><Card tone="violet" title="03 다음 회복" icon={<Icon.Calendar size={22} />}><p>실제로 완료한 날에서<br />설정한 간격 뒤로</p></Card></div>
      <div className="ob-recovery-choices"><span><b>끌 것</b> 일 · 고민</span><span><b>할 것</b> 사우나 · 명상</span></div>
      <p className="ob-recovery-note">놓친 회복은 ‘다시 잡기’ · 잠시 멈출 때는 ‘일시중지’</p>
    </div>}
  </div>;
}
