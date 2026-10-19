import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppNavigation } from './AppNavigation';

afterEach(cleanup);
function props() {
 return { shared:false, lens:'task' as const, sharedTab:'calendar' as const, showNotes:true, showMoney:true,
 onNavigate:vi.fn(), onSharedNavigate:vi.fn(), onManageSharing:vi.fn() };
}
it('개인 메뉴 한 벌로 네 화면을 연결하고 현재 위치를 표시한다', () => {
 const p=props(); render(<AppNavigation {...p}/>);
 const nav=within(screen.getByRole('navigation',{name:'주요 메뉴'}));
 expect(nav.getAllByRole('button').map(b=>b.textContent)).toEqual(['대시보드','캘린더','노트','가계부']);
 expect(nav.getByRole('button',{name:'캘린더'})).toHaveAttribute('aria-current','page');
 for(const [name,lens] of [['대시보드','all'],['캘린더','task'],['노트','idea'],['가계부','money']]) {
  fireEvent.click(nav.getByRole('button',{name})); expect(p.onNavigate).toHaveBeenLastCalledWith(lens);
 }
 expect(screen.getAllByRole('navigation')).toHaveLength(1);
});
it('숨긴 기능을 제외하고 공유 공간으로 바뀌면 공유 메뉴와 관리만 연결한다', () => {
 const p=props(); const {rerender}=render(<AppNavigation {...p} showNotes={false} showMoney={false}/>);
 expect(screen.queryByRole('button',{name:'노트'})).toBeNull();
 expect(screen.queryByRole('button',{name:'가계부'})).toBeNull();
 rerender(<AppNavigation {...p} shared sharedTab="notes"/>);
 const nav=within(screen.getByRole('navigation',{name:'같이 보기 메뉴'}));
 expect(nav.getAllByRole('button').map(b=>b.textContent)).toEqual(['캘린더','리스트','노트']);
 expect(nav.getByRole('button',{name:'노트'})).toHaveAttribute('aria-current','page');
 for(const [name,tab] of [['캘린더','calendar'],['리스트','list'],['노트','notes']]) {
  fireEvent.click(nav.getByRole('button',{name})); expect(p.onSharedNavigate).toHaveBeenLastCalledWith(tab);
 }
 fireEvent.click(screen.getByRole('button',{name:'공유 관리'}));
 expect(p.onManageSharing).toHaveBeenCalledOnce();
 expect(p.onNavigate).not.toHaveBeenCalled();
});

