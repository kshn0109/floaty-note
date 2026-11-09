/**
 * 떠 있는 도구 줄의 **자리 계산** — 승인된 시안 N2b(넘치면 `⋯`로 접기)와
 * 상태 글자 겹침 판정.
 *
 * 이 파일은 순수한 계산뿐이다(시험: `scripts/dockFit.test.ts`). 측정(ResizeObserver)과
 * DOM은 `components/ToolDock.tsx`·`App.tsx`가 한다.
 *
 * **왜 DOM을 재지 않고 상수로 계산하는가.** 접기 판단이 "접힌 뒤의 DOM 폭"에 다시
 * 기대면 접었다 펴는 되풀이가 생긴다(예전에 ResizeObserver 안에서 setState를 해서
 * `Maximum update depth exceeded`가 났던 그 모양). 버튼 크기는 시안이 못 박은 값이라
 * (30×28 · 구분선 1×18 여백 3 · 간격 2 · 안쪽 0 5) 상수로 적을 수 있고, 그러면
 * **바뀌는 입력은 쓸 수 있는 폭 하나뿐**이라 판단이 단조롭고 안정하다.
 */

/**
 * 접을 수 있는 버튼 — **접는 순서대로**(시안 L1: ◐ → 취소선 → 표 → •≡ → H ▾).
 * ☰ · B · 형광펜은 끝까지 남는다.
 *
 * `⚙`는 2026-11-09 사용자 결정으로 도구 줄에서 **빠졌다**(설정은 ☰ 메뉴에 있다).
 * 그 자리를 글머리 기호 전용 버튼(`bullet`)이 받았고 줄 폭은 그대로다(둘 다 30px).
 */
export const FOLD_ORDER = ["opacity", "strike", "table", "bullet", "heading"] as const;
export type FoldItem = (typeof FOLD_ORDER)[number];

/** 버튼 사이 간격(시안 R5). */
export const DOCK_GAP = 2;
/** 안쪽 여백 0 5 + 1px 테두리 둘. */
export const DOCK_FRAME = 12;
/** 줄 양쪽에 남기는 여백 — `max-width: calc(100% - 16px)`의 그 16. */
export const DOCK_MARGIN = 16;

/** 30×28 버튼 하나(☰ · B · 형광펜 · •≡ · 표 · 취소선 · ⋯). */
const W_BTN = 30;
/** 구분선 1px + 좌우 여백 3. */
const W_SEP = 7;

/**
 * `H ▾` 칩 — 폭이 글자에 따라 늘어난다(`padding: 0 7`). 제목 안이면 `H2 ▾`로 한 자
 * 늘어난다.
 *
 * **시안의 산수와 몇 px 다르다.** 시안 N2b는 자연 폭을 314로 적으며 `H ▾ = 32`,
 * `◐ 80% = 58`을 전제하는데, WebView2가 실제로 그리는 폭은 `H ▾` 37.1 · `H1 ▾` 42.0 ·
 * `◐ 80%` 54.8 · `◐ 100%` 61.2였다(점검 인스턴스 실측). 접는 시점은 그 실측에
 * 맞춘다 — 시안의 32를 그대로 쓰면 "들어간다"고 판단해 놓고 실제로는 ⚙가 몇 px
 * 잘린다. 올림 쪽으로 1~2px 더 잡아 **늦게 접는 일이 없게** 한다.
 */
function headingWidth(heading: number): number {
  return heading > 0 ? 43 : 38;
}

/** `◐ NN%` 칩 — 실측 54.8(두 자리) · 61.2(100%). */
function opacityWidth(opacity: number): number {
  return opacity >= 100 ? 62 : 56;
}

export interface DockMetrics {
  /**
   * 줄이 쓸 수 있는 폭(px) = 담는 칸(`.content` — 메모 목록은 이미 빠져 있다)의
   * 폭 − `DOCK_MARGIN`.
   */
  avail: number;
  /** ◐ 칩에 적히는 값(폭이 글자 수를 따른다). */
  opacity: number;
  /** 커서가 있는 제목 단계(0 = 본문) — `H ▾` 칩의 폭. */
  heading: number;
  /** 오버레이에서는 ◐ 칩이 아예 없다(원본과 같다) — 접을 것도 없다. */
  overlay: boolean;
}

export interface DockLayout {
  /** 접힌 버튼들(접힌 순서). **비어 있으면 `⋯`가 없다** — 승인된 R5 모양 그대로. */
  folded: FoldItem[];
  /** 그 상태의 줄 폭(px). 보고와 시험에 쓴다. */
  width: number;
}

/** 어떤 버튼들을 접었을 때의 줄 폭. 시안 N2b의 폭 계산과 같은 식이다. */
export function dockWidth(m: DockMetrics, folded: readonly FoldItem[]): number {
  const gone = (item: FoldItem): boolean => folded.includes(item);
  // 시안 L1의 순서: ☰ | B 형광펜 H▾ •≡ 표 S | ◐ (+ 접힌 것이 있으면 끝에 ⋯)
  const slots: number[] = [W_BTN, W_SEP, W_BTN, W_BTN];
  if (!gone("heading")) slots.push(headingWidth(m.heading));
  if (!gone("bullet")) slots.push(W_BTN);
  if (!gone("table")) slots.push(W_BTN);
  if (!gone("strike")) slots.push(W_BTN);
  slots.push(W_SEP);
  if (!m.overlay && !gone("opacity")) slots.push(opacityWidth(m.opacity));
  if (folded.length > 0) slots.push(W_BTN);
  const sum = slots.reduce((a, b) => a + b, 0);
  return sum + DOCK_GAP * (slots.length - 1) + DOCK_FRAME;
}

/**
 * 들어갈 때까지 **끝에서부터** 접는다. 다 접어도 모자라면 거기서 멈춘다 —
 * ☰ · B · 형광펜은 접지 않기로 했으므로 더 내줄 것이 없다(그때는 줄이 창보다
 * 조금 넓지만 ☰가 가장 왼쪽에 있어 메뉴로 모든 명령에 닿는다).
 */
export function dockLayout(m: DockMetrics): DockLayout {
  const foldable = FOLD_ORDER.filter((item) => !(item === "opacity" && m.overlay));
  let folded: FoldItem[] = [];
  let width = dockWidth(m, folded);
  for (const item of foldable) {
    if (width <= m.avail) break;
    folded = [...folded, item];
    width = dockWidth(m, folded);
  }
  return { folded, width };
}

// ---------------------------------------------------------------------------
// 상태 글자(오른쪽 아래)와 도구 줄의 겹침
// ---------------------------------------------------------------------------

export interface FitRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 둘 사이에 최소한 남겨야 하는 틈(px). */
export const STATUS_GAP = 8;

/**
 * 상태 글자를 숨길 것인가 — **실제로 겹칠 때만** 숨긴다.
 *
 * 창 폭으로 자르는 고정 경계(예전 `@media (max-width: 420px)`)로는 맞출 수 없다:
 * 도구 줄의 폭이 메모 목록·N2b 접기·◐ 글자 수에 따라 달라지고, 상태 글자의 폭도
 * 인코딩·줄바꿈·배율 조각에 따라 달라진다. 그래서 두 사각형을 그대로 비교한다.
 *
 * 숨기는 방법이 `visibility`여야 한다(`display: none`이 아니다): 사라지면 사각형이
 * 0이 되어 "겹치지 않음 → 다시 보임 → 겹침"이 무한히 돈다.
 */
export function statusCollides(
  dock: FitRect | null,
  status: FitRect | null,
  gap: number = STATUS_GAP
): boolean {
  if (dock === null || status === null) return false;
  if (dock.right - dock.left <= 0 || status.right - status.left <= 0) return false;
  const vertical = dock.top < status.bottom && status.top < dock.bottom;
  const horizontal = status.left < dock.right + gap && dock.left < status.right + gap;
  return vertical && horizontal;
}

// ---------------------------------------------------------------------------
// ☰ 를 키보드로 여는 키
// ---------------------------------------------------------------------------

/** `KeyboardEvent`에서 이 함수가 보는 것만(시험이 가짜 이벤트를 만들 수 있게). */
export interface DockMenuChord {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
}

/**
 * **F10** — Windows의 관례다(메모장도 F10·Alt로 자기 메뉴 바를 띄운다). R5에는 메뉴
 * 바가 없고 ☰ 하나뿐이라 F10이 그 ☰를 연다.
 *
 * `Shift+F10`은 받지 않는다 — Windows에서 그것은 **상황에 맞는 메뉴**(우클릭)다.
 * Ctrl·Alt가 섞인 것도 받지 않는다. Alt 한 번만 누르는 것은 **넣지 않았다**:
 * Alt+Space(시스템 메뉴)·Alt+F4·IME 조합과 같은 키라 "다른 키 없이 뗐는가"를
 * 추적해야 하고, 그 판단이 틀리면 창이 닫히거나 한글 입력이 끊긴다.
 */
export function isDockMenuKey(e: DockMenuChord): boolean {
  return (
    e.code === "F10" && !e.ctrlKey && !e.altKey && !e.shiftKey && e.metaKey !== true
  );
}
