import type { Ref } from 'react';
import { LENSES, SHARED_TABS } from '../domain/constants';
import type { LensId, SharedTabId } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  shared: boolean; lens: LensId; sharedTab: SharedTabId;
  showNotes: boolean; showMoney: boolean; demo?: boolean;
  onNavigate: (lens: LensId) => void;
  onSharedNavigate: (tab: SharedTabId) => void;
  onManageSharing: () => void;
  contextRef?: Ref<HTMLDivElement>;
}

function MenuIcon({ id }: { id: string }) {
  if (id === 'all') return <Icon.Home size={22} />;
  if (id === 'task' || id === 'calendar') return <Icon.Calendar size={22} />;
  if (id === 'money') return <Icon.Wallet size={22} />;
  if (id === 'list') return <Icon.Check size={22} />;
  return <Icon.List size={22} />;
}

/** One navigation tree: desktop sidebar and mobile floating bar share state and actions. */
export function AppNavigation({ shared, lens, sharedTab, showNotes, showMoney, demo, onNavigate, onSharedNavigate, onManageSharing, contextRef }: Props) {
  return <aside className="workspace-navigation" data-shared={shared}>
    <div className="workspace-context" ref={contextRef}>
      {!shared && <><p className="workspace-context-label">내 공간</p>{demo && <small>미리보기 데이터</small>}</>}
    </div>
    <nav className="workspace-menu" aria-label={shared ? '같이 보기 메뉴' : '주요 메뉴'}>
      {shared ? SHARED_TABS.map(item => <button key={item.id} type="button" aria-current={sharedTab === item.id ? 'page' : undefined}
        onClick={() => onSharedNavigate(item.id)}><MenuIcon id={item.id} /><span>{item.label}</span></button>)
        : LENSES.filter(item => (item.id !== 'idea' || showNotes) && (item.id !== 'money' || showMoney)).map(item =>
          <button key={item.id} type="button" aria-current={lens === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}><MenuIcon id={item.id} /><span>{item.label}</span></button>)}
    </nav>
    {shared && <button className="workspace-sharing" type="button" onClick={onManageSharing}><Icon.Users size={18} /><span>공유 관리</span></button>}
  </aside>;
}
