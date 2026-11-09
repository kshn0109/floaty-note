/**
 * 글자 크기(확대/축소) — **Windows 11 메모장과 같은 규칙**.
 *
 * 메모장이 하는 것:
 *   · Ctrl+휠 · Ctrl+`+` / Ctrl+`-`로 **본문 글자만** 키우고 줄인다(창 UI는 그대로).
 *   · Ctrl+0이 100%로 돌아온다.
 *   · 상태 표시줄에 퍼센트를 보여 주고, **100%일 때는 보여 주지 않는다**.
 *   · 값은 **창 하나의 성질**이다 — 그 창의 모든 탭이 같은 배율을 쓰고, 다른 창에는
 *     번지지 않는다(오버레이·불투명도·테이프와 같은 부류 → 세션의 창 기록에 저장).
 *
 * 메모장의 범위는 10%~500%이고 한 걸음은 10%다(지시). 단계는 10의 배수로 **맞춘다**:
 * 세션에서 115%가 돌아와도 한 번 누르면 120%/110%가 되어야 걸음이 흔들리지 않는다.
 *
 * 이 파일은 **순수한 계산뿐이다**(시험: `scripts/zoom.test.ts`). CSS 변수에 심는 일과
 * 키·휠을 받는 일은 `App.tsx`가 한다.
 */

export const ZOOM_MIN = 10;
export const ZOOM_MAX = 500;
export const ZOOM_DEFAULT = 100;
/** 한 걸음(%) — 메모장과 같다. */
export const ZOOM_STEP = 10;

/** 범위 안으로 당기고 정수로 만든다. 숫자가 아니면 100%. */
export function clampZoom(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : ZOOM_DEFAULT;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
}

/**
 * 한 걸음 — `dir`이 1이면 확대, -1이면 축소. 10의 배수로 맞춘 뒤 한 칸 움직인다.
 * 끝에 닿으면 끝 값에 머문다(메모장과 같다: 더 눌러도 아무 일도 없다).
 */
export function zoomStep(current: number, dir: 1 | -1): number {
  const now = clampZoom(current);
  const next =
    dir > 0
      ? Math.floor(now / ZOOM_STEP) * ZOOM_STEP + ZOOM_STEP
      : Math.ceil(now / ZOOM_STEP) * ZOOM_STEP - ZOOM_STEP;
  return clampZoom(next);
}

/** 확대/축소/복원 중 무엇을 하라는 키인가. 해당 없으면 `null`. */
export type ZoomKey = "in" | "out" | "reset";

/** `KeyboardEvent`에서 이 함수가 보는 것만(시험이 가짜 이벤트를 만들 수 있게). */
export interface ZoomChord {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  code: string;
}

/**
 * 메모장과 같은 단축키:
 *   확대  Ctrl+`=` · Ctrl+Shift+`=`(= Ctrl+`+`) · Ctrl+숫자패드 `+`
 *   축소  Ctrl+`-` · Ctrl+숫자패드 `-`
 *   복원  Ctrl+0 · Ctrl+숫자패드 0
 *
 * `Shift`를 확대에서만 허용하는 이유: 미국식 자판에서 `+`는 `Shift+=`라 **같은 키**다.
 * `Ctrl+Shift+-`나 `Ctrl+Shift+0`은 메모장에 없는 조합이므로 받지 않는다.
 * Alt가 끼면 전부 아니다(Ctrl+Alt는 AltGr이다).
 */
export function matchZoomKey(e: ZoomChord): ZoomKey | null {
  if (!e.ctrlKey || e.altKey) return null;
  switch (e.code) {
    case "Equal":
    case "NumpadAdd":
      return "in";
    case "Minus":
    case "NumpadSubtract":
      return e.shiftKey ? null : "out";
    case "Digit0":
    case "Numpad0":
      return e.shiftKey ? null : "reset";
    default:
      return null;
  }
}

/** 상태 글자에 붙일 조각. 100%면 빈 문자열(= 붙이지 않는다 — 메모장과 같다). */
export function zoomLabel(zoom: number): string {
  const z = clampZoom(zoom);
  return z === ZOOM_DEFAULT ? "" : `${z}%`;
}

/** CSS 변수 `--zoom`에 넣는 값(배수). 본문 15px × 이 값이 글자 크기다. */
export function zoomScale(zoom: number): number {
  return clampZoom(zoom) / 100;
}

/**
 * 확대/축소 뒤 스크롤을 **얼마나 더 내려야** 읽던 줄이 제자리로 오는가.
 *
 * 메모장처럼 **맨 위에 보이던 줄을 그 자리에 둔다**: 커서로 뛰지 않는다(`DocHost.
 * captureTopAnchor`/`restoreTopAnchor`가 양쪽 엔진에서 이 값을 쓴다).
 *   · `now`    확대 뒤 그 줄의 윗변이 스크롤 영역 윗변에서 몇 px 아래인가.
 *   · `before` 확대 **전**의 같은 값(위로 걸쳐 있었으면 음수).
 *   · `scale`  새 배율 ÷ 옛 배율 — 걸쳐 있던 양도 글자와 같이 커진다.
 * 스크롤을 늘리면 줄이 올라가므로(`now`가 줄어든다) 차이를 그대로 더하면 된다.
 */
export function anchorShift(now: number, before: number, scale: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(before) || !Number.isFinite(scale)) return 0;
  return now - before * scale;
}
