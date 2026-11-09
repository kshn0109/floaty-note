// @vitest-environment happy-dom
/**
 * **실제 키 입력 경로** 시험 — 이번 버그가 났던 자리.
 *
 * `history.test.ts`는 `host.undo()`를 직접 불러서 통과했지만, 사용자가 실제로 누르는
 * 길은 `편집기 DOM의 keydown`이다. 그 길에서 끊겨 있었다:
 *
 *   `prosemirror-view`의 `captureKeyDown`은 `Ctrl+B/I/Y/Z`(keyCode 66·73·89·90,
 *   mods == "c")를 "브라우저 기본 동작을 막아야 하는 키"로 보고 **`event.preventDefault()`를
 *   부른다.** `App`의 창 수준 keydown 처리기는 맨 앞에서 `if (e.defaultPrevented) return`을
 *   하므로, 마크다운 탭에서 Ctrl+Z·Ctrl+Y·Ctrl+B가 **아무 일도 하지 않았다**
 *   (Ctrl+Shift+Z는 mods == "cs"라 잡히지 않아 혼자 동작했다).
 *
 * **다시 실행은 이제 Ctrl+Y 하나다**(사용자 지시 — Windows 11 메모장과 같다). 그래서
 * Ctrl+Shift+Z는 "아무 일도 하지 않는다"를 보증하는 시험이 됐다.
 *
 * 그래서 이 시험은 호스트 메서드를 부르지 않고 **편집기 DOM에 진짜 `keydown`을 보내고**,
 * 문서가 되돌아갔는지와 그 이벤트가 소비됐는지(`defaultPrevented`)를 함께 본다.
 * 둘을 같이 봐야 "막기만 하고 되돌리지는 않는" 이번 상태를 다시 잡을 수 있다.
 *
 * UI 자동 테스트가 아니다: 화면을 그리거나 찍지 않고, 키 한 번이 편집기에 닿는지만 본다.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { DocHost } from "../src/lib/editor/DocHost";
import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { createHost, dropHost, hostOf, replaceHost } from "../src/lib/editor/registry";

const MD = "# 제목\n\n본문 한 줄.\n\n끝 문단.\n";
const TXT = "첫 줄\n둘째 줄\n";

/** 키 이름 → `w3c-keyname`·`captureKeyDown`이 둘 다 읽는 값. */
const KEYCODE: Record<string, number> = { z: 90, y: 89, b: 66, i: 73, x: 88 };

interface Chord {
  key: string;
  shift?: boolean;
}

/**
 * 편집기 DOM에 진짜 `keydown`을 보낸다. 반환은 **이벤트가 소비됐는지**
 * (`App`의 창 처리기가 `e.defaultPrevented`로 보는 바로 그 값).
 */
function press(host: DocHost, chord: Chord): boolean {
  const dom = editableOf(host);
  const event = new KeyboardEvent("keydown", {
    key: chord.shift ? chord.key.toUpperCase() : chord.key,
    code: `Key${chord.key.toUpperCase()}`,
    ctrlKey: true,
    shiftKey: chord.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  // happy-dom의 `KeyboardEventInit`에는 `keyCode`가 없다 — `captureKeyDown`이 읽는 값이라
  // 직접 심어 준다(브라우저에서는 늘 들어 있다).
  Object.defineProperty(event, "keyCode", { value: KEYCODE[chord.key] ?? 0 });
  dom.dispatchEvent(event);
  return event.defaultPrevented;
}

/** 호스트가 화면에 붙은 뒤의 편집 가능한 DOM. */
function editableOf(host: DocHost): HTMLElement {
  const root = mounts.get(host);
  if (!root) throw new Error("mount()를 먼저 불러야 한다");
  const el = root.querySelector<HTMLElement>("[contenteditable]");
  return el ?? root;
}

const mounts = new WeakMap<DocHost, HTMLElement>();

/** 탭을 화면에 붙인 상태로 만든다(실제 앱의 `Editor` 컴포넌트가 하는 일). */
function mount(host: DocHost): DocHost {
  const root = document.createElement("div");
  document.body.appendChild(root);
  host.mount(root);
  mounts.set(host, root);
  return host;
}

/** 실제 입력 한 글자 — ProseMirror·CodeMirror가 입력을 끝낼 때 보내는 그 트랜잭션. */
function type(host: DocHost, text: string): void {
  host.exec({ t: "insertText", text });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Ctrl+Z / Ctrl+Y — 마크다운 탭 (편집기 DOM keydown)", () => {
  it("글을 쓰고 Ctrl+Z를 누르면 되돌아간다 (이번 버그)", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(3);
    type(host, "ABC");
    expect(host.save()).not.toBe(MD);

    // 편집기가 그 키를 **소비하고** 실제로 되돌려야 한다. 고치기 전에는
    // 소비만 하고(= true) 문서는 그대로였다.
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);
  });

  it("Ctrl+Y로 다시 실행된다", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(3);
    type(host, "ABC");
    const typed = host.save();
    press(host, { key: "z" });
    expect(host.save()).toBe(MD);
    expect(press(host, { key: "y" })).toBe(true);
    expect(host.save()).toBe(typed);
  });

  it("Ctrl+Shift+Z는 **아무 일도 하지 않는다** (메모장처럼 다시 실행은 Ctrl+Y만)", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(3);
    type(host, "ABC");
    press(host, { key: "z" });
    expect(host.save()).toBe(MD);
    // 키맵에 없고 `captureKeyDown`도 `mods == "cs"`는 잡지 않으므로 소비되지 않는다.
    expect(press(host, { key: "z", shift: true })).toBe(false);
    // 되돌린 상태 그대로 — 다시 실행되지 않았다.
    expect(host.save()).toBe(MD);
  });

  it("Ctrl+B도 편집기 안에서 동작한다 (같은 원인으로 죽어 있었다)", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(1, 3); // "제목"
    expect(press(host, { key: "b" })).toBe(true);
    expect(host.save()).toContain("# **제목**");
    // 서식 명령 하나 = 실행 취소 한 번.
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);
  });

  it("되돌릴 것이 없으면 문서가 그대로다", () => {
    const host = mount(new MarkdownHost(MD));
    press(host, { key: "z" });
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);
  });
});

describe("Ctrl+Z / Ctrl+Y — 일반 텍스트 탭", () => {
  it("글을 쓰고 Ctrl+Z를 누르면 되돌아간다", () => {
    const host = mount(new PlainHost(TXT));
    host.select(2);
    type(host, "XY");
    expect(host.save()).not.toBe(TXT);
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(TXT);
    expect(host.isDirty()).toBe(false);
  });

  it("Ctrl+Y로 다시 실행되고, Ctrl+Shift+Z는 아무 일도 하지 않는다", () => {
    const host = mount(new PlainHost(TXT));
    host.select(2);
    type(host, "XY");
    const typed = host.save();
    press(host, { key: "z" });
    expect(press(host, { key: "y" })).toBe(true);
    expect(host.save()).toBe(typed);
    press(host, { key: "z" });
    expect(host.save()).toBe(TXT);
    // `defaultKeymap`에 history 키가 없고 우리도 묶지 않았다 — 되돌린 상태 그대로다.
    expect(press(host, { key: "z", shift: true })).toBe(false);
    expect(host.save()).toBe(TXT);
  });
});

describe("Ctrl+Z가 살아 있어야 하는 나머지 경로", () => {
  it("새 탭 (빈 문서)", () => {
    const host = mount(createHost("markdown"));
    type(host, "새 글");
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe("");
  });

  it("세션 복원·탭 떼어내기로 되살린 탭", () => {
    const origin = new MarkdownHost(MD);
    origin.select(3);
    origin.exec({ t: "bold" });
    const packet = JSON.parse(JSON.stringify(origin.serialize())) as ReturnType<
      MarkdownHost["serialize"]
    >;

    // 떼어낸 창이 하는 일과 같다: 새 호스트에 꾸러미를 붓고 화면에 붙인다.
    const moved = mount(new MarkdownHost());
    moved.restore(packet);
    const restored = moved.save();
    expect(press(moved, { key: "z" })).toBe(true);
    expect(moved.save()).toBe(MD);
    expect(press(moved, { key: "y" })).toBe(true);
    expect(moved.save()).toBe(restored);
  });

  it("registry의 `replaceHost`(파일을 열어 모드가 바뀐 탭)", () => {
    const tabId = 9901;
    mount(hostOf(tabId, "markdown"));
    const swapped = replaceHost(tabId, {
      format: "plain",
      fileSrc: TXT,
      text: TXT,
      selection: null,
      scrollTop: 0,
      history: { done: [], undone: [], savedId: null, seq: 0 },
    });
    mount(swapped);
    swapped.select(2);
    type(swapped, "Z");
    expect(press(swapped, { key: "z" })).toBe(true);
    expect(swapped.save()).toBe(TXT);
    dropHost(tabId);
  });

  it("IME로 한글을 친 경우 (조합이 끝난 뒤)", () => {
    const host = mount(new MarkdownHost(MD));
    const dom = editableOf(host);
    host.select(3);
    // 조합 시작 → 끝 → 그다음에 글자가 들어온다(ProseMirror의 순서).
    dom.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    dom.dispatchEvent(new Event("compositionend", { bubbles: true }));
    type(host, "한글");
    expect(host.save()).toContain("한글");
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);
  });

  it("붙여넣기 (여러 줄)", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(3);
    type(host, "붙인 글");
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);
  });

  it("서식 명령 — 형광펜·제목·표", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(1, 3);
    host.exec({ t: "highlight", color: "#FFEB3B" });
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);

    host.select(6);
    host.exec({ t: "heading", level: 2 });
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);

    host.select(6);
    host.exec({ t: "table", rows: 2, cols: 2 });
    expect(host.save()).not.toBe(MD);
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe(MD);
  });

  it("모두 바꾸기는 Ctrl+Z 한 번으로 전부 되돌아간다", () => {
    const host = mount(new MarkdownHost("가 나 가 나 가\n"));
    const q = { text: "가", caseSensitive: true, wholeWord: false, regex: false };
    expect(host.replaceAll(q, "다")).toBe(3);
    expect(host.save()).toBe("다 나 다 나 다\n");
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe("가 나 가 나 가\n");
  });
});

/**
 * 취소선 — 굵게와 **같은 규칙**(선택 범위, 선택이 없으면 커서 단어, 단어 밖이면
 * 아무 일 없음)이고 파일에는 `~~글자~~`로 나간다.
 *
 * `Ctrl+Shift+X`는 `captureKeyDown`이 잡지 않는 조합(mods == "cs")이지만, 서식 키를
 * 모두 편집기 keymap에서 먼저 받도록 묶어 두었으므로 **실제 keydown**으로 확인한다.
 */
describe("취소선 (Ctrl+Shift+X)", () => {
  it("선택 범위를 토글하고 파일에는 `~~`", () => {
    const host = mount(new MarkdownHost("가나다 라마바\n"));
    host.select(1, 4); // `가나다`
    expect(host.exec({ t: "strike" })).toBe(true);
    expect(host.save()).toBe("~~가나다~~ 라마바\n");
    expect(host.query().strike).toBe(true);
    // 다시 누르면 해제된다.
    expect(host.exec({ t: "strike" })).toBe(true);
    expect(host.save()).toBe("가나다 라마바\n");
    expect(host.query().strike).toBe(false);
  });

  it("선택이 없으면 커서가 있는 단어, 단어 밖이면 아무 일도 없다", () => {
    const host = mount(new MarkdownHost("abc def\n"));
    host.select(3); // `abc` 안
    expect(host.exec({ t: "strike" })).toBe(true);
    expect(host.save()).toBe("~~abc~~ def\n");

    // 어느 쪽도 단어 글자가 아닌 자리(= 단어 밖)에서는 거절한다 — 굵게와 같다.
    const other = mount(new MarkdownHost("abc  def\n"));
    other.select(5); // 공백 두 개 사이
    expect(other.exec({ t: "strike" })).toBe(false);
    expect(other.exec({ t: "bold" })).toBe(false);
    expect(other.save()).toBe("abc  def\n");
  });

  it("Ctrl+Shift+X 실제 keydown이 편집기에 닿고, Ctrl+Z 한 번에 되돌아간다", () => {
    const host = mount(new MarkdownHost("가나다 라마바\n"));
    host.select(1, 4);
    expect(press(host, { key: "x", shift: true })).toBe(true);
    expect(host.save()).toBe("~~가나다~~ 라마바\n");
    // 명령 하나 = 실행 취소 한 번.
    expect(press(host, { key: "z" })).toBe(true);
    expect(host.save()).toBe("가나다 라마바\n");
  });

  it("일반 텍스트 탭에서는 꺼져 있다", () => {
    const host = mount(new PlainHost(TXT));
    expect(host.query().canFormat).toBe(false);
    expect(host.query().strike).toBe(false);
    expect(host.exec({ t: "strike" })).toBe(false);
    expect(press(host, { key: "x", shift: true })).toBe(false);
    expect(host.save()).toBe(TXT);
  });
});

/**
 * `Esc`의 비대칭 — 점검(2026-11-08)에서 잡은 버그.
 *
 * `prosemirror-view`의 `captureKeyDown`은 Esc(keyCode 27)에 대해 **아무 일도 하지
 * 않고 `true`만** 돌려주므로 이벤트에 `preventDefault()`가 걸린다. `App`의 창 수준
 * keydown 처리기는 맨 앞에서 `defaultPrevented`를 걸러 내므로, 마크다운 탭에서는
 * Esc로 **찾기 카드가 닫히지 않고 펜 모드도 꺼지지 않았다**(일반 텍스트 탭에서는
 * 되는 비대칭). 고친 방법은 `App`에서 **편집 영역에서 올라온 Esc만** 예외로 두는
 * 것이고, 이 시험은 그 예외가 왜 필요한지를 못 박는다 — 위쪽 `press`와 달리 Ctrl을
 * 누르지 않는다.
 */
function pressEsc(host: DocHost): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "keyCode", { value: 27 });
  editableOf(host).dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Esc — 편집 영역에서 올라온 것은 App이 받아야 한다", () => {
  it("마크다운 탭은 Esc를 소비하고도 문서를 바꾸지 않는다 (App의 예외가 필요한 이유)", () => {
    const host = mount(new MarkdownHost(MD));
    host.select(3);
    expect(pressEsc(host)).toBe(true);
    // 편집기는 아무 일도 하지 않았다 — 막기만 했다.
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);
  });

  it("일반 텍스트 탭은 Esc를 소비하지 않는다 (같은 Esc가 탭마다 다르게 동작했다)", () => {
    const host = mount(new PlainHost(TXT));
    host.select(2);
    expect(pressEsc(host)).toBe(false);
    expect(host.save()).toBe(TXT);
  });
});
