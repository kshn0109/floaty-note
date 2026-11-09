/**
 * 탭 순서·전환·닫기 판정 (§5, 단계 6의 완료 조건).
 *
 * 화면이 아니라 **목록을 어떻게 고치는가**를 본다: 끌어서 순서 바꾸기, Ctrl+Tab의
 * 순환, 탭을 닫은 뒤 활성이 되는 탭, 창을 닫을 때의 판정. UI는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import { tabCloseNeedsPrompt, tabsToPrompt, windowCloseMode } from "../src/lib/closing";
import {
  activeAfterClose,
  createTab,
  dropIndex,
  moveTab,
  newTabUid,
  shownTabs,
  stepTab,
  type Tab,
} from "../src/lib/tabs";

/** 이름만 다른 탭 n개. id는 발급 순서대로 커진다. */
function make(names: string[]): Tab[] {
  return names.map((name) => createTab("none", name));
}

const ids = (tabs: readonly Tab[]) => tabs.map((tab) => tab.name);

describe("탭 이름(uid)", () => {
  it("겹치지 않고 파일 이름에 쓸 수 있는 글자만 쓴다", () => {
    const a = newTabUid();
    const b = newTabUid();
    expect(a).not.toBe(b);
    // `buf_<탭ID>.txt`가 Rust의 이름 검사(ASCII 영숫자·`_`·`-`·`.`)를 지나야 한다.
    expect(a).toMatch(/^[0-9a-f-]+$/);
  });

  it("새 탭은 현재 탭의 메모지 색을 물려받는다 (§5)", () => {
    const tab = createTab("yellow");
    expect(createTab(tab.tint).tint).toBe("yellow");
  });
});

describe("끌어서 순서 바꾸기", () => {
  it("첫 탭을 맨 끝으로", () => {
    const tabs = make(["a", "b", "c"]);
    expect(ids(moveTab(tabs, tabs[0].id, 2))).toEqual(["b", "c", "a"]);
  });

  it("마지막 탭을 맨 앞으로", () => {
    const tabs = make(["a", "b", "c"]);
    expect(ids(moveTab(tabs, tabs[2].id, 0))).toEqual(["c", "a", "b"]);
  });

  it("같은 자리로 끌면 목록이 그대로다 (쓸데없는 다시 그리기 없음)", () => {
    const tabs = make(["a", "b"]);
    expect(moveTab(tabs, tabs[1].id, 1)).toBe(tabs);
  });

  it("범위를 벗어난 자리는 끝으로 당긴다", () => {
    const tabs = make(["a", "b", "c"]);
    expect(ids(moveTab(tabs, tabs[0].id, 99))).toEqual(["b", "c", "a"]);
    expect(ids(moveTab(tabs, tabs[2].id, -5))).toEqual(["c", "a", "b"]);
  });

  it("숨은 탭은 순서에 끼지 않고 자리도 지킨다 (§5의 알림 예외)", () => {
    const tabs = make(["a", "hidden", "b"]);
    tabs[1].hidden = true;
    const moved = moveTab(tabs, tabs[0].id, 1); // 보이는 탭 기준 a ↔ b
    expect(ids(moved)).toEqual(["b", "hidden", "a"]);
    expect(moved[1].hidden).toBe(true);
    expect(ids(shownTabs(moved))).toEqual(["b", "a"]);
  });
});

describe("포인터 자리 → 탭 자리", () => {
  const spans = [
    { start: 0, end: 100 },
    { start: 100, end: 200 },
    { start: 200, end: 300 },
  ];

  it("상자 안이면 그 자리", () => {
    expect(dropIndex(spans, 50)).toBe(0);
    expect(dropIndex(spans, 150)).toBe(1);
    expect(dropIndex(spans, 250)).toBe(2);
  });

  it("양 끝 밖이면 양 끝으로 당긴다", () => {
    expect(dropIndex(spans, -40)).toBe(0);
    expect(dropIndex(spans, 9999)).toBe(2);
  });

  it("탭이 없으면 0", () => {
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe("Ctrl+Tab / Ctrl+Shift+Tab", () => {
  it("줄 순서대로 돌고 끝에서 처음으로 돌아간다 (메모장과 같다)", () => {
    const tabs = make(["a", "b", "c"]);
    expect(stepTab(tabs, tabs[0].id, true)).toBe(tabs[1].id);
    expect(stepTab(tabs, tabs[2].id, true)).toBe(tabs[0].id);
    expect(stepTab(tabs, tabs[0].id, false)).toBe(tabs[2].id);
  });

  it("숨은 탭은 건너뛴다", () => {
    const tabs = make(["a", "hidden", "b"]);
    tabs[1].hidden = true;
    expect(stepTab(tabs, tabs[0].id, true)).toBe(tabs[2].id);
  });

  it("탭이 하나면 그 탭 그대로", () => {
    const tabs = make(["a"]);
    expect(stepTab(tabs, tabs[0].id, true)).toBe(tabs[0].id);
  });
});

describe("탭을 닫은 뒤 활성 탭", () => {
  it("닫은 자리의 탭이 활성이 된다", () => {
    const tabs = make(["a", "b", "c"]);
    expect(activeAfterClose(tabs, tabs[1].id, tabs[1].id)).toBe(tabs[2].id);
  });

  it("마지막 탭을 닫으면 그 왼쪽", () => {
    const tabs = make(["a", "b", "c"]);
    expect(activeAfterClose(tabs, tabs[2].id, tabs[2].id)).toBe(tabs[1].id);
  });

  it("활성이 아닌 탭을 닫으면 활성 탭은 그대로", () => {
    const tabs = make(["a", "b", "c"]);
    expect(activeAfterClose(tabs, tabs[0].id, tabs[2].id)).toBe(tabs[2].id);
  });

  it("보이는 탭이 하나도 남지 않으면 null — 그때 창이 닫힌다 (§5)", () => {
    const tabs = make(["a"]);
    expect(activeAfterClose(tabs, tabs[0].id, tabs[0].id)).toBeNull();
  });

  it("숨은 탭만 남는 것도 '남지 않은' 것이다 (어느 탭 줄에도 안 보인다)", () => {
    const tabs = make(["a", "hidden"]);
    tabs[1].hidden = true;
    expect(activeAfterClose(tabs, tabs[0].id, tabs[0].id)).toBeNull();
  });
});

describe("닫기 규칙 판정 (§5)", () => {
  it("탭 하나 닫기: 미저장일 때만 묻는다", () => {
    expect(tabCloseNeedsPrompt({ dirty: true })).toBe(true);
    expect(tabCloseNeedsPrompt({ dirty: false })).toBe(false);
  });

  it("기본 설정에서 창 닫기는 묻지 않고 세션에 저장한다", () => {
    expect(windowCloseMode({ startup: "restore", totalTabs: 3, others: 0 })).toBe("saveSession");
  });

  it("마지막 탭을 닫아 탭이 없으면 세션을 지운다 (닫은 탭은 안 돌아온다)", () => {
    expect(windowCloseMode({ startup: "restore", totalTabs: 0, others: 0 })).toBe("clearSession");
  });

  it("먼저 닫은 창이나 다른 창이 남아 있으면 세션을 지우지 않는다 (§5: 모든 창이 돌아온다)", () => {
    expect(windowCloseMode({ startup: "restore", totalTabs: 0, others: 1 })).toBe("saveSession");
  });

  it("'새 세션' 설정이면 탭마다 묻고 세션을 버린다", () => {
    expect(windowCloseMode({ startup: "fresh", totalTabs: 2, others: 0 })).toBe("askThenDiscard");
  });

  it("묻는 대상은 보이는 미저장 탭뿐이고 줄 순서대로다", () => {
    const tabs = make(["a", "b", "c", "hidden"]);
    tabs[0].dirty = true;
    tabs[2].dirty = true;
    tabs[3].dirty = true;
    tabs[3].hidden = true;
    expect(ids(tabsToPrompt(tabs))).toEqual(["a", "c"]);
  });
});
