/**
 * 간략 메뉴(승인된 시안 C2 — 사용자 결정 2026-11-09)의 **크기 계산**과 **단축키
 * 말풍선 자리**.
 *
 * 화면을 보지 않는다(사용자 규칙): 여기서 보는 것은 순수한 계산뿐이다 — 팝업이 몇
 * px인가(창 안 배치 `placeBox`가 그 값을 쓴다), 말풍선이 창 밖으로 나가지 않는가,
 * 0.6초를 언제 기다리고 언제 건너뛰는가. 실제 모양은 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import {
  DOTS_H,
  GROUP_GAP,
  GROUP_LABEL_H,
  HEADING_C,
  HEADING_H,
  POPUP_BORDER,
  POPUP_PAD,
  ROW_C,
  ROW_H,
  SEG_H,
  SEP_C,
  SEP_H,
  itemHeight,
  itemOffset,
  menuHeight,
  rootMenu,
  type Menu,
  type MenuItem,
} from "../src/lib/menus";
import { TIP_DELAY, ariaKeys, tipDelay, tipPosition } from "../src/lib/menuTip";

/** ☰의 하위 메뉴 셋을 이름으로 꺼낸다. */
function sub(title: string): Menu {
  const item = rootMenu(false).items.find(
    (it): it is Extract<MenuItem, { kind: "sub" }> => it.kind === "sub" && it.label === title
  );
  if (!item) throw new Error(`하위 메뉴 없음: ${title}`);
  return item.menu;
}

const FILE = sub("moreFile");
const VIEW = sub("moreView");
const THEME = sub("menuTheme");

describe("간략 플래그는 ☰ 하위 메뉴 셋에만", () => {
  it("파일·보기·테마는 compact, 루트 ☰는 아니다", () => {
    expect(FILE.compact).toBe(true);
    expect(VIEW.compact).toBe(true);
    expect(THEME.compact).toBe(true);
    expect(rootMenu(false).compact).toBeUndefined();
  });

  it("폭은 시안 값 이상이다 (파일 150 · 보기 ≥170 · 테마 176)", () => {
    expect(FILE.width).toBe(150);
    expect(VIEW.width).toBeGreaterThanOrEqual(170);
    expect(THEME.width).toBe(176);
  });
});

describe("줄 높이 — 간략은 26/20/7, 기존은 30/22/9", () => {
  it("같은 항목이 플래그에 따라 다른 높이를 낸다", () => {
    const row: MenuItem = { kind: "row", label: "btnSave", act: { t: "cmd", id: "save" } };
    expect(itemHeight(row)).toBe(ROW_H);
    expect(itemHeight(row, true)).toBe(ROW_C);
    expect(itemHeight({ kind: "sep" })).toBe(SEP_H);
    expect(itemHeight({ kind: "sep" }, true)).toBe(SEP_C);
    expect(itemHeight({ kind: "heading", label: "menuZoom" })).toBe(HEADING_H);
    expect(itemHeight({ kind: "heading", label: "menuZoom" }, true)).toBe(HEADING_C);
  });

  it("확대/축소 한 줄은 보통 줄과 같은 높이다", () => {
    expect(itemHeight({ kind: "zoom" }, true)).toBe(ROW_C);
  });
});

describe("팝업 높이 — placeBox가 쓰는 값", () => {
  it("파일: 줄 9 + 구분선 2 (시안 C2)", () => {
    const rows = FILE.items.filter((it) => it.kind === "row").length;
    const seps = FILE.items.filter((it) => it.kind === "sep").length;
    expect(rows).toBe(9);
    expect(seps).toBe(2);
    expect(menuHeight(FILE)).toBe(2 * (POPUP_PAD + POPUP_BORDER) + rows * ROW_C + seps * SEP_C);
    // 기존(30 줄 · 구분선 9)보다 낮아야 한다 — 그게 이번 변경의 목적이다.
    expect(menuHeight(FILE)).toBeLessThan(2 * (POPUP_PAD + POPUP_BORDER) + rows * ROW_H + seps * SEP_H);
  });

  it("보기: 확대/축소가 머리+3줄에서 한 줄로 접혔다", () => {
    // 줄 8(찾기·바꾸기 + 체크 5 + 확대/축소) + 구분선 2, 머리는 없다.
    expect(VIEW.items.filter((it) => it.kind === "heading")).toHaveLength(0);
    expect(VIEW.items.filter((it) => it.kind === "zoom")).toHaveLength(1);
    expect(menuHeight(VIEW)).toBe(2 * (POPUP_PAD + POPUP_BORDER) + 8 * ROW_C + 2 * SEP_C);
  });

  it("테마: 두 덩어리(패딩 8) — 라벨+세그먼트 / 라벨+점, 사이 9", () => {
    expect(THEME.pad).toBe(8);
    expect(THEME.items.map((it) => it.kind)).toEqual(["segment", "dots"]);
    const expected =
      2 * (8 + POPUP_BORDER) + (GROUP_LABEL_H + SEG_H) + GROUP_GAP + (GROUP_LABEL_H + DOTS_H);
    expect(menuHeight(THEME)).toBe(expected);
    expect(menuHeight(THEME)).toBe(117);
    // 11줄짜리 예전 테마 메뉴(300px 가까이)보다 훨씬 낮다.
    expect(menuHeight(THEME)).toBeLessThan(150);
  });

  it("덩어리 사이 여백은 첫 덩어리 앞에는 붙지 않는다", () => {
    expect(itemOffset(THEME, 0)).toBe(8 + POPUP_BORDER);
    expect(itemOffset(THEME, 1)).toBe(8 + POPUP_BORDER + GROUP_LABEL_H + SEG_H + GROUP_GAP);
  });

  it("루트 ☰의 하위 메뉴 줄 offset은 30 줄 기준 그대로다", () => {
    const root = rootMenu(false);
    expect(itemOffset(root, 0)).toBe(POPUP_PAD + POPUP_BORDER);
    expect(itemOffset(root, 1)).toBe(POPUP_PAD + POPUP_BORDER + ROW_H);
  });
});

describe("말풍선 자리 — 줄 오른쪽 끝 아래, 창 안으로", () => {
  const vw = 800;
  const vh = 600;

  it("기본은 줄 오른쪽에 오른쪽을 맞추고 2px 아래", () => {
    const pos = tipPosition({ left: 100, top: 200, right: 240, bottom: 226 }, 60, 20, vw, vh);
    expect(pos).toEqual({ left: 180, top: 228 });
  });

  it("오른쪽으로 넘치면 창 안으로 당긴다", () => {
    const pos = tipPosition({ left: 700, top: 100, right: 795, bottom: 126 }, 120, 20, vw, vh);
    expect(pos.left).toBe(vw - 120 - 8);
  });

  it("왼쪽으로 넘쳐도 여백을 지킨다", () => {
    const pos = tipPosition({ left: 2, top: 100, right: 40, bottom: 126 }, 100, 20, vw, vh);
    expect(pos.left).toBe(8);
  });

  it("아래에 자리가 없으면 줄 위로 올라간다", () => {
    const pos = tipPosition({ left: 100, top: 560, right: 240, bottom: 586 }, 60, 20, vw, vh);
    expect(pos.top).toBe(560 - 20 - 2);
  });
});

describe("기다리는 시간 — 처음 0.6초, 그다음은 바로", () => {
  it("식은 상태에서는 0.6초, 한 번 뜬 뒤에는 0", () => {
    expect(tipDelay(false)).toBe(TIP_DELAY);
    expect(TIP_DELAY).toBe(600);
    expect(tipDelay(true)).toBe(0);
  });
});

describe("낭독기 — aria-keyshortcuts 이름", () => {
  it("수정키만 정해진 이름으로 바꾼다", () => {
    expect(ariaKeys("Ctrl+N")).toBe("Control+N");
    expect(ariaKeys("Ctrl+Shift+S")).toBe("Control+Shift+S");
    expect(ariaKeys("Ctrl+=")).toBe("Control+=");
    expect(ariaKeys("Ctrl+-")).toBe("Control+-");
    expect(ariaKeys("Alt+F4")).toBe("Alt+F4");
    expect(ariaKeys("Del")).toBe("Delete");
  });

  it("간략 메뉴의 줄은 단축키를 그대로 들고 있다 (말풍선·낭독기가 쓴다)", () => {
    const save = FILE.items.find((it) => it.kind === "row" && it.label === "btnSave");
    expect(save && save.kind === "row" && save.key).toBe("Ctrl+S");
  });
});
