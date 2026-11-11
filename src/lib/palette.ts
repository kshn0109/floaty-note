/**
 * 팔레트 — 색 값 자체는 `src/index.css`의 CSS 변수가 진짜 출처다.
 * 여기서는 (1) 팔레트 이름 목록과 (2) 표시 모드·글자 뒤 배경이 실제로 칠할 색을
 * 만들 때 쓰는 보조 함수만 둔다.
 */

export const THEMES = ["dark", "light", "yellow", "mint", "pink", "sky"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * 다크 계열. 반투명 규칙이 다르다(`displayMode.ts`).
 * 메모지 색은 **라이트 전용**이므로 나머지 다섯은 모두 라이트 계열이다.
 */
export const DARK_THEMES: readonly Theme[] = ["dark"];

export function isDarkTheme(theme: Theme): boolean {
  return DARK_THEMES.includes(theme);
}

/**
 * 메모지 색 점 — 탭 색인·메모 목록·테마 메뉴·설정에서 **모든 테마 공통**
 * (MIGRATION_HANDOFF §3). 색 없음은 빈 동그라미라 여기 값이 없다.
 *
 * 시안 `Popups.dc.html`의 테마 메뉴는 종이색(#FFF0A3 등)을 쓰고 있는데, 그 열은
 * "기존 · 비교용"으로 그린 것이고 §3이 색 점 값을 따로 못 박았다. 점 하나가 창의
 * 종이색과 같으면 다크 테마에서 보이지 않으므로 §3 값을 따른다.
 */
export const TINT_DOTS = {
  yellow: "#F2D14B",
  mint: "#6FD99C",
  pink: "#F28FAB",
  sky: "#7FB4FF",
} as const;

/** 형광펜 5색 (고정) — 원본 `kHlColors` 순서. */
export const HIGHLIGHTS = ["#FFEB3B", "#9BF06A", "#FF8AD8", "#7FDBFF", "#FFB14D"] as const;

/** 현재 테마의 CSS 변수 값을 읽는다. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 색 문자열 → [r, g, b]. 배포 빌드는 CSS를 압축하면서 `#ffffff`를 `#fff`로 줄이므로
 * 3·4자리 hex와 `rgb()`도 읽어야 한다(6자리만 읽으면 `#fff`가 빨강이 된다).
 */
export function parseHex(hex: string): [number, number, number] {
  const s = hex.trim();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  let h = s.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).replace(/./g, (c) => c + c);
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

/** `#RRGGBB` + 알파(0~1) → `rgba(r, g, b, a)`. 알파 0은 완전 투명. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `pct`%의 `a` + 나머지 `b`. 원본 `MixRgb`와 같은 정수 연산. */
export function mix(a: string, b: string, pct: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const at = Math.min(Math.max(pct, 0), 100);
  const f = (x: number, y: number) => Math.round((x * at + y * (100 - at)) / 100);
  return `rgb(${f(ar, br)}, ${f(ag, bg)}, ${f(ab, bb)})`;
}

export const OPACITY_MIN = 10;
export const OPACITY_MAX = 100;
/** 휠 한 칸 (원본 `kOpacityStep`). */
export const OPACITY_STEP = 5;
