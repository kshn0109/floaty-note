/**
 * 알약 탭 줄의 넘침 판정과 메모 목록 단계 (사용자 보고 2·3).
 *
 * 화면이 아니라 **숫자 판정**만 본다: 어느 알약이 반쯤 잘렸는가, 화살표가 어디에
 * 멈추는가, 창 폭에 따라 목록이 어떤 모양인가. 보임새는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import {
  clippedPills,
  listMode,
  pageScroll,
  scrollToPill,
  LIST_FULL_MIN_WIDTH,
  type Span,
} from "../src/lib/tabStrip";

/** 폭이 같은 알약 n개 (간격 4). */
function pills(n: number, width = 100, gap = 4): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < n; i += 1) {
    const start = i * (width + gap);
    out.push({ start, end: start + width });
  }
  return out;
}

describe("잘린 알약 숨기기", () => {
  it("다 들어가면 아무것도 숨기지 않는다", () => {
    expect(clippedPills(pills(3), 400, 0)).toEqual([false, false, false]);
  });

  it("오른쪽 끝에 걸친 알약만 숨긴다", () => {
    // 폭 250: [0,100] 온전, [104,204] 온전, [208,308]은 250에서 잘린다.
    expect(clippedPills(pills(3), 250, 0)).toEqual([false, false, true]);
  });

  it("왼쪽으로 지나간 알약도 숨긴다", () => {
    expect(clippedPills(pills(3), 210, 104)).toEqual([true, false, false]);
  });

  it("알약이 줄보다 넓으면 **맨 앞의 걸친 알약 하나는 남긴다**", () => {
    // 60px 줄에 100px 알약 — 다 숨기면 탭 줄이 텅 빈다.
    expect(clippedPills(pills(3), 60, 0)).toEqual([false, true, true]);
    expect(clippedPills(pills(3), 60, 120)).toEqual([true, false, true]);
  });

  it("탭이 없으면 빈 답", () => {
    expect(clippedPills([], 300, 0)).toEqual([]);
  });
});

describe("◀ ▶ — 알약 경계에 맞춰 멈춘다", () => {
  const spans = pills(5); // 내용 폭 = 5*100 + 4*4 = 516
  const view = 250;
  const max = 516 - view;

  it("▶는 아직 온전히 안 보이는 첫 알약을 왼쪽 끝으로 데려온다", () => {
    expect(pageScroll(spans, view, 0, 1, max)).toBe(208);
    expect(pageScroll(spans, view, 208, 1, max)).toBe(max); // 끝에서는 끝까지만
  });

  it("끝에 닿았으면 더 가지 않는다", () => {
    expect(pageScroll(spans, view, max, 1, max)).toBe(max);
  });

  it("◀는 한 화면쯤 되돌아가 알약 왼쪽 끝에 멈춘다", () => {
    expect(pageScroll(spans, view, 312, -1, max)).toBe(104);
    expect(pageScroll(spans, view, 104, -1, max)).toBe(0);
    expect(pageScroll(spans, view, 0, -1, max)).toBe(0);
  });

  it("한 알약도 못 갈 자리에서는 앞 알약으로 물러난다", () => {
    // 줄이 넓어서 한 화면 되돌리면 0보다 작아지는 경우.
    expect(pageScroll(spans, 500, 104, -1, 16)).toBe(0);
  });
});

describe("활성 알약 보이게 하기", () => {
  const spans = pills(5);

  it("이미 온전히 보이면 그대로 둔다", () => {
    expect(scrollToPill(spans, 250, 0, 1, 266)).toBe(0);
  });

  it("오른쪽에 있으면 그 알약 왼쪽 끝으로 민다", () => {
    expect(scrollToPill(spans, 250, 0, 4, 266)).toBe(266); // 416을 끝까지로 당긴다
    expect(scrollToPill(spans, 250, 0, 2, 266)).toBe(208);
  });

  it("왼쪽으로 지나갔으면 되돌린다", () => {
    expect(scrollToPill(spans, 250, 300, 0, 266)).toBe(0);
  });

  it("없는 자리는 아무것도 하지 않는다", () => {
    expect(scrollToPill(spans, 250, 42, 9, 266)).toBe(42);
  });
});

describe("메모 목록 단계", () => {
  it("꺼 두면 폭과 무관하게 꺼짐", () => {
    expect(listMode(false, 1200)).toBe("off");
    expect(listMode(false, 200)).toBe("off");
  });

  it("넓으면 제 폭 목록", () => {
    expect(listMode(true, LIST_FULL_MIN_WIDTH)).toBe("full");
    expect(listMode(true, 1200)).toBe("full");
  });

  it("좁으면 **숨지 않고** 색 점 막대로 접힌다", () => {
    expect(listMode(true, LIST_FULL_MIN_WIDTH - 1)).toBe("rail");
    expect(listMode(true, 180)).toBe("rail");
    expect(listMode(true, 100)).toBe("rail");
  });

  // 사용자 보고 4: 켜져 있을 때의 모양은 **창 폭만으로** 정해진다 — 좁은 창에서
  // 억지로 펼치는 단계가 없으므로 같은 폭이면 늘 같은 답이다.
  it("폭이 같으면 늘 같은 단계 (펼친 단계가 없다)", () => {
    expect(listMode(true, 200)).toBe(listMode(true, 200));
    expect(listMode(true, 479)).toBe("rail");
    expect(listMode(true, 480)).toBe("full");
  });
});
