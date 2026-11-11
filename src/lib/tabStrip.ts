/**
 * 알약 탭 줄의 넘침 계산과 메모 목록의 단계 판정 — **순수 함수만** 모아 둔다.
 * (화면은 `TitleBar`·`NoteList`가 그리고, 시험은 여기만 본다.)
 *
 * ## 왜 필요한가 (사용자 보고 3)
 *
 * 넘침 규칙은 원본 `LayoutTabs`와 같다: 먼저 알약을 **줄이고**(이름 `…`), 그래도
 * 모자라면 `◀ ▶`로 **스크롤**한다. 스크롤 영역은 `overflow: hidden`이라 끝에서 알약이
 * **반쯤 잘린 채** 보였다 — 사용자가 "창을 줄이면 탭이 잘린다"고 한 것이 이것이다.
 *
 * 그래서 두 가지를 여기서 정한다.
 *   1) `clippedPills` — 지금 스크롤 위치에서 **온전히 보이지 않는 알약**. 그 알약은
 *      `visibility: hidden`으로 숨긴다(자리는 그대로 두므로 끌기 좌표 계산
 *      (`dropIndex`)과 순서가 하나도 흔들리지 않는다). 그래서 보이는 알약은 **늘
 *      온전하거나 `…`로 줄어 있다.**
 *   2) `pageScroll` — `◀ ▶`가 **알약 경계에 딱 맞게** 멈추는 다음 스크롤 위치.
 *      아무 데나 멈추면 왼쪽 끝 알약이 잘리므로 화살표가 직접 자리를 고른다
 *      (CSS `scroll-snap`에 기대지 않는다 — 프로그램 스크롤에서의 동작이 보장되지 않는다).
 *
 * 길이는 모두 **알약 줄의 내용 좌표(px)**다: `알약.left - 줄.left + 줄.scrollLeft`.
 */

/** 알약 하나가 차지하는 내용 좌표 범위. 순서대로 들어온다. */
export interface Span {
  start: number;
  end: number;
}

/** 재는 값이라 소수점이 흔들린다 — 이만큼은 같다고 본다. */
const EPS = 0.5;

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, Math.max(0, max)));
}

/**
 * 지금 스크롤 위치에서 **숨길 알약**(= 온전히 보이지 않는 알약).
 *
 * 하나도 온전히 보이지 않으면(줄보다 알약 하나가 더 넓은 아주 좁은 창) **맨 앞의
 * 걸친 알약 하나는 남긴다** — 그마저 숨기면 탭 줄이 텅 비어 어느 메모인지 알 수 없다.
 */
export function clippedPills(
  spans: readonly Span[],
  viewWidth: number,
  scrollLeft: number
): boolean[] {
  const left = scrollLeft;
  const right = scrollLeft + viewWidth;
  const hidden = spans.map((s) => !(s.start >= left - EPS && s.end <= right + EPS));
  if (hidden.length > 0 && hidden.every((h) => h)) {
    const first = spans.findIndex((s) => s.end > left + EPS);
    if (first >= 0) hidden[first] = false;
  }
  return hidden;
}

/**
 * `◀`(dir = -1) / `▶`(dir = +1)를 눌렀을 때의 새 `scrollLeft`.
 * 늘 **어떤 알약의 왼쪽 끝**이고(끝까지 간 경우만 예외 — 그때는 오른쪽이 딱 맞는다),
 * 더 갈 곳이 없으면 지금 값을 그대로 돌려준다.
 */
export function pageScroll(
  spans: readonly Span[],
  viewWidth: number,
  scrollLeft: number,
  dir: 1 | -1,
  maxScroll: number
): number {
  if (spans.length === 0) return scrollLeft;

  if (dir > 0) {
    // 오른쪽: **아직 온전히 보이지 않는 첫 알약**을 왼쪽 끝으로 데려온다.
    const next = spans.find((s) => s.end > scrollLeft + viewWidth + EPS);
    if (!next) return scrollLeft;
    return clamp(next.start, maxScroll);
  }

  // 왼쪽: 한 화면만큼 되돌아간 자리에서 시작하는 첫 알약.
  const want = scrollLeft - viewWidth;
  let target = 0;
  for (const s of spans) {
    if (s.start >= want - EPS) {
      target = s.start;
      break;
    }
  }
  if (target >= scrollLeft - EPS) {
    // 한 알약도 못 갔다 → 지금 왼쪽 알약의 **앞 알약**으로.
    target = 0;
    for (const s of spans) {
      if (s.start < scrollLeft - EPS) target = s.start;
    }
  }
  return clamp(target, maxScroll);
}

/**
 * 탭 줄 위의 **마우스 휠** 방향 (사용자 확정 2026-11-10).
 *
 * 휠은 `◀ ▶` 버튼과 **정확히 같은 기능**이다: 한 칸 = 화살표 한 번 클릭 → `pageScroll`.
 * 그래서 여기서는 방향만 고르고 자리 계산은 `pageScroll` 하나가 한다(길이 둘이면
 * 둘이 어긋난다). **활성 탭은 바뀌지 않는다** — 줄을 좌우로 넘겨 보는 것뿐이다.
 *
 * 아래/오른쪽 = `+1`, 위/왼쪽 = `-1`. 가로 휠(`deltaX`)도 받고, 터치패드처럼 두 축이
 * 같이 올 때는 **큰 쪽**을 따른다. 0이면 `0`(아무 일도 하지 않는다).
 */
export function wheelDir(deltaX: number, deltaY: number): 1 | -1 | 0 {
  const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (d === 0) return 0;
  return d > 0 ? 1 : -1;
}

/**
 * 활성 알약을 보이게 하는 `scrollLeft`. 이미 온전히 보이면 그대로 둔다.
 * (메모 목록·막대나 Ctrl+Tab으로 **안 보이는 탭을 고를 수 있어야** 하므로 필요하다.)
 */
export function scrollToPill(
  spans: readonly Span[],
  viewWidth: number,
  scrollLeft: number,
  index: number,
  maxScroll: number
): number {
  const span = spans[index];
  if (!span) return scrollLeft;
  if (span.start >= scrollLeft - EPS && span.end <= scrollLeft + viewWidth + EPS) return scrollLeft;
  return clamp(span.start, maxScroll);
}

/**
 * 메모 목록이 보이는 단계 (사용자 보고 2).
 *
 * 전에는 창이 좁으면 목록을 **아예 숨겼다**. 사용자는 좁은 창에서도 목록이 보이기를
 * 원하므로, 좁으면 **색 점만 보이는 좁은 막대**(`rail`)로 접는다 — 켜 둔 목록은 어떤
 * 폭에서도 사라지지 않는다.
 *
 * ## 켜고 끄기는 **한 가지 토글뿐**이다 (사용자 보고 4)
 *
 * 전에는 좁은 창에서 막대 머리 버튼이 목록을 **펼쳤고**(`expanded`), 그래서 목록을
 * 끌 수가 없이 막대 ↔ 제 폭 목록만 오갔다. 이제 목록 버튼·☰ › 보기 › 메모 목록·
 * 목록 머리 버튼이 **모두 켜기/끄기**이고, 켜져 있을 때의 모양은 **창 폭만으로**
 * 정해진다(좁으면 막대, 넓으면 168 목록). 좁은 창에서 억지로 펼치는 단계는 없다.
 */
export type ListMode = "off" | "rail" | "full";

/** 제 폭(168) 목록을 켤 수 있는 첫 창 폭. 목록 168 + 편집 영역 310. */
export const LIST_FULL_MIN_WIDTH = 480;

export function listMode(on: boolean, winWidth: number): ListMode {
  if (!on) return "off";
  return winWidth >= LIST_FULL_MIN_WIDTH ? "full" : "rail";
}
