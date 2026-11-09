/**
 * 탭 떼어내기 · 합치기의 **판정**만 모아 둔 곳 (§5).
 *
 * 이 파일은 React도 Tauri도 모른다 — 좌표와 상자뿐이라 단위 시험으로 지킨다. 끌기의
 * 흐름(고스트 창·전역 커서·문서 이전)은 `App.tsx`와 `lib/winmgr.ts`가 하고, "지금
 * 떼어내기로 바뀌었는가"와 "커서가 어느 창의 몇 번째 자리인가"만 여기서 답한다.
 *
 * 규칙은 원본 Win32 설계(`NEXT_SESSION.md`「설계: 다중 창」5-A)의 것을 그대로 옮겼다:
 *
 *   * 누른 자리에서 **축을 가로질러 14px** 넘게 움직이거나, 포인터가 **탭 줄 밖으로
 *     6px** 넘게 나가면 떼어내기가 시작된다(그 전까지는 줄 안의 순서 바꾸기다).
 *   * 놓을 때 커서가 **어느 Inkwell 창의 탭 줄** 위면 그 창의 그 자리에 들어간다.
 *     탭 줄이 겹치면 **마지막으로 활성이던 창**이 이긴다(Rust `window_drop_zones`가
 *     그 순서로 준다). 원본은 z순서를 썼지만 Tauri에는 z순서를 묻는 길이 없다.
 *   * 어느 줄도 아니면 `null` — 부르는 쪽이 새 창을 만든다.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 알약 줄은 가로, 메모 목록은 세로로 쌓인다. */
export type Axis = "x" | "y";

/**
 * 창 하나의 탭 줄. 좌표는 **화면 물리 픽셀**이다(Rust의 커서 좌표와 같은 계).
 * 창마다 자기 것을 `window_set_drop_zone`으로 올려 두고, 끌기를 시작할 때 전부 가져온다.
 */
export interface DropZone {
  label: string;
  strip: Box;
  /** 보이는 탭의 상자, 줄 순서대로. */
  tabs: Box[];
  axis: Axis;
}

export interface DropTarget {
  label: string;
  /** 들어갈 자리(0 ~ 탭 수). 끌고 있는 탭이 빠진 **뒤**의 자리가 아니라 보이는 그대로다. */
  index: number;
}

/** 축을 가로지른 거리가 이보다 크면 떼어내기(원본 `kTabTearThreshDip`). */
export const TEAR_CROSS = 14;
/** 탭 줄 바깥 여유. 줄 가장자리에서 흔들리는 포인터로 떼어내기가 켜지지 않게. */
export const TEAR_SLACK = 6;

export function boxContains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
}

function inflate(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 };
}

/**
 * 끌기가 **떼어내기로 바뀌었는가**. 좌표계는 부르는 쪽의 것 하나면 된다(지금은 끌고
 * 있는 창의 클라이언트 CSS 픽셀) — 세 값이 같은 계면 답이 같다.
 */
export function tearStarted(
  axis: Axis,
  pos: { x: number; y: number },
  press: { x: number; y: number },
  strip: Box
): boolean {
  const cross = axis === "x" ? Math.abs(pos.y - press.y) : Math.abs(pos.x - press.x);
  if (cross > TEAR_CROSS) return true;
  return !boxContains(inflate(strip, TEAR_SLACK), pos.x, pos.y);
}

/**
 * 커서가 그 줄의 몇 번째 자리에 들어가는가. 탭의 **가운데를 지나면 그 뒤**다
 * (끌기 중에 자리 표시를 그리므로 원본의 "이웃을 지나면 바로 바꾼다"와 달리 가운데를 본다 —
 * 표시가 있으면 가운데 기준이 눈에 맞는다).
 */
export function insertIndexIn(zone: DropZone, x: number, y: number): number {
  const pos = zone.axis === "x" ? x : y;
  for (let i = 0; i < zone.tabs.length; i += 1) {
    const b = zone.tabs[i];
    const mid = zone.axis === "x" ? b.x + b.w / 2 : b.y + b.h / 2;
    if (pos < mid) return i;
  }
  return zone.tabs.length;
}

/**
 * 커서가 어느 창의 탭 줄 위인가. `zones`는 **이기는 순서**(마지막 활성 창이 앞)로 온다.
 * 어느 줄도 아니면 `null`.
 */
export function dropTargetAt(
  x: number,
  y: number,
  zones: readonly DropZone[]
): DropTarget | null {
  for (const zone of zones) {
    if (boxContains(zone.strip, x, y)) {
      return { label: zone.label, index: insertIndexIn(zone, x, y) };
    }
  }
  return null;
}

/**
 * 떼어낸 탭을 **새 창**으로 만들 때 그 창의 자리. 커서 아래에 그 탭이 그대로 오도록
 * 끌고 있던 창의 크기를 그대로 쓰고, 잡은 자리(`grab`)와 탭 줄 안 탭의 위치(`tabOffset`)를
 * 빼서 창의 왼쪽 위를 구한다. 전부 **물리 픽셀**이다.
 */
export function newWindowRect(
  cursor: { x: number; y: number },
  grab: { x: number; y: number },
  tabOffset: { x: number; y: number },
  size: { w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(cursor.x - grab.x - tabOffset.x),
    y: Math.round(cursor.y - grab.y - tabOffset.y),
    w: size.w,
    h: size.h,
  };
}
