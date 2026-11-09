/**
 * 설정 화면(승인된 시안 **S**)이 무엇을 담는지 — **목록만** 여기, 그리는 것은
 * `components/Settings.tsx`.
 *
 * 핵심은 한 줄로 말할 수 있다: **설정 화면의 모든 컨트롤은 메뉴와 같은 `Action`을
 * 쓴다.** 그래서
 *
 *   * 누르면 `App`의 같은 `runAction` 한 곳을 지나가고(저장·세션 버리기·테마 규칙이
 *     한 벌이다),
 *   * 보이는 상태는 메뉴의 체크/라디오를 정하는 같은 `itemMark`로 정한다.
 *
 * 즉 "메뉴와 설정 값은 양방향 동기화"(§5)가 **따로 맞춰 주는 코드 없이** 성립한다.
 * 다른 창에서 같은 설정을 열어도 값이 하나인 것은 그 위층(`settings.ts`의
 * `save`/`adopt` + Rust `broadcast_settings`)이 이미 하는 일이다.
 *
 * 시안 S에 그려진 것만 들어 있다. 메뉴에만 있는 것(오버레이 모드, 메모 목록 토글,
 * 형광펜 색)은 **일부러 없다** — 시안에 없는 항목은 더하지 않는다(사용자 규칙 2).
 */

import { FONT_DEFAULT, FONT_SIZES, quoteFamily } from "./fonts";
import type { StrId } from "./i18n";
import { itemMark, type Action, type Menu, type MenuItem, type MenuState } from "./menus";
import { TINT_DOTS } from "./palette";

/** 고르는 줄 하나 — 라벨(문자열 표의 id)과 누르면 일어나는 일. */
export interface PanelChoice {
  label: StrId;
  act: Action;
}

/**
 * `앱 테마` — 어둡게 / 밝게 / 시스템 설정 사용.
 *
 * 세 값은 테마 메뉴의 세 행과 같은 `Action`이다. 라벨만 시안 S의 문구를 쓴다
 * (`시스템` → `시스템 설정 사용`).
 */
export const PANEL_THEMES: readonly PanelChoice[] = [
  { label: "menuThemeDark", act: { t: "theme", value: "dark" } },
  { label: "menuThemeLight", act: { t: "theme", value: "light" } },
  { label: "settingsThemeSystem", act: { t: "theme", value: "system" } },
];

/**
 * 메모지 색 — 맨 앞이 `색 없음`(빈 동그라미, `color: ""`)이고 그 뒤로 4점.
 * 테마 메뉴의 같은 그룹과 같은 행 구성이다(사용자 결정 2026-11-08): 테마를 고르는
 * 일이 색을 지우지 않으므로 색을 끄는 입구가 여기 있어야 한다.
 */
export const PANEL_TINTS: readonly (PanelChoice & { color: string })[] = [
  { label: "memoNone", act: { t: "tint", value: "none" }, color: "" },
  { label: "memoYellow", act: { t: "tint", value: "yellow" }, color: TINT_DOTS.yellow },
  { label: "memoMint", act: { t: "tint", value: "mint" }, color: TINT_DOTS.mint },
  { label: "memoPink", act: { t: "tint", value: "pink" }, color: TINT_DOTS.pink },
  { label: "memoSky", act: { t: "tint", value: "sky" }, color: TINT_DOTS.sky },
];

/** `Inkwell이 시작될 때` — 이전 세션 열기(기본) / 새 세션. */
export const PANEL_STARTUP: readonly PanelChoice[] = [
  { label: "settingsStartupRestore", act: { t: "startup", value: "restore" } },
  { label: "settingsStartupFresh", act: { t: "startup", value: "fresh" } },
];

/**
 * `글꼴 ▾`가 여는 메뉴 — 시안 G1: 맨 위 `기본`(라디오), 구분선, 그 아래 **설치된 글꼴
 * 전부**(가나다순, 스크롤). 각 이름은 **자기 글꼴로** 그린다.
 *
 * 목록은 Rust가 읽어 온 값이라 상수가 아니다 — 그래서 함수다(`components/Settings.tsx`가
 * 받은 목록으로 부른다). 폭 236·스크롤 240은 시안 G1의 수치다.
 */
export const FONT_MENU_WIDTH = 236;
export const FONT_MENU_SCROLL_H = 240;

export function fontMenu(fonts: readonly string[]): Menu {
  const items: MenuItem[] = [
    { kind: "row", label: "settingsFontDefault", act: { t: "font", value: FONT_DEFAULT } },
    { kind: "sep" },
  ];
  for (const name of fonts) {
    items.push({ kind: "row", text: name, font: quoteFamily(name), act: { t: "font", value: name } });
  }
  return {
    title: "settingsFont",
    width: FONT_MENU_WIDTH,
    items,
    // `기본`과 구분선은 제자리, 설치된 글꼴만 구른다(시안 G1).
    scrollFrom: 2,
    scrollH: FONT_MENU_SCROLL_H,
  };
}

/** `크기 ▾` — 메모장과 같은 단계(pt). 목록이 길어 전체가 구른다. */
export const FONT_SIZE_MENU: Menu = {
  title: "settingsFontSize",
  width: 120,
  items: FONT_SIZES.map((pt) => ({
    kind: "row" as const,
    text: String(pt),
    act: { t: "fontSize" as const, value: pt },
  })),
  scrollFrom: 0,
  scrollH: 300,
};

/** `기타` 카드의 토글 두 줄. 둘 다 ☰ › 보기에도 있는 같은 값이다. */
export const PANEL_TOGGLES: readonly PanelChoice[] = [
  { label: "menuStatusBar", act: { t: "toggle", id: "statusBar" } },
  { label: "menuTextBacking", act: { t: "toggle", id: "textBacking" } },
];

/**
 * 이 컨트롤이 켜져 있는가(라디오면 고른 것인가). 메뉴의 체크·라디오·색 네모를 정하는
 * `itemMark`를 그대로 쓴다 — 설정 화면이 메뉴와 **다른 답을 낼 수 없다**.
 */
export function panelOn(act: Action, state: MenuState): boolean {
  const mark = itemMark(act, state);
  return mark !== null && mark.on;
}

/**
 * 메모지 색 줄은 **항상 보인다**(사용자 결정 2026-11-08) — 색은 테마와 무관하게
 * 유지되므로 다크 테마에서도 고르고 끌 수 있어야 한다. 예전의 `밝은 테마에서만 보임`
 * 규칙(`tintRowVisible`)은 없어졌다.
 */
