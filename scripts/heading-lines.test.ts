/**
 * 제목(H1~H3)은 **줄 단위**다 — 사용자 보고한 버그:
 * `.txt`에서 읽거나 붙여넣은 글은 줄바꿈(`soft_break`)으로 이어진 **한 단락**이어서
 * 일부만 드래그해도 단락 전체가 제목이 되었다. 선택이 걸친 **줄들만** 바뀌어야 한다.
 *
 * 검사 방식은 다른 명령 검사와 같다: 명령 → **저장될 문자열**.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";

/**
 * 줄바꿈으로 이어진 한 단락 `첫 줄 / 둘째 줄 / 셋째 줄`의 자리.
 * 단락 안쪽은 1부터고, 줄 사이의 `soft_break`가 자리 하나를 차지한다.
 */
const SOFT = "첫 줄\n둘째 줄\n셋째 줄\n";
const L1 = 1; //  "첫 줄"   1 ~ 4
const L2 = 5; //  "둘째 줄"  5 ~ 9
const L3 = 10; // "셋째 줄" 10 ~ 14

describe("제목은 줄 단위 — 줄바꿈으로 이어진 한 단락", () => {
  it("세 줄이 한 단락인 것을 먼저 확인한다 (왕복)", () => {
    const host = new MarkdownHost(SOFT);
    expect(host.save()).toBe(SOFT);
  });

  it("가운데 줄 일부를 선택하면 가운데 줄만 제목이 된다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L2 + 1, L2 + 3); // "둘째 줄" 안쪽 일부
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.save()).toBe("첫 줄\n\n# 둘째 줄\n\n셋째 줄\n");
  });

  it("커서만 둬도 그 줄만 제목이 된다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L3 + 2);
    expect(host.exec({ t: "heading", level: 2 })).toBe(true);
    expect(host.save()).toBe("첫 줄\n둘째 줄\n\n## 셋째 줄\n");
  });

  it("두 줄에 걸친 선택은 그 두 줄만 제목이 된다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L1 + 1, L2 + 2); // 첫 줄 안쪽 ~ 둘째 줄 안쪽
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.save()).toBe("# 첫 줄\n\n# 둘째 줄\n\n셋째 줄\n");
  });

  it("세 줄을 모두 선택하면 줄마다 제목이 된다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L1, L3 + 4);
    expect(host.exec({ t: "heading", level: 3 })).toBe(true);
    expect(host.save()).toBe("### 첫 줄\n\n### 둘째 줄\n\n### 셋째 줄\n");
  });

  it("실행 취소 한 번에 되돌아간다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L2 + 1, L2 + 3);
    host.exec({ t: "heading", level: 1 });
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(SOFT);
    expect(host.isDirty()).toBe(false);
  });

  it("같은 레벨을 다시 누르면 그 줄만 본문으로 (토글)", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L2 + 1, L2 + 3);
    host.exec({ t: "heading", level: 1 });
    expect(host.query().heading).toBe(1);
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.query().heading).toBe(0);
    expect(host.save()).toBe("첫 줄\n\n둘째 줄\n\n셋째 줄\n");
  });

  it("여러 줄 제목의 한 줄만 선택하면 그 줄만 본문으로 돌아간다", () => {
    const host = new MarkdownHost(SOFT);
    host.select(L1, L3 + 4);
    host.exec({ t: "heading", level: 1 }); // 세 줄 모두 H1
    expect(host.save()).toBe("# 첫 줄\n\n# 둘째 줄\n\n# 셋째 줄\n");
    host.select(8); // "둘째 줄" 안쪽 (블록이 쪼개진 뒤의 자리)
    expect(host.query().heading).toBe(1);
    host.exec({ t: "heading", level: 1 });
    expect(host.save()).toBe("# 첫 줄\n\n둘째 줄\n\n# 셋째 줄\n");
  });
});

describe("제목은 줄 단위 — 여러 단락", () => {
  const MANY = "첫 줄\n\n둘째 줄\n\n셋째 줄\n";

  it("선택이 걸친 단락만 제목이 된다", () => {
    const host = new MarkdownHost(MANY);
    host.select(7, 9); // 둘째 단락 안쪽
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.save()).toBe("첫 줄\n\n# 둘째 줄\n\n셋째 줄\n");
  });

  it("두 단락에 걸치면 두 단락만 (기존 동작 유지)", () => {
    const host = new MarkdownHost(MANY);
    host.select(2, 8);
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.save()).toBe("# 첫 줄\n\n# 둘째 줄\n\n셋째 줄\n");
  });
});
