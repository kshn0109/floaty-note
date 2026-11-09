import { HIGHLIGHTS, cssVar, isDarkTheme, mix, withAlpha, type Theme } from "./palette";

/**
 * 표시 모드 3가지 — 불투명 / 반투명 / 오버레이 (MIGRATION_HANDOFF §4)와
 * 글자 뒤 배경(text backing).
 *
 * 투명해지는 것은 **배경뿐**이다. 본문 글자·버튼 글자·강조색·상태 글자는 늘 100%
 * 불투명하게 남는다. 원본은 배경만 그리는 별도의 반투명 창(`UpdateLayeredWindow`)을
 * 깔아서 그렇게 했지만, 웹에서는 배경색에만 알파를 섞으면 같은 결과가 나온다
 * (글자는 배경의 알파를 물려받지 않는다).
 *
 * R5 배치에서 칠하는 면은 셋뿐이다:
 *   `--bg-field`  창 전체(위 줄 + 편집 영역) — R5는 제목 줄이 종이색이라 같은 면이다
 *   `--bg-bar`    떠 있는 도구 줄과 메모 목록 패널
 *   `--bg-chip`   오버레이에서만 불투명 칩이 되는 것들(탭 알약·창 버튼·상태 글자)
 */

export interface DisplayMode {
  overlay: boolean;
  /** 10~100 (%) */
  opacity: number;
  theme: Theme;
  /** 설정의 "반투명일 때 글자 뒤 배경" 스위치. */
  textBacking: boolean;
  /** 형광펜 색 인덱스 — 글자 뒤 배경 색이 여기서 나온다. */
  highlight: number;
}

/**
 * 이 불투명도 아래에서는 반투명 모드도 오버레이와 같은 글자 뒤 배경을 받는다
 * (원본 `kBackingOpacityMax`). 50%는 라이트의 순검정 글자가 임의의 바탕화면 위에서
 * 4.5:1을 밑도는 지점이다.
 */
const BACKING_OPACITY_MAX = 50;

/** 원본 `TextBackingWanted()`. */
export function textBackingWanted({
  overlay,
  opacity,
  textBacking,
}: Pick<DisplayMode, "overlay" | "opacity" | "textBacking">): boolean {
  if (!textBacking) return false;
  if (overlay) return true;
  return opacity < 100 && opacity <= BACKING_OPACITY_MAX;
}

/**
 * 글자 뒤 배경의 색 — 원본 `BackingTint()`: 형광펜 색을 편집 영역 색에 20%(다크)
 * / 22%(라이트)만 남기고 섞는다. 형광펜 자리처럼 보이되 읽기를 방해하지 않는 값이다.
 */
function backingTint(theme: Theme, highlight: number): string {
  const pen = HIGHLIGHTS[highlight] ?? HIGHLIGHTS[0];
  const field = cssVar("--field");
  return mix(pen, field, isDarkTheme(theme) ? 20 : 22);
}

/** 본문 줄 간격 (시안 A — `index.css`의 `.editor`와 같은 값). */
const LINE_HEIGHT = 1.75;
/** 못 재는 환경(시험용 DOM)에서 쓰는 값 — Segoe UI 기준 반 줄간격. */
const FALLBACK_BLEED = 0.21;
const bleedCache = new Map<string, number>();

/**
 * 받침 띠(와 그것을 덮는 형광펜)의 **세로 여유(em)** = 반 줄간격
 * `(줄 상자 1.75em − 글꼴 상자) / 2`.
 *
 * 글꼴 상자 높이(= 인라인 상자의 배경이 칠해지는 높이, 글꼴의 ascent+descent)는
 * 글꼴마다 다르므로 상수로 박지 않고 **한 번 재서** 쓴다. 비율이라 글자 크기와
 * 무관해서(제목도 같은 비율) em으로 그대로 쓸 수 있다.
 *
 * 글꼴을 인자로 받는 이유: 받침이 인라인(`.backing`)이 된 뒤로 **일반 텍스트 모드의
 * 고정폭 글꼴**도 같은 값이 필요한데, 글꼴 상자가 본문 글꼴(Segoe UI)과 다르다.
 * `family`가 빈 문자열이면 본문 글꼴 그대로 잰다.
 */
function markBleedEm(family: string): number {
  const hit = bleedCache.get(family);
  if (hit !== undefined) return hit;
  let bleed = FALLBACK_BLEED;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;font-size:100px;line-height:1.75;white-space:nowrap";
  if (family) probe.style.fontFamily = family;
  const span = document.createElement("span");
  span.textContent = "Xg";
  probe.appendChild(span);
  document.body.appendChild(probe);
  // 인라인 요소의 사각형 높이 = 글꼴 상자(줄 간격과 무관하다).
  const ratio = span.getBoundingClientRect().height / 100;
  probe.remove();
  if (ratio > 0.5 && ratio < LINE_HEIGHT) bleed = (LINE_HEIGHT - ratio) / 2;
  bleedCache.set(family, bleed);
  return bleed;
}

export function applyDisplayMode(mode: DisplayMode): void {
  const { overlay, opacity, theme, highlight } = mode;
  const root = document.documentElement.style;
  const bar = cssVar("--bar");
  const field = cssVar("--field");

  // 글자 뒤 배경은 모드와 테마와 펜 색에만 달려 있다 — 어느 모드에서나 같은 식.
  root.setProperty(
    "--text-backing",
    textBackingWanted(mode) ? backingTint(theme, highlight) : "transparent"
  );
  // 받침 띠를 줄 상자 높이로 만들고 형광펜이 그것을 완전히 덮게 하는 세로 여유 —
  // `index.css`의 `.backing` · `mark` 규칙이 쓴다. 글꼴이 둘이라 값도 둘이다.
  // 본문 글꼴은 설정에서 바뀔 수 있다(시안 G1) — 그래서 `--doc-font`를 **재서** 쓴다.
  // `bleedCache`가 글꼴 이름으로 묶여 있으므로 글꼴이 바뀌면 저절로 다시 잰다.
  root.setProperty("--backing-bleed", `${markBleedEm(cssVar("--doc-font")).toFixed(4)}em`);
  root.setProperty("--backing-bleed-mono", `${markBleedEm(cssVar("--mono-font")).toFixed(4)}em`);

  if (overlay) {
    // 배경 완전 투명. 떠 있는 도구 줄과 메모 목록은 불투명하게 남는다 — 오버레이의
    // 요점은 "글만 남는 것"이지만 누를 수 있는 것이 하나도 없으면 모드를 끌 수가 없다.
    // 탭 알약·창 버튼·상태 글자는 불투명 칩이 되어 계속 눌린다(시안 R5 오버레이 규칙).
    root.setProperty("--bg-field", "transparent");
    root.setProperty("--bg-bar", bar);
    root.setProperty("--bg-chip", bar);
    return;
  }

  const alpha = Math.min(Math.max(opacity, 0), 100) / 100;
  // 모든 테마(다크·라이트·메모지 색) 공통: 편집 영역과 도구 줄이 둘 다 슬라이더를
  // 그대로 따라간다. 사용자 결정(2026-11-07) — 원본의 라이트 규칙(도구 줄 불투명,
  // 편집 영역 하한 85%)은 쓰지 않는다.
  root.setProperty("--bg-field", withAlpha(field, alpha));
  root.setProperty("--bg-bar", withAlpha(bar, alpha));
  root.setProperty("--bg-chip", "transparent");
}
