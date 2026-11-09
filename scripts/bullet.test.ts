// @vitest-environment happy-dom
/**
 * 글머리 기호 목록 — 승인된 시안 L1.
 *
 * 가장 중요한 것이 맨 앞에 있다: **목록 문법이 들어 있는 기존 파일을 열고 그냥 저장하면
 * 바이트가 한 개도 바뀌지 않아야 한다**(사용자 지시). 마커(`-`·`*`·`+`)·들여쓰기·마커
 * 뒤 여분 스페이스까지 원문 그대로다.
 *
 * 그 다음이 명령(`toggleBullet`)과 키(Enter·Tab·Backspace·입력 규칙)다. 검사 방식은
 * 다른 명령 검사와 같다: 명령 → **저장될 문자열**. UI를 그리지 않는다.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { backingRanges, MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { docLineIndex, lineColAt } from "../src/lib/editor/mdStats";
import { blocksToDoc, docToBlocks } from "../src/lib/md/pmdoc";
import { loadMarkdown, parseMarkdown } from "../src/lib/md/parse";
import { serializeMarkdown, serializeWithSource } from "../src/lib/md/serialize";
import { blockListsEqual } from "../src/lib/md/types";

/** 파서 → PM 문서 → 파서 → 저장. 세 경로를 한 번에 본다. */
function roundtrip(md: string) {
  const base = loadMarkdown(md);
  const back = docToBlocks(blocksToDoc(base.blocks));
  return {
    base,
    back,
    /** 손대지 않고 저장(원문 보존 경로 — 실제 저장이 쓰는 길). */
    kept: serializeWithSource(back, base),
    /** 늘 재직렬화(새 문서 경로). */
    fresh: serializeMarkdown(back),
  };
}

describe("기존 파일의 바이트 — 열고 저장해도 그대로", () => {
  /** `[이름, 바이트, 늘 재직렬화도 같은가]` — 세 번째가 false인 것은 **목록과 무관한**
      기존 정규화(파일 끝 줄바꿈 · 표 칸 공백 · 글자 `- `의 이스케이프)다. 실제 저장이
      쓰는 길은 원문 보존(`kept`)이고 그쪽은 전부 바이트 동일이어야 한다. */
  const samples: [string, string, boolean?][] = [
    ["빗금 마커", "- 하나\n- 둘\n"],
    ["별 마커", "* 하나\n* 둘\n"],
    ["더하기 마커", "+ 하나\n+ 둘\n"],
    ["마커가 섞여 있다", "- 하나\n* 둘\n+ 셋\n"],
    ["중첩 2칸", "- 하나\n  - 둘\n- 셋\n"],
    ["중첩 4칸(들여쓰기 그대로)", "- 하나\n    - 깊게\n        - 더 깊게\n"],
    ["중첩 들여쓰기 1칸", "- 하나\n - 둘\n"],
    ["마커 뒤 스페이스가 여럿", "-   넉넉히\n"],
    ["항목 글자가 비어 있다", "- \n"],
    ["체크박스(그냥 글자)", "- [ ] 할 일\n- [x] 끝난 일\n"],
    ["항목 안 서식", "- **굵게** 와 ==형광==\n"],
    ["항목 글자가 #로 시작", "- # 샵으로 시작\n"],
    ["앞뒤 문단과 섞여 있다", "앞 문단\n\n- 하나\n- 둘\n\n뒤 문단\n"],
    ["제목 아래 목록", "# 제목\n\n- 하나\n"],
    ["목록 사이 빈 줄", "- 하나\n\n- 둘\n"],
    ["끝 줄바꿈 없음", "- 하나", false],
    // 목록이 **아닌** 것들 — 바이트가 바뀌면 안 되는 쪽이 더 중요하다.
    ["수평선은 목록이 아니다", "---\n"],
    ["마커만(스페이스 없음)", "-\n*\n+\n"],
    ["탭 들여쓰기는 목록이 아니다", "\t- 탭\n"],
    ["번호 목록은 목록이 아니다", "1. 하나\n2. 둘\n"],
    // 글자 `- `는 다시 적을 때 `\- `로 이스케이프된다(그래야 다시 읽어도 목록이 아니다).
    ["글 줄과 섞인 묶음은 글자 그대로", "설명:\n- 하나\n- 둘\n", false],
    // 표 칸 공백은 전부터 정규화된다(목록과 무관).
    ["표가 먼저다", "- a | b\n| --- | --- |\n| 1 | 2 |\n", false],
  ];

  for (const [name, md, freshToo = true] of samples) {
    it(name, () => {
      const r = roundtrip(md);
      // 스키마 무손실 — PM 문서를 거쳐도 블록이 같다.
      expect(blockListsEqual(r.base.blocks, r.back)).toBe(true);
      // 바이트 동일 — 열고 그냥 저장한 길(원문 보존).
      expect(r.kept).toBe(md);
      if (freshToo) expect(r.fresh).toBe(md);
      // 저장한 것을 다시 읽어도 같은 문서다.
      expect(blockListsEqual(parseMarkdown(r.fresh).blocks, r.back)).toBe(true);
    });
  }

  it("편집기를 거쳐도 같다 (MarkdownHost.save)", () => {
    for (const [, md] of samples) expect(new MarkdownHost(md).save()).toBe(md);
  });

  it("목록 줄이 블록 하나로 읽힌다 — 항목 사이에 빈 줄이 끼지 않는다", () => {
    const p = parseMarkdown("- 하나\n  - 둘\n- 셋\n");
    expect(p.blocks.length).toBe(1);
    expect(p.blocks[0].kind).toBe("list");
    if (p.blocks[0].kind === "list") {
      expect(p.blocks[0].items.map((i) => i.level)).toEqual([0, 1, 0]);
      expect(p.blocks[0].items.map((i) => i.indent)).toEqual(["", "  ", ""]);
    }
  });

  it("글 줄 + 목록이 섞인 묶음은 목록이 아니다 (바이트 보존이 먼저다)", () => {
    const p = parseMarkdown("설명:\n- 하나\n");
    expect(p.blocks.length).toBe(1);
    expect(p.blocks[0].kind).toBe("para");
  });

  it("글자 `- `로 시작하는 단락은 이스케이프해서 적는다 (다시 읽어도 목록이 아니다)", () => {
    const host = new MarkdownHost("");
    host.exec({ t: "insertText", text: "- 그냥 글자" });
    const md = host.save();
    expect(md).toBe("\\- 그냥 글자\n");
    expect(parseMarkdown(md).blocks[0].kind).toBe("para");
    expect(new MarkdownHost(md).plainText()).toBe("- 그냥 글자");
  });
});


// ---------------------------------------------------------------------------

/**
 * 커서·선택을 **보이는 글자 번호**로 둔다(`selectHit`이 평문 번호 → 문서 자리 변환을
 * 한다 — 찾기가 쓰는 그 길이다). 문서 자리를 손으로 세지 않아도 된다.
 */
const caret = (host: MarkdownHost, from: number, to = from): void =>
  host.selectHit({ from, to });

/** 줄바꿈으로 이어진 한 단락(`heading-lines.test.ts`와 같은 문서). */
const SOFT = "첫 줄\n둘째 줄\n셋째 줄\n";

describe("toggleBullet — 줄 단위", () => {
  it("커서 줄 하나가 항목이 된다", () => {
    const host = new MarkdownHost("한 줄\n");
    caret(host, 2);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 한 줄\n");
    expect(host.query().bullet).toBe(true);
  });

  it("다시 누르면 해제된다", () => {
    const host = new MarkdownHost("- 한 줄\n");
    caret(host, 2);
    expect(host.query().bullet).toBe(true);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("한 줄\n");
    expect(host.query().bullet).toBe(false);
  });

  it("두 단락 선택 — 줄마다 항목(목록 하나)", () => {
    // `하나\n\n둘`의 빈 줄은 빈 단락이 아니라 **구분 줄**이다(§4-2) → 단락 두 개.
    const host = new MarkdownHost("하나\n\n둘\n");
    caret(host, 0, host.plainText().length);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 하나\n- 둘\n");
  });

  it("빈 단락이 걸려도 그 줄에는 `- `가 생기지 않는다", () => {
    const host = new MarkdownHost("하나\n\n\n둘\n"); // 가운데가 빈 단락 하나
    caret(host, 0, host.plainText().length);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 하나\n\n\n- 둘\n");
  });

  it("소프트 줄바꿈 단락의 가운데 줄만", () => {
    const host = new MarkdownHost(SOFT);
    caret(host, 5, 7); // "둘째 줄" 안쪽 일부
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("첫 줄\n\n- 둘째 줄\n\n셋째 줄\n");
  });

  it("소프트 줄바꿈 단락의 세 줄 모두 → 목록 하나", () => {
    const host = new MarkdownHost(SOFT);
    caret(host, 0, host.plainText().length);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 첫 줄\n- 둘째 줄\n- 셋째 줄\n");
  });

  it("제목 줄에 걸면 본문 항목이 된다", () => {
    const host = new MarkdownHost("# 제목\n");
    caret(host, 1);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 제목\n");
  });

  it("목록 가운데 항목만 해제하면 목록이 둘로 갈린다", () => {
    const host = new MarkdownHost("- 하나\n- 둘\n- 셋\n");
    caret(host, host.plainText().indexOf("둘") + 1);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("- 하나\n\n둘\n\n- 셋\n");
  });

  it("중첩된 목록에서 부모만 해제하면 자식이 목록으로 남는다", () => {
    const host = new MarkdownHost("- 하나\n  - 깊게\n");
    caret(host, 1);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).toBe("하나\n\n- 깊게\n");
  });

  it("실행 취소 한 번에 되돌아간다", () => {
    const host = new MarkdownHost(SOFT);
    caret(host, 5, 7);
    expect(host.exec({ t: "bullet" })).toBe(true);
    expect(host.save()).not.toBe(SOFT);
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(SOFT);
    expect(host.undo()).toBe(false);
  });

  it("바뀔 것이 없으면 아무 일도 하지 않는다 (실행 취소에 빈 항목이 안 남는다)", () => {
    const host = new MarkdownHost("- 하나\n");
    caret(host, 1);
    host.exec({ t: "bullet" }); // 해제
    host.exec({ t: "bullet" }); // 다시 항목
    expect(host.save()).toBe("- 하나\n");
    expect(host.undo()).toBe(true);
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe("- 하나\n");
    expect(host.undo()).toBe(false);
  });

  it("표 안에서는 아무 일도 하지 않는다", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const host = new MarkdownHost(md);
    caret(host, 1);
    expect(host.exec({ t: "bullet" })).toBe(false);
    expect(host.save()).toBe(md);
  });

  it("일반 텍스트 탭에는 목록이 없다 (query.bullet 거짓)", () => {
    expect(new MarkdownHost("한 줄\n").query().canFormat).toBe(true);
  });
});

describe("키 — Enter · Tab · Backspace · 입력 규칙", () => {
  /** 편집기 DOM에 진짜 `keydown`을 보낸다(`keys.test.ts`와 같은 방식). */
  function press(
    host: MarkdownHost,
    init: { key: string; code: string; shiftKey?: boolean; ctrlKey?: boolean; keyCode?: number }
  ): boolean {
    const root = mounts.get(host);
    if (!root) throw new Error("mount()를 먼저 불러야 한다");
    const dom = root.querySelector<HTMLElement>("[contenteditable]") ?? root;
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    // happy-dom의 `KeyboardEventInit`에는 `keyCode`가 없다 — `prosemirror-keymap`이
    // Shift+숫자(`Ctrl+Shift+8`)를 풀 때 읽는 값이라 직접 심어 준다.
    Object.defineProperty(event, "keyCode", { value: init.keyCode ?? 0 });
    dom.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const mounts = new WeakMap<MarkdownHost, HTMLElement>();

  /** 화면에 붙인다 — DOM만 쓰고 그림은 보지 않는다(UI 자동 시험이 아니다). */
  function mounted(md: string): MarkdownHost {
    const host = new MarkdownHost(md);
    const root = document.createElement("div");
    document.body.appendChild(root);
    host.mount(root);
    mounts.set(host, root);
    return host;
  }

  const ENTER = { key: "Enter", code: "Enter", keyCode: 13 };
  const TAB = { key: "Tab", code: "Tab", keyCode: 9 };
  const BACK = { key: "Backspace", code: "Backspace", keyCode: 8 };

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("항목 끝에서 Enter → 다음 항목", () => {
    const host = mounted("- 하나\n");
    caret(host, 2);
    expect(press(host, ENTER)).toBe(true);
    expect(host.save()).toBe("- 하나\n- \n");
    host.exec({ t: "insertText", text: "둘" });
    expect(host.save()).toBe("- 하나\n- 둘\n");
  });

  it("항목 가운데서 Enter → 뒤 글자가 다음 항목으로", () => {
    const host = mounted("- 하나둘\n");
    caret(host, 2);
    press(host, ENTER);
    expect(host.save()).toBe("- 하나\n- 둘\n");
  });

  it("빈 항목에서 Enter → 목록 끝(본문)", () => {
    const host = mounted("- 하나\n- \n");
    caret(host, 3); // 빈 둘째 항목
    expect(host.query().bullet).toBe(true);
    press(host, ENTER);
    expect(host.save()).toBe("- 하나\n\n");
    expect(host.query().bullet).toBe(false);
  });

  it("목록 밖의 Enter는 평소대로다 (단락 쪼개기)", () => {
    const host = mounted("하나\n");
    caret(host, 2);
    press(host, ENTER);
    expect(host.save()).toBe("하나\n\n");
  });

  it("Tab → 중첩(2칸), Shift+Tab → 해제", () => {
    const host = mounted("- 하나\n- 둘\n");
    caret(host, host.plainText().indexOf("둘") + 1);
    expect(press(host, TAB)).toBe(true);
    expect(host.save()).toBe("- 하나\n  - 둘\n");
    press(host, { ...TAB, shiftKey: true });
    expect(host.save()).toBe("- 하나\n- 둘\n");
  });

  it("첫 항목은 더 들여쓸 수 없다", () => {
    const host = mounted("- 하나\n");
    caret(host, 1);
    press(host, TAB);
    expect(host.save()).toBe("- 하나\n");
  });

  it("중첩 항목에서 Enter는 같은 깊이로 이어진다", () => {
    const host = mounted("- 하나\n  - 깊게\n");
    caret(host, host.plainText().length);
    press(host, ENTER);
    host.exec({ t: "insertText", text: "또" });
    expect(host.save()).toBe("- 하나\n  - 깊게\n  - 또\n");
  });

  it("항목 맨 앞 Backspace → 내어쓰기 → 항목 해제", () => {
    const host = mounted("- 하나\n  - 둘\n");
    caret(host, host.plainText().indexOf("둘"));
    press(host, BACK);
    expect(host.save()).toBe("- 하나\n- 둘\n");
    press(host, BACK);
    expect(host.save()).toBe("- 하나\n\n둘\n");
  });

  it("Ctrl+Shift+8이 토글이다", () => {
    const host = mounted("한 줄\n");
    caret(host, 2);
    expect(
      press(host, { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true, keyCode: 56 })
    ).toBe(true);
    expect(host.save()).toBe("- 한 줄\n");
  });

  /** 입력 규칙은 PM이 **글자 입력**에서 부르는 `handleTextInput`이다. */
  function textInput(host: MarkdownHost, at: number, text: string): boolean {
    const view = (host as unknown as { view: TextInputView }).view;
    return (
      view.someProp("handleTextInput", (f) => f(view, at, at, text)) === true
    );
  }

  interface TextInputView {
    someProp(
      name: "handleTextInput",
      f: (h: (v: unknown, from: number, to: number, text: string) => boolean) => boolean
    ): boolean | undefined;
  }

  it("줄 맨 앞에 `- `를 치면 항목이 된다", () => {
    const host = mounted("");
    host.exec({ t: "insertText", text: "-" });
    expect(textInput(host, 2, " ")).toBe(true);
    expect(host.save()).toBe("- \n");
    host.exec({ t: "insertText", text: "하나" });
    expect(host.save()).toBe("- 하나\n");
  });

  it("`* `·`+ `도 받지만 새 항목의 마커는 `-`다", () => {
    for (const ch of ["*", "+"]) {
      const host = mounted("");
      host.exec({ t: "insertText", text: ch });
      expect(textInput(host, 2, " ")).toBe(true);
      host.exec({ t: "insertText", text: "하나" });
      expect(host.save()).toBe("- 하나\n");
    }
  });

  it("줄 가운데의 `- `는 입력 규칙이 아니다", () => {
    const host = mounted("");
    host.exec({ t: "insertText", text: "a-" });
    expect(textInput(host, 3, " ")).toBe(false);
  });

  it("이미 항목이면 입력 규칙이 또 걸리지 않는다", () => {
    const host = mounted("- \n");
    caret(host, 0);
    host.exec({ t: "insertText", text: "-" });
    expect(textInput(host, 4, " ")).toBe(false);
  });
});

describe("표시 — 받침과 줄 셈이 목록 안에서도 줄마다", () => {
  const docOf = (md: string) => blocksToDoc(loadMarkdown(md).blocks);

  it("받침(.backing)은 항목 **줄마다** 하나다", () => {
    const doc = docOf("- 하나\n  - 깊게\n- 셋\n");
    const ranges = backingRanges(doc);
    expect(ranges.length).toBe(3);
    for (const r of ranges) {
      expect(doc.textBetween(r.from, r.to, "", "")).not.toBe("");
    }
    expect(ranges.map((r) => doc.textBetween(r.from, r.to, "", ""))).toEqual([
      "하나",
      "깊게",
      "셋",
    ]);
  });

  it("빈 항목에는 받침이 없다 (범위가 0이면 칠할 것이 없다)", () => {
    expect(backingRanges(docOf("- \n")).length).toBe(0);
  });

  it("줄 수·줄 번호는 항목마다 1씩 늘어난다", () => {
    const doc = docOf("- 하나\n- 둘\n- 셋\n");
    expect(docLineIndex(doc).lines).toBe(3);
    const at = (text: string) => {
      let pos = 0;
      doc.descendants((node, p) => {
        if (node.isText && node.text === text) pos = p;
        return true;
      });
      return pos;
    };
    expect(lineColAt(doc, at("하나")).line).toBe(1);
    expect(lineColAt(doc, at("둘")).line).toBe(2);
    expect(lineColAt(doc, at("셋") + 1).line).toBe(3);
  });
});
