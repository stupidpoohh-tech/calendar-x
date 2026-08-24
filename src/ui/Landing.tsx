/**
 * 로그인 전 홈 화면.
 *
 * 이전에는 앱을 열면 바로 로그인 카드가 떴다. 낯선 사람에게 "가입부터 하라"고
 * 요구하는 화면이라 매정하다. 여기서는 앱이 무엇을 하는지 먼저 보여 주고,
 * 시작하려면 로그인·가입으로 이동한다.
 */
import { useState } from 'react';
import { Auth } from './Auth';
import { BrandFooter } from './BrandFooter';
import { Icon } from './Icon';

type Screen = 'home' | 'auth';

export function Landing() {
  const [screen, setScreen] = useState<Screen>('home');

  if (screen === 'auth') return <Auth onBack={() => setScreen('home')} />;

  return (
    <div className="landing">
      <header className="landing-top">
        <div className="landing-brand">
          <span className="landing-mark"><Icon.Calendar size={15} /></span>
          <span className="landing-name">캘린더X</span>
        </div>
        <button className="landing-cta-sm" onClick={() => setScreen('auth')}>시작하기</button>
      </header>

      <section className="landing-hero">
        <h1 className="landing-h">
          할 일과 아이디어와 돈이
          <br />
          같은 날짜 위에.
        </h1>
        <p className="landing-sub">
          세 가지를 따로 관리하면 오늘 뭘 해야 하는지, 이번 달 얼마가 남는지를
          한 번에 볼 수 없습니다. 캘린더X 는 셋을 하나의 타임라인에 올립니다.
        </p>
        <div className="landing-actions">
          <button className="landing-cta" onClick={() => setScreen('auth')}>
            시작하기 <Icon.ArrowUpRight size={14} />
          </button>
          <a className="landing-alt" href="/tide">
            잔고캘린더만 쓰기 (로그인 없이)
          </a>
        </div>
      </section>

      <section className="landing-lenses">
        <div className="landing-lens" data-lens="task">
          <span className="landing-lens-dot" />
          <div>
            <h3>할 일</h3>
            <p>기간·중요·긴급·반복. 캘린더에 그대로 얹힌다.</p>
          </div>
        </div>
        <div className="landing-lens" data-lens="idea">
          <span className="landing-lens-dot" />
          <div>
            <h3>아이디어</h3>
            <p>떠오른 것을 단문으로. 필요하면 한 번 눌러 할 일로 승격.</p>
          </div>
        </div>
        <div className="landing-lens" data-lens="money">
          <span className="landing-lens-dot" />
          <div>
            <h3>가계부</h3>
            <p>잔고와 예정 입출금을 합쳐 <b>다음 입금까지 며칠 버티나</b>.</p>
          </div>
        </div>
      </section>

      <p className="landing-note">
        무료로 쓸 수 있고, 데이터는 계정에 저장됩니다.
      </p>

      <BrandFooter />
    </div>
  );
}
