/**
 * 간략 메뉴(시안 C2)의 **단축키 말풍선** — 순수한 계산만. 그리는 일은
 * `components/Popup.tsx`가 한다(시험: `scripts/menuTip.test.ts`).
 *
 * 시안이 정한 규칙 셋이 전부 여기 있다:
 *   1. 마우스를 **0.6초** 머물면 뜬다. 한 번 뜬 뒤 다른 줄로 옮기면 **기다리지 않고**
 *      바로 바뀐다(`warm`). 메뉴를 떠나면 다시 식는다.
 *   2. 자리는 **줄 오른쪽 끝 아래**이고 창 밖으로 나가지 않는다.
 *   3. 낭독기에는 글자가 아니라 `aria-keyshortcuts`로 알린다 — 그 속성은
 *      `Ctrl` 대신 `Control` 같은 **정해진 이름**을 쓴다(WAI-ARIA 1.2).
 */

/** 머물러야 하는 시간(ms) — 시안 C2. */
export const TIP_DELAY = 600;
/** 말풍선과 줄 사이 간격(px). */
export const TIP_GAP = 2;

/** 지금 말풍선을 띄울 때까지 기다릴 시간. 이미 한 번 뜬 상태면 기다리지 않는다. */
export function tipDelay(warm: boolean): number {
  return warm ? 0 : TIP_DELAY;
}

export interface TipAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TipPos {
  left: number;
  top: number;
}

/**
 * 말풍선 자리 — 줄의 **오른쪽 끝에 오른쪽을 맞추고 아래에** 둔다. 창 오른쪽·왼쪽으로
 * 넘치면 안으로 당기고, 아래로 넘치면 줄 **위**로 올린다(그래도 넘치면 안으로 당긴다).
 */
export function tipPosition(
  anchor: TipAnchor,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8
): TipPos {
  const maxLeft = Math.max(vw - w - margin, margin);
  const left = Math.min(Math.max(anchor.right - w, margin), maxLeft);

  let top = anchor.bottom + TIP_GAP;
  if (top + h > vh - margin) top = anchor.top - h - TIP_GAP;
  const maxTop = Math.max(vh - h - margin, margin);
  return { left: Math.round(left), top: Math.round(Math.min(Math.max(top, margin), maxTop)) };
}

/** 메뉴의 단축키 글자(`Ctrl+Shift+S`) → `aria-keyshortcuts`가 쓰는 이름. */
const ARIA_KEY_NAMES: Record<string, string> = {
  Ctrl: "Control",
  Del: "Delete",
  Esc: "Escape",
  Ins: "Insert",
};

/**
 * `aria-keyshortcuts` 값. 조합은 `+`로 나뉘고 수정키 이름만 바꾼다 — `Ctrl+=`처럼
 * 글자가 `=`인 것도 그대로 남는다(`Alt+F4`의 `F4`도 그대로).
 */
export function ariaKeys(key: string): string {
  return key
    .split("+")
    .map((part) => ARIA_KEY_NAMES[part] ?? part)
    .join("+");
}
