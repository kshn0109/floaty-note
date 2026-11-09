/**
 * 본문 글꼴과 글자 크기 — 승인된 시안 **G1**(설정 › 모양 › `글꼴` 카드).
 *
 * 사용자 결정 2026-11-09: 설정 › 글꼴, **기본 = 지금과 똑같음**, 값은 **전역**(모든 창·
 * 모든 탭), 창별 확대/축소(`--zoom`)는 그 위에 **곱해진다**. Windows 11 메모장도
 * `설정 › 글꼴`(글꼴·크기)과 `보기 › 확대/축소`를 따로 둔다.
 *
 * 이 파일은 **순수한 계산뿐이다**(시험: `scripts/fonts.test.ts`). CSS 변수에 심는 일은
 * `App.tsx`, 목록을 Windows에서 읽는 일은 Rust(`src-tauri/src/fonts.rs`)다.
 *
 * 화면에 심는 변수 셋 (`index.css`의 `:root`가 기본값을 들고 있고, 기본이 아닌 값을
 * 고르면 `App`이 `:root`에 덮어쓴다 — 기본으로 돌아오면 **지운다**):
 *   `--doc-font`   마크다운 탭 본문 글꼴 (`.editor`)
 *   `--mono-font`  일반 텍스트 탭 글꼴 (`editor/PlainHost.ts`의 CodeMirror 테마)
 *   `--doc-size`   기본 글자 크기(px). `.editor`가 `calc(var(--doc-size) * var(--zoom))`.
 */

/** `기본`을 나타내는 값 — 빈 문자열이다(설정 파일에도 `""`로 남는다). */
export const FONT_DEFAULT = "";

/**
 * 크기 목록(pt) — Windows 11 메모장 `설정 › 글꼴 › 크기`의 단계 그대로.
 */
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;

/** 기본 크기(pt). 이 값이 **지금과 똑같은 15px**이 되어야 한다(아래 `docSizePx`). */
export const FONT_SIZE_DEFAULT = 11;

/** 기본 크기에서의 본문 px — 지금 `index.css`가 쓰는 값. */
export const DOC_SIZE_DEFAULT = 15;

/**
 * 마크다운 탭의 기본 글꼴 — `index.css`의 `body` 글꼴 그대로(지금 모습).
 * 고른 글꼴은 **이 목록 앞에** 붙는다(폴백을 잃지 않는다).
 */
export const DOC_FONT_FALLBACK = '"Segoe UI", "Malgun Gothic", system-ui, sans-serif';

/** 일반 텍스트 탭의 기본 글꼴 — `index.css`의 `--mono-font` 그대로. */
export const MONO_FONT_FALLBACK =
  'ui-monospace, "Cascadia Mono", Consolas, "Malgun Gothic", monospace';

/**
 * 본문 px = 15 × pt / 11.
 *
 * pt를 CSS px로 옮기는 정식 환산은 `pt × 96/72`(= 11pt → 14.67px)인데, 그러면 **기본
 * 11pt가 지금 모습(15px)과 어긋난다**. 기준점을 `11pt = 15px`으로 잡고 비례시킨다
 * (지시) — 비율이 1.0227배 차이라 다른 단계도 메모장과 거의 같은 크기가 된다.
 *
 * 반올림하지 않는다(소수 둘째 자리까지만 줄인다): 정수로 끊으면 단계마다 오차가
 * 들쭉날쭉해지고, 제목(`em`)과 받침 띠(`em`)가 그 오차를 배로 받는다.
 */
export function docSizePx(pt: number): number {
  const n = Number.isFinite(pt) ? pt : FONT_SIZE_DEFAULT;
  return Math.round(((DOC_SIZE_DEFAULT * n) / FONT_SIZE_DEFAULT) * 100) / 100;
}

/** 저장된 크기를 목록 안으로 — 모르는 값이면 기본. */
export function pickFontSize(value: unknown): number {
  return typeof value === "number" && (FONT_SIZES as readonly number[]).includes(value)
    ? value
    : FONT_SIZE_DEFAULT;
}

/**
 * CSS `font-family`에 넣을 수 있게 이름 하나를 따옴표로 묶는다.
 *
 * 글꼴 이름에는 공백과 한글이 들어가므로 따옴표가 필요하다. 이름은 Windows가 준
 * 글자지만 **CSS로 들어가는 값**이므로 따옴표·역슬래시·제어문자는 지운다(값 주입 차단).
 * 지워서 빈 이름이 되면 빈 문자열이다 — 부르는 쪽이 폴백만 쓴다.
 */
export function quoteFamily(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/["'\\;{}()\u0000-\u001f]/g, "").trim();
  return clean === "" ? "" : `"${clean}"`;
}

/** 마크다운 탭 본문 글꼴 — 고른 글꼴 + 기존 폴백. `기본`이면 폴백 그대로. */
export function docFontCss(family: string): string {
  const head = quoteFamily(family);
  return head === "" ? DOC_FONT_FALLBACK : `${head}, ${DOC_FONT_FALLBACK}`;
}

/**
 * 일반 텍스트 탭 글꼴 — 고른 글꼴 + 기존 고정폭 폴백.
 *
 * 다른 글꼴을 고르면 **마크다운·텍스트 탭 모두** 그 글꼴이다(사용자 결정 2026-11-09 ·
 * 메모장도 글꼴이 하나다). `기본`일 때만 텍스트 탭이 고정폭(Consolas 계열)으로 남는다.
 */
export function monoFontCss(family: string): string {
  const head = quoteFamily(family);
  return head === "" ? MONO_FONT_FALLBACK : `${head}, ${MONO_FONT_FALLBACK}`;
}

/**
 * Rust가 준 날목록 정리 — 드롭다운에 그대로 쓸 수 있는 꼴로.
 *
 *   · `@`로 시작하는 이름은 **뺀다**: 세로쓰기(CJK) 판이라 글자가 눕는다.
 *   · 공백만 있는 이름, 빈 이름은 뺀다.
 *   · 같은 이름은 하나만(대소문자 구분 없이 — GDI는 굵기·기울임마다 같은 가족
 *     이름을 여러 번 돌려줄 수 있다).
 *   · **가나다순**: 한국어 로캘 비교라 한글·영문이 섞여도 사람이 보는 순서다.
 */
export function cleanFontList(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (name === "" || name.startsWith("@")) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, "ko"));
}
