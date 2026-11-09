/**
 * 테마(어둡게/밝게/시스템) × 메모지 색 — **사용자 결정 2026-11-08**으로 규칙이 바뀌었다.
 *
 * 두 축은 **완전히 독립**이다. 테마는 앱 전체(모든 탭·모든 창)의 값이고, 메모지 색은
 * **탭마다** 갖는 값이다(§5). 색이 있는 탭은 테마를 어둡게로 바꿔도 **그 색 종이를
 * 계속** 보여 준다 — 색 팔레트 넷은 모두 라이트 계열이다.
 *
 *   메모지 색 있음        → 그 색 팔레트 (테마 선택과 무관)
 *   메모지 색 없음 + 어둡게 → 다크 팔레트
 *   메모지 색 없음 + 밝게/시스템(밝음) → 라이트 팔레트
 *
 * 지금 지키는 세 가지 규칙(절대 흩어 놓지 말 것 — 한곳에서 지킨다):
 *   1. 테마를 고르는 일(메뉴·설정·Ctrl+Shift+M)은 **어느 탭의 메모지 색도 건드리지
 *      않는다**. 예전의 "`밝게`를 고르면 색이 지워진다"(수정 10)와 "다크에서 색을
 *      고르면 밝게로 바뀐다"는 두 규칙은 **없어졌다**.
 *   2. 색을 고르는 일은 **테마를 건드리지 않는다** — 색만 바뀐다.
 *   3. 그래서 색을 지우는 입구가 따로 필요하다: 메모지 색 그룹 맨 위의 `색 없음` 행
 *      (☰ 테마 메뉴·설정 화면 둘 다). 메모지 색 선택은 **다크 테마에서도 보인다**.
 *
 * Ctrl+Shift+M은 어둡게 → 밝게 → 시스템 → 어둡게. 메뉴의 행과 같은 경로를 지나가고,
 * 색에는 아무 영향이 없다.
 *
 * 이 파일의 함수는 모두 "현재 값을 받아 다음 값을 돌려주는" 순수 함수다.
 */

import type { Theme } from "./palette";

/** 원본 `ThemeChoice` — 순서가 Ctrl+Shift+M의 순환 순서다. */
export const THEME_CHOICES = ["dark", "light", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** 원본 `MemoTint`. */
export const TINTS = ["none", "yellow", "mint", "pink", "sky"] as const;
export type Tint = (typeof TINTS)[number];

/** 테마 × 메모지 색의 현재 상태. 설정 저장소와 메뉴가 같이 쓰는 모양. */
export interface ThemeState {
  choice: ThemeChoice;
  tint: Tint;
}

/** `시스템`이 실제로 어느 쪽인지까지 반영한 결과. */
export function resolvedChoice(choice: ThemeChoice, osDark: boolean): "dark" | "light" {
  if (choice === "system") return osDark ? "dark" : "light";
  return choice;
}

/**
 * 실제로 칠할 팔레트 이름(`html[data-theme]`에 들어가는 값).
 *
 * 메모지 색이 있으면 **테마와 무관하게** 그 색 팔레트다(사용자 결정 2026-11-08).
 * 색이 없을 때만 테마가 다크/라이트를 정한다.
 */
export function paletteName(choice: ThemeChoice, tint: Tint, osDark: boolean): Theme {
  if (tint !== "none") return tint;
  return resolvedChoice(choice, osDark) === "dark" ? "dark" : "light";
}

/**
 * 테마 메뉴의 행과 Ctrl+Shift+M이 **둘 다** 지나가는 유일한 경로.
 * 테마만 바꾸고 메모지 색은 그대로 둔다.
 */
export function chooseTheme(state: ThemeState, choice: ThemeChoice): ThemeState {
  return { ...state, choice };
}

/** Ctrl+Shift+M (원본 `CycleTheme`). */
export function cycleTheme(state: ThemeState): ThemeState {
  const next = THEME_CHOICES[(THEME_CHOICES.indexOf(state.choice) + 1) % THEME_CHOICES.length];
  return chooseTheme(state, next);
}

/**
 * 메모지 색 하나를 고른 결과. 색만 바뀌고 **테마는 그대로**다 — 다크 테마에서
 * 노랑을 골라도 테마 선택은 `어둡게`로 남고, 그 탭만 노란 종이가 된다.
 */
export function applyTint(state: ThemeState, tint: Tint): ThemeState {
  return { ...state, tint };
}
