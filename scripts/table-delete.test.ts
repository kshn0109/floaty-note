// @vitest-environment happy-dom
/**
 * 표 지우기 (사용자 보고: "테이블 삭제가 안 돼").
 *
 * 왜 안 됐나 — 세 갈래였다:
 *   1. 커서가 표 안이면 Backspace/Delete는 **칸 안의 글자**만 지웠다. 칸을 전부 골라도
 *      `prosemirror-tables`의 기본 동작이 "칸 내용 비우기"라 빈 표가 남았다.
 *   2. 표 바로 뒤 단락의 맨 앞에서 Backspace를 눌러도 `baseKeymap`의 `joinBackward`가
 *      표 안으로 들어갈 뿐 표는 그대로였다.
 *   3. 우클릭 메뉴에 표를 지우는 줄이 아예 없었다.
 *
 * 여기서 보는 것은 **문서 → 명령 → 문서**와 **저장 바이트**다. 화면은 보지 않는다.
 */

import { NodeSelection, TextSelection, type EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  deleteTable,
  selectAdjacentTable,
  tableRange,
  wholeTableCells,
} from "../src/lib/editor/mdCommands";
import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { editMenu, EDIT_MENU } from "../src/lib/menus";

const TABLE = "| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n";

/** 표 하나가 가운데 있는 문서. */
const MID = `앞 단락\n\n${TABLE}\n뒤 단락\n`;

function hostOf(md: string): MarkdownHost {
  return new MarkdownHost(md);
}

/** 테스트가 상태를 직접 만지려면 호스트 안쪽이 필요하다(화면 없이 돌린다). */
function stateOf(h: MarkdownHost): EditorState {
  return (h as unknown as { state: EditorState }).state;
}

function setState(h: MarkdownHost, next: EditorState): void {
  (h as unknown as { state: EditorState }).state = next;
}

/** 표 첫 칸 안으로 커서를 옮긴다(표는 `index`번째 맨 위 블록). */
function caretInTable(h: MarkdownHost, index: number): void {
  const state = stateOf(h);
  let pos = 0;
  state.doc.forEach((_n, off, i) => {
    if (i === index) pos = off;
  });
  setState(h, state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 3)))));
}

describe("표 범위 찾기", () => {
  it("커서가 칸 안이면 그 표 한 덩어리를 가리킨다", () => {
    const h = hostOf(MID);
    caretInTable(h, 1);
    const r = tableRange(stateOf(h));
    expect(r).not.toBeNull();
    const node = stateOf(h).doc.nodeAt(r!.from);
    expect(node?.type.name).toBe("table");
    expect(r!.to - r!.from).toBe(node!.nodeSize);
  });

  it("표 밖이면 null이다", () => {
    const h = hostOf(MID);
    expect(tableRange(stateOf(h))).toBeNull();
  });

  it("칸 선택이 아니면 '표 전체 칸 선택'이 아니다", () => {
    const h = hostOf(MID);
    caretInTable(h, 1);
    expect(wholeTableCells(stateOf(h))).toBe(false);
  });
});

describe("표 지우기", () => {
  it("가운데 표를 지우면 앞뒤 단락만 남는다", () => {
    const h = hostOf(MID);
    caretInTable(h, 1);
    expect(h.exec({ t: "deleteTable" })).toBe(true);
    expect(h.save()).toBe("앞 단락\n\n뒤 단락\n");
  });

  it("문서가 표 하나뿐이면 **빈 단락**이 남는다(칠 자리가 있어야 한다)", () => {
    const h = hostOf(TABLE);
    caretInTable(h, 0);
    expect(h.exec({ t: "deleteTable" })).toBe(true);
    const state = stateOf(h);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe("paragraph");
    expect(state.doc.child(0).content.size).toBe(0);
    expect(h.save()).toBe("");
  });

  it("표가 맨 앞/맨 뒤여도 지워진다", () => {
    const first = hostOf(`${TABLE}\n뒤 단락\n`);
    caretInTable(first, 0);
    expect(first.exec({ t: "deleteTable" })).toBe(true);
    expect(first.save()).toBe("뒤 단락\n");

    const last = hostOf(`앞 단락\n\n${TABLE}`);
    caretInTable(last, 1);
    expect(last.exec({ t: "deleteTable" })).toBe(true);
    expect(last.save()).toBe("앞 단락\n");
  });

  it("표 밖에서는 아무 일도 하지 않는다", () => {
    const h = hostOf(MID);
    expect(h.exec({ t: "deleteTable" })).toBe(false);
    expect(h.save()).toBe(MID);
  });

  it("실행 취소 한 번이면 표가 돌아온다(저장 바이트까지)", () => {
    const h = hostOf(MID);
    caretInTable(h, 1);
    h.exec({ t: "deleteTable" });
    expect(h.save()).toBe("앞 단락\n\n뒤 단락\n");
    h.undo();
    expect(h.save()).toBe(MID);
    h.redo();
    expect(h.save()).toBe("앞 단락\n\n뒤 단락\n");
  });

  it("지운 뒤 커서는 글자를 칠 수 있는 자리에 있다", () => {
    const h = hostOf(MID);
    caretInTable(h, 1);
    h.exec({ t: "deleteTable" });
    expect(h.exec({ t: "insertText", text: "ㄱ" })).toBe(true);
    expect(h.save()).toBe("앞 단락\n\nㄱ뒤 단락\n");
  });

  it("일반 텍스트 모드에는 표가 없으므로 아무 일도 하지 않는다", async () => {
    const { PlainHost } = await import("../src/lib/editor/PlainHost");
    const p = new PlainHost("가나다\n");
    expect(p.exec({ t: "deleteTable" })).toBe(false);
    expect(p.save()).toBe("가나다\n");
  });
});

describe("표 바로 옆에서 Backspace·Delete", () => {
  it("표 뒤 단락의 맨 앞에서 Backspace면 **표가 골라진다**(아직 지워지지 않는다)", () => {
    const h = hostOf(MID);
    const state = stateOf(h);
    // 마지막 단락의 맨 앞.
    let start = 0;
    state.doc.forEach((_n, off, i) => {
      if (i === 2) start = off + 1;
    });
      const at = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
    const tr = selectAdjacentTable(at, -1);
    expect(tr).not.toBeNull();
    expect(tr!.docChanged).toBe(false);
    expect(tr!.selection).toBeInstanceOf(NodeSelection);
    expect((tr!.selection as NodeSelection).node.type.name).toBe("table");
  });

  it("표 앞 단락의 맨 끝에서 Delete면 표가 골라진다", () => {
    const h = hostOf(MID);
    const state = stateOf(h);
    const end = state.doc.child(0).nodeSize - 1;
      const at = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
    const tr = selectAdjacentTable(at, 1);
    expect(tr).not.toBeNull();
    expect(tr!.selection).toBeInstanceOf(NodeSelection);
    expect((tr!.selection as NodeSelection).node.type.name).toBe("table");
  });

  it("골라진 표에서 한 번 더 지우면 사라진다", () => {
    const h = hostOf(MID);
    const state = stateOf(h);
    let start = 0;
    state.doc.forEach((_n, off, i) => {
      if (i === 2) start = off + 1;
    });
      const at = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
    const picked = at.apply(selectAdjacentTable(at, -1)!);
    const gone = picked.apply(deleteTable(picked)!);
    expect(gone.doc.childCount).toBe(2);
    expect(gone.doc.child(0).textContent).toBe("앞 단락");
    expect(gone.doc.child(1).textContent).toBe("뒤 단락");
  });

  it("단락 한가운데서는 표를 고르지 않는다(평소의 지우기 그대로)", () => {
    const h = hostOf(MID);
    const state = stateOf(h);
      const at = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(selectAdjacentTable(at, -1)).toBeNull();
    expect(selectAdjacentTable(at, 1)).toBeNull();
  });
});

describe("우클릭 메뉴", () => {
  it("표 밖에서는 평소 메뉴 그대로다", () => {
    expect(editMenu(false)).toBe(EDIT_MENU);
  });

  it("표 안에서는 `삭제` 바로 아래에 `표 삭제`가 붙는다", () => {
    const items = editMenu(true).items;
    const i = items.findIndex((it) => it.kind === "row" && it.label === "menuDelete");
    const next = items[i + 1];
    expect(next.kind).toBe("row");
    expect(next.kind === "row" && next.label).toBe("menuDeleteTable");
    expect(next.kind === "row" && next.act).toEqual({ t: "cmd", id: "deleteTable" });
    // 나머지 줄은 그대로다.
    expect(items.length).toBe(EDIT_MENU.items.length + 1);
  });
});

/**
 * **실제 키 입력 경로** — 위의 명령들이 `Backspace`/`Delete`에 제대로 묶여 있는지.
 * `keys.test.ts`와 같은 방식: 편집기 DOM에 진짜 `keydown`을 보낸다.
 *
 * 한 가지 알아 둘 것: 표를 통째로 고르면(`NodeSelection`) `prosemirror-tables`의
 * `tableEditing` 플러그인이 그것을 **표 전체 칸 선택**(`CellSelection`)으로 바꾼다.
 * 결과는 같다 — 화면에는 모든 칸이 선택 색으로 보이고, 한 번 더 누르면 지워진다.
 */
describe("Backspace/Delete 키가 실제로 닿는가", () => {
  function mounted(md: string): { host: MarkdownHost; dom: HTMLElement } {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = new MarkdownHost(md);
    host.mount(root);
    const dom = root.querySelector<HTMLElement>("[contenteditable]") ?? root;
    return { host, dom };
  }

  function pressKey(dom: HTMLElement, key: "Backspace" | "Delete"): void {
    dom.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true })
    );
  }

  /** 마지막 단락의 맨 앞 자리. */
  function startOfLast(host: MarkdownHost): number {
    const state = stateOf(host);
    let start = 0;
    state.doc.forEach((_n, off, i) => {
      if (i === state.doc.childCount - 1) start = off + 1;
    });
    return start;
  }

  it("표 뒤 단락 맨 앞에서 Backspace 두 번이면 표가 사라진다", () => {
    const { host, dom } = mounted(MID);
    host.select(startOfLast(host));

    pressKey(dom, "Backspace");
    // 한 번째: 표가 통째로 골라지기만 한다(문서는 그대로).
    expect(wholeTableCells(stateOf(host))).toBe(true);
    expect(host.save()).toBe(MID);

    pressKey(dom, "Backspace");
    expect(host.save()).toBe("앞 단락\n\n뒤 단락\n");
  });

  it("표 앞 단락 맨 끝에서 Delete 두 번이면 표가 사라진다", () => {
    const { host, dom } = mounted(MID);
    host.select(stateOf(host).doc.child(0).nodeSize - 1);

    pressKey(dom, "Delete");
    expect(wholeTableCells(stateOf(host))).toBe(true);
    expect(host.save()).toBe(MID);

    pressKey(dom, "Delete");
    expect(host.save()).toBe("앞 단락\n\n뒤 단락\n");
  });

  it("단락 한가운데서는 표를 고르지 않는다(평소의 지우기 그대로)", () => {
    const { host, dom } = mounted(MID);
    host.select(2);
    pressKey(dom, "Backspace");
    expect(wholeTableCells(stateOf(host))).toBe(false);
    expect(tableRange(stateOf(host))).toBeNull();
    expect(host.save()).toBe(MID);
  });
});
