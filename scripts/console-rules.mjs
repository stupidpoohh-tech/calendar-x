/**
 * `firestore.rules` 에서 주석을 걷어내 stdout 으로 낸다. 콘솔 붙여넣기용.
 *
 * ── 왜 파일로 두지 않는가 ───────────────────────────────────────
 *
 * 같은 규칙을 레포에 두 벌 두면 한쪽만 고치는 날이 온다. 그리고 그 사고의 결과가
 * "콘솔에 낡은 보안 규칙을 붙여넣는 것" 이라, 눈치채기 전까지 조용히 열려 있게 된다.
 * 그래서 사본을 커밋하지 않고 필요할 때 만든다 — 진실은 `firestore.rules` 하나뿐이다.
 *
 * 콘솔 에디터는 긴 글을 붙여넣을 때 중간부터 들어가는 일이 있다 (앞부분이 잘린 채로
 * 게시하면 `mismatched input '}'` 로 거절된다). 주석이 절반을 차지하므로, 그것만
 * 걷어내면 303줄이 236줄로 줄어 한 번에 들어간다. **동작은 같다** — 주석은 규칙의
 * 판정에 관여하지 않는다.
 *
 *   npm run rules:console                 # 화면으로
 *   npm run rules:console > /tmp/r.rules  # 파일로 (레포 안에 두지 않는다)
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// 블록 주석. 이 파일의 주석에는 `/*` 가 중첩되지 않는다.
let text = src.replace(/\/\*[\s\S]*?\*\//g, '');

// 줄 전체가 주석인 것만 지운다. 줄 끝 주석은 이 파일에 없고, 규칙의 경로
// (`/databases/$(database)/...`)를 주석으로 잘못 읽는 일도 없어야 한다.
const lines = text.split('\n').filter((l) => !l.trim().startsWith('//'));

// 주석을 걷어낸 자리에 빈 줄이 연달아 남는다. 하나로 줄인다.
const out = [];
for (const line of lines) {
  const trimmed = line.trimEnd();
  if (!trimmed && !out.at(-1)?.trim() && out.length > 0) continue;
  out.push(trimmed);
}

text = `${out.join('\n').trim()}\n`;

// 잘린 채로 붙여넣는 것이 애초의 사고였다. 양 끝을 확인하고 아니면 멈춘다.
const first = text.split('\n')[0];
if (first !== "rules_version = '2';") {
  console.error(`첫 줄이 rules_version 이 아닙니다: ${first}`);
  process.exit(1);
}
const opens = (text.match(/{/g) ?? []).length;
const closes = (text.match(/}/g) ?? []).length;
if (opens !== closes) {
  console.error(`중괄호가 맞지 않습니다: { ${opens}개 / } ${closes}개`);
  process.exit(1);
}

process.stdout.write(text);
