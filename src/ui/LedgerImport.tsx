/**
 * 가계부 이관 — 쓰기 전에 보여 주는 것.
 *
 * 무엇이 몇 건 들어가고, 무엇이 왜 빠지며, 무엇을 넘겨짚었는지(대출 → 원금, 빈 설명 →
 * 카테고리 이름)를 한 화면에 적는다. 숫자는 `planLedgerImport` 가 낸 그대로다.
 */
import type { ImportPlan, ImportProblem } from '../domain/ledgerImport';
import { formatAmount } from '../domain/money';

const n = (v: number) => v.toLocaleString('ko-KR');
const day = (iso: string) => iso.replace(/-/g, '.');

export function LedgerImportProblems({ problems }: { problems: readonly ImportProblem[] }) {
  return (
    <>
      <ul className="dlg-skips">
        {problems.slice(0, 10).map((p, i) => (
          <li key={`${p.file}-${p.line}-${i}`}>
            <code>{p.file}{p.line != null ? ` ${p.line}행` : ''}</code> — {p.reason}
          </li>
        ))}
        {problems.length > 10 && <li>그 외 {n(problems.length - 10)}곳</li>}
      </ul>
      <p className="dlg-note">아무것도 저장하지 않았습니다. 파일을 고친 뒤 다시 시도해 주세요.</p>
    </>
  );
}

export function LedgerImportPreview({ plan, ignoredColumns }: { plan: ImportPlan; ignoredColumns: readonly string[] }) {
  const created = plan.categories.filter((c) => c.created);
  const matched = plan.categories.filter((c) => !c.created);
  const archived = matched.filter((c) => c.archived);

  return (
    <div className="imp">
      <ul className="imp-files">
        {plan.files.map((f) => (
          <li key={f.file}>
            <span className="imp-file">{f.file}</span>
            <span className="num">{day(f.from)} – {day(f.to)} · {n(f.count)}건</span>
          </li>
        ))}
      </ul>

      <div className="imp-sum">
        <div><span>수입</span><b className="num plus">{n(plan.income.count)}건 · {formatAmount(plan.income.amountMinor)}</b></div>
        <div><span>지출</span><b className="num minus">{n(plan.expense.count)}건 · {formatAmount(plan.expense.amountMinor)}</b></div>
      </div>
      <p className="dlg-note">모두 <b>실제 거래</b>로 들어갑니다. 예정 · 반복은 만들지 않습니다.</p>

      {plan.loan.count > 0 && (
        <p className="dlg-note">
          카테고리 &lsquo;대출&rsquo; {n(plan.loan.count)}건({formatAmount(plan.loan.amountMinor)})은 <b>대출 원금</b>으로 셉니다 —
          {' '}현금 흐름에는 들어가고 소비 통계에서는 빠집니다. 원본이 원금과 이자를 한 금액으로 적어
          {' '}이자(금융비용)는 따로 잡히지 않습니다. 필요하면 건별로 고칠 수 있습니다.
        </p>
      )}

      {plan.untitled > 0 && (
        <p className="dlg-note">설명이 빈 {n(plan.untitled)}건은 카테고리 이름(없으면 수입 · 지출)을 제목으로 씁니다.</p>
      )}

      {created.length > 0 && (
        <div className="imp-cats">
          <span className="imp-h">새로 만드는 카테고리 {n(created.length)}개</span>
          <span className="imp-chips">
            {created.map((c) => <span key={c.categoryId} className="imp-chip">{c.kind === 'income' ? '수입 · ' : ''}{c.name} <i className="num">{n(c.count)}</i></span>)}
          </span>
        </div>
      )}
      {matched.length > 0 && (
        <div className="imp-cats">
          <span className="imp-h">이미 있는 카테고리에 붙임 {n(matched.length)}개</span>
          <span className="imp-chips">
            {matched.map((c) => <span key={c.categoryId} className="imp-chip">{c.name}{c.archived ? ' (보관됨)' : ''} <i className="num">{n(c.count)}</i></span>)}
          </span>
        </div>
      )}
      {archived.length > 0 && (
        <p className="dlg-note">보관한 카테고리에 붙는 거래는 지난 기록 · 통계에 그 이름으로 보입니다.</p>
      )}

      {plan.already.length > 0 && (
        <p className="dlg-note">전에 가져온 {n(plan.already.length)}건은 건너뜁니다 — 지금 내용을 그대로 둡니다.</p>
      )}
      {plan.repeated.length > 0 && (
        <p className="dlg-note">같은 내용이 고른 파일에 두 번 들어 있는 {n(plan.repeated.length)}건은 한 번만 넣습니다 (같은 파일을 두 번 고른 경우).</p>
      )}

      {plan.overlaps.length > 0 && (
        <div className="dlg-warn">
          <p>
            이미 적어 둔 실제 거래와 날짜 · 구분 · 금액이 같은 행이 <b>{n(plan.overlaps.length)}건</b> 있습니다.
            {' '}같은 거래를 손으로 먼저 적었을 수 있습니다.
          </p>
          <ul className="dlg-skips">
            {plan.overlaps.slice(0, 6).map((o) => (
              <li key={o.row.id}>
                <span className="num">{day(o.row.date)} {formatAmount(o.row.amountMinor)}</span> {o.row.title}
                {' '}↔ 이미 있는 &lsquo;{o.existing.title || '(제목 없음)'}&rsquo;
              </li>
            ))}
            {plan.overlaps.length > 6 && <li>그 외 {n(plan.overlaps.length - 6)}건</li>}
          </ul>
        </div>
      )}

      {plan.afterBalance && plan.afterBalance.count > 0 && (
        <p className="dlg-warn">
          {n(plan.afterBalance.count)}건은 잔고를 적은 날({day(plan.afterBalance.asOf)}) 당일이거나 그 뒤라
          {' '}한도에서 다시 빠집니다. 그 돈이 이미 잔고에 들어 있다면, 가져온 뒤 잔고를 다시 적어 주세요.
        </p>
      )}
      {ignoredColumns.length > 0 && (
        <p className="dlg-note">읽지 않는 열: {ignoredColumns.join(' · ')}</p>
      )}
      <p className="dlg-note">
        가져오기는 <b>온라인일 때만</b> 됩니다. 이미 있는 항목은 덮지 않습니다.
      </p>
    </div>
  );
}
