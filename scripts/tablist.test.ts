/**
 * 「N ▾」 탭 목록 — 승인된 시안 T1 (사용자 결정 2026-11-10).
 *
 * 화면이 아니라 **목록을 만드는 일**만 본다: 어떤 줄이 어떤 순서로 생기는가, 색 없음과
 * 저장 안 됨과 지금 탭이 각각 어떻게 표시되는가, 많으면 구르는 칸이 어디서 멈추는가,
 * 그리고 고른 탭으로 탭 줄이 어디까지 넘어가는가. 보임새는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import { TAB_LIST_MAX_ROWS, TAB_LIST_WIDTH, menuHeight, tabListMenu, type TabRow } from "../src/lib/menus";
import { TINT_DOTS } from "../src/lib/palette";
import { scrollToPill, type Span } from "../src/lib/tabStrip";

function row(id: number, label: string, extra: Partial<TabRow> = {}): TabRow {
  return { id, label, tint: "none", dirty: false, ...extra };
}

const TABS: TabRow[] = [
  row(1, "장보기 목록", { tint: "yellow" }),
  row(2, "회의 메모"),
  row(3, "todo.md", { tint: "sky", dirty: true }),
];

describe("탭 목록 만들기", () => {
  it("보이는 탭이 **순서대로** 한 줄씩 들어간다", () => {
    const menu = tabListMenu(TABS, 1);
    expect(menu.width).toBe(TAB_LIST_WIDTH);
    expect(menu.items.map((item) => (item.kind === "tab" ? item.text : item.kind))).toEqual([
      "장보기 목록",
      "회의 메모",
      "todo.md",
    ]);
  });

  it("색이 있으면 그 색, `색 없음`은 빈 문자열(빈 점)", () => {
    const menu = tabListMenu(TABS, 1);
    const colors = menu.items.map((item) => (item.kind === "tab" ? item.color : null));
    expect(colors).toEqual([TINT_DOTS.yellow, "", TINT_DOTS.sky]);
  });

  it("저장 안 됨과 지금 탭만 참이다", () => {
    const menu = tabListMenu(TABS, 3);
    const flags = menu.items.map((item) =>
      item.kind === "tab" ? { dirty: item.dirty, active: item.active } : null
    );
    expect(flags).toEqual([
      { dirty: false, active: false },
      { dirty: false, active: false },
      { dirty: true, active: true },
    ]);
  });

  it("활성 탭이 목록에 없으면 ✓가 하나도 없다 (숨은 탭을 고른 경우)", () => {
    const menu = tabListMenu(TABS, 99);
    expect(menu.items.every((item) => item.kind === "tab" && !item.active)).toBe(true);
  });

  it("탭이 없으면 빈 목록", () => {
    expect(tabListMenu([], 1).items).toEqual([]);
  });
});

describe("많으면 구른다", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1, `메모 ${i + 1}`));

  it("전부 구르는 칸이다 (맨 위에 고정해 둘 줄이 없다)", () => {
    expect(tabListMenu(many(3), 1).scrollFrom).toBe(0);
  });

  it("줄이 적으면 내용 높이만 쓴다", () => {
    const few = menuHeight(tabListMenu(many(3), 1));
    const one = menuHeight(tabListMenu(many(1), 1));
    expect(few).toBeGreaterThan(one);
    expect(few - one).toBe(2 * 30);
  });

  it("최대 줄 수를 넘으면 높이가 더 자라지 않는다", () => {
    const at = menuHeight(tabListMenu(many(TAB_LIST_MAX_ROWS), 1));
    const over = menuHeight(tabListMenu(many(TAB_LIST_MAX_ROWS + 20), 1));
    expect(over).toBe(at);
  });
});

describe("고른 탭으로 탭 줄이 넘어간다", () => {
  /** 폭 100 알약 5개, 간격 4 — 내용 폭 516. */
  const spans: Span[] = Array.from({ length: 5 }, (_, i) => ({
    start: i * 104,
    end: i * 104 + 100,
  }));
  const view = 250;
  const max = 516 - view;

  it("안 보이던 탭을 고르면 그 알약의 **왼쪽 끝**에 맞춰 멈춘다", () => {
    expect(scrollToPill(spans, view, 0, 2, max)).toBe(208);
  });

  it("이미 온전히 보이는 탭을 고르면 줄이 움직이지 않는다", () => {
    expect(scrollToPill(spans, view, 0, 0, max)).toBe(0);
    expect(scrollToPill(spans, view, 0, 1, max)).toBe(0);
  });

  it("끝 탭은 끝까지만 — 그 알약이 온전히 보인다", () => {
    const left = scrollToPill(spans, view, 0, 4, max);
    expect(left).toBe(max);
    expect(spans[4].end).toBeLessThanOrEqual(left + view + 0.5);
  });
});
