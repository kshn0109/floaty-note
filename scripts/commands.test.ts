/**
 * 편집 명령 — 굵게 · H1~H3 · 형광펜 · 표 (설계 문서 §7, 단계 6~8의 완료 조건).
 *
 * 검사 방식은 "명령 → **저장될 문자열**"이다. 화면이 아니라 파일로 나가는 바이트를 보므로
 * 원본 규격(USAGE §5·`main.cpp`)과 직접 맞대 볼 수 있다. UI는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { HIGHLIGHTS } from "../src/lib/palette";

/** 블록 하나뿐인 문서에서 글자 n번째 앞 위치(단락 안쪽은 1부터). */
const at = (n: number) => 1 + n;

describe("굵게 (Ctrl+B)", () => {
  it("선택 범위에 적용하고, 다시 누르면 해제한다", () => {
    const host = new MarkdownHost("hello world\n");
    host.select(at(0), at(5));
    expect(host.exec({ t: "bold" })).toBe(true);
    expect(host.save()).toBe("**hello** world\n");
    expect(host.query().bold).toBe(true);
    host.exec({ t: "bold" });
    expect(host.save()).toBe("hello world\n");
    expect(host.query().bold).toBe(false);
  });

  it("선택이 없으면 커서 위치의 **단어**에 적용한다 (원본 SCF_WORD)", () => {
    const host = new MarkdownHost("hello world\n");
    host.select(at(8)); // "world" 안쪽
    expect(host.exec({ t: "bold" })).toBe(true);
    expect(host.save()).toBe("hello **world**\n");
  });

  it("한글·숫자·밑줄도 한 단어다", () => {
    const host = new MarkdownHost("앞 한글_단어1 뒤\n");
    host.select(at(4));
    expect(host.exec({ t: "bold" })).toBe(true);
    expect(host.save()).toBe("앞 **한글_단어1** 뒤\n");
  });

  it("단어 밖(양쪽이 공백)에서는 아무 일도 하지 않는다", () => {
    const host = new MarkdownHost("앞  뒤\n");
    host.select(at(2)); // 두 공백 사이
    expect(host.exec({ t: "bold" })).toBe(false);
    expect(host.save()).toBe("앞  뒤\n");
    expect(host.isDirty()).toBe(false);
  });

  it("단어 바로 뒤의 커서는 그 단어에 속한다 (원본 SCF_WORD와 같다)", () => {
    const host = new MarkdownHost("hello world\n");
    host.select(at(5)); // "hello" 바로 뒤
    expect(host.exec({ t: "bold" })).toBe(true);
    expect(host.save()).toBe("**hello** world\n");
  });

  it("섞여 있으면 켜진다 (원본: mixed run turns the effect on)", () => {
    const host = new MarkdownHost("**굵게** 보통\n");
    host.select(at(0), at(6));
    host.exec({ t: "bold" });
    expect(host.save()).toBe("**굵게 보통**\n");
  });

  it("Ctrl+Z 한 번으로 복원된다", () => {
    const host = new MarkdownHost("hello world\n");
    host.select(at(0), at(5));
    host.exec({ t: "bold" });
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe("hello world\n");
  });
});

describe("제목 H1~H3 (Ctrl+1/2/3)", () => {
  it("단락을 제목으로 바꾸고, 같은 레벨을 다시 누르면 본문으로", () => {
    const host = new MarkdownHost("본문\n");
    host.select(at(1));
    expect(host.exec({ t: "heading", level: 2 })).toBe(true);
    expect(host.save()).toBe("## 본문\n");
    expect(host.query().heading).toBe(2);
    expect(host.exec({ t: "heading", level: 2 })).toBe(true);
    expect(host.save()).toBe("본문\n");
    expect(host.query().heading).toBe(0);
  });

  it("다른 레벨을 누르면 레벨만 바뀐다", () => {
    const host = new MarkdownHost("# 제목\n");
    host.select(at(1));
    host.exec({ t: "heading", level: 3 });
    expect(host.save()).toBe("### 제목\n");
  });

  it("선택에 걸친 모든 단락이 함께 바뀐다 (단락 단위)", () => {
    const host = new MarkdownHost("첫 줄\n\n둘째 줄\n");
    // 첫 단락 안 ~ 둘째 단락 안
    host.select(at(1), at(1) + 6 + 2);
    expect(host.exec({ t: "heading", level: 1 })).toBe(true);
    expect(host.save()).toBe("# 첫 줄\n\n# 둘째 줄\n");
  });

  it("Ctrl+Z 한 번으로 복원된다", () => {
    const host = new MarkdownHost("첫 줄\n\n둘째 줄\n");
    host.select(at(1), at(1) + 6 + 2);
    host.exec({ t: "heading", level: 1 });
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe("첫 줄\n\n둘째 줄\n");
  });

  it("표 안에서는 비활성이다", () => {
    const host = new MarkdownHost("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    host.select(3); // 첫 칸 안쪽
    expect(host.query().inTable).toBe(true);
    expect(host.exec({ t: "heading", level: 1 })).toBe(false);
  });
});

describe("형광펜 5색 · 지우기 · 펜 모드", () => {
  it("기본색은 `==`로, 나머지 네 색은 `<mark style>`로 저장된다", () => {
    for (const [i, color] of HIGHLIGHTS.entries()) {
      const host = new MarkdownHost("칠할 글자\n");
      host.select(at(0), at(2));
      expect(host.exec({ t: "highlight", color })).toBe(true);
      const out = host.save();
      if (i === 0) expect(out).toBe("==칠할== 글자\n");
      else expect(out).toBe(`<mark style="background:${color}">칠할</mark> 글자\n`);
    }
  });

  it("같은 색을 다시 적용하면 해제된다 (원본 uniform && cur == color)", () => {
    const host = new MarkdownHost("칠할 글자\n");
    host.select(at(0), at(2));
    host.exec({ t: "highlight", color: HIGHLIGHTS[2] });
    expect(host.save()).toContain("<mark");
    host.exec({ t: "highlight", color: HIGHLIGHTS[2] });
    expect(host.save()).toBe("칠할 글자\n");
  });

  it("다른 색을 적용하면 색만 바뀐다", () => {
    const host = new MarkdownHost("칠할 글자\n");
    host.select(at(0), at(2));
    host.exec({ t: "highlight", color: HIGHLIGHTS[1] });
    host.exec({ t: "highlight", color: HIGHLIGHTS[3] });
    expect(host.save()).toBe(`<mark style="background:${HIGHLIGHTS[3]}">칠할</mark> 글자\n`);
  });

  it("지우기는 색을 전부 없앤다", () => {
    const host = new MarkdownHost('==하나== <mark style="background:#7FDBFF">둘</mark>\n');
    host.exec({ t: "selectAll" });
    expect(host.exec({ t: "highlight", color: null })).toBe(true);
    expect(host.save()).toBe("하나 둘\n");
  });

  it("선택이 없으면 아무 일도 하지 않는다 (그때 부르는 쪽이 펜 모드를 켠다)", () => {
    const host = new MarkdownHost("글자\n");
    host.select(at(1));
    expect(host.exec({ t: "highlight", color: HIGHLIGHTS[0] })).toBe(false);
  });

  it("펜 모드(toggle: false)는 이미 칠해진 범위를 지우지 않는다", () => {
    const host = new MarkdownHost("칠할 글자\n");
    host.select(at(0), at(2));
    host.exec({ t: "highlight", color: HIGHLIGHTS[0], toggle: false });
    expect(host.save()).toBe("==칠할== 글자\n");
    // 같은 범위에 또 칠해도 토글이 아니다 = 끌 때마다 깜빡이지 않는다.
    expect(host.exec({ t: "highlight", color: HIGHLIGHTS[0], toggle: false })).toBe(false);
    expect(host.save()).toBe("==칠할== 글자\n");
  });

  it("Ctrl+Z 한 번으로 복원된다", () => {
    const host = new MarkdownHost("칠할 글자\n");
    host.select(at(0), at(2));
    host.exec({ t: "highlight", color: HIGHLIGHTS[4] });
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe("칠할 글자\n");
  });
});

describe("표 삽입 (Ctrl+Shift+L)", () => {
  it("빈 문서(빈 단락)에서는 그 자리에 들어간다", () => {
    const host = new MarkdownHost("");
    expect(host.exec({ t: "table", rows: 2, cols: 3 })).toBe(true);
    expect(host.save()).toBe("|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n");
  });

  it("글이 있는 단락 **뒤에** 새 블록으로 들어간다", () => {
    const host = new MarkdownHost("앞 문단\n");
    host.select(at(1));
    host.exec({ t: "table", rows: 2, cols: 2 });
    expect(host.save()).toBe("앞 문단\n\n|  |  |\n| --- | --- |\n|  |  |\n");
  });

  it("문서 가운데 단락 뒤에 들어가고 뒤 문단은 그대로다", () => {
    const host = new MarkdownHost("앞\n\n뒤\n");
    host.select(at(0));
    host.exec({ t: "table", rows: 2, cols: 1 });
    expect(host.save()).toBe("앞\n\n|  |\n| --- |\n|  |\n\n뒤\n");
  });

  it("커서가 첫 칸에 간다 (원본과 같다)", () => {
    const host = new MarkdownHost("");
    host.exec({ t: "table", rows: 3, cols: 3 });
    expect(host.query().inTable).toBe(true);
    // 첫 칸에 바로 글자를 칠 수 있다.
    host.exec({ t: "insertText", text: "머리" });
    expect(host.save().startsWith("| 머리 |  |  |")).toBe(true);
  });

  it("표 안에서는 표를 넣지 않는다", () => {
    const host = new MarkdownHost("| a |\n| --- |\n| 1 |\n");
    host.select(3);
    expect(host.exec({ t: "table", rows: 2, cols: 2 })).toBe(false);
  });

  it("정렬은 왕복한다 (머리 행의 값이 파일로 나간다)", () => {
    const md = "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n";
    const host = new MarkdownHost(md);
    // 손대지 않으면 바이트 그대로 (원문 보존).
    expect(host.save()).toBe(md);
    // 한 칸을 고치면 그 블록은 다시 직렬화된다 → 왼쪽 정렬의 `:---`가 `---`로
    // 정규화되는 것은 **편집한 블록에만** 적용되는 원본 규칙이다(USAGE §5 / 설계 §4-3).
    // 가운데·오른쪽 정렬은 표현이 하나뿐이라 그대로 남는다.
    host.select(3, 4);
    host.exec({ t: "insertText", text: "A" });
    expect(host.save()).toBe("| A | b | c |\n| --- | :---: | ---: |\n| 1 | 2 | 3 |\n");
    // 다시 읽어도 정렬은 같다.
    const again = new MarkdownHost(host.save());
    expect(again.save()).toBe(host.save());
  });

  it("Ctrl+Z 한 번으로 복원된다", () => {
    const host = new MarkdownHost("앞 문단\n");
    host.select(at(1));
    host.exec({ t: "table", rows: 4, cols: 4 });
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe("앞 문단\n");
  });
});

describe("붙여넣기·평문 넣기", () => {
  it("붙어 있는 줄은 한 단락(소프트 줄바꿈), 빈 줄은 단락을 쪼갠다", () => {
    const host = new MarkdownHost("");
    host.exec({ t: "insertText", text: "한 줄\n붙은 줄\n\n새 단락" });
    expect(host.save()).toBe("한 줄\n붙은 줄\n\n새 단락\n");
  });

  it("마크다운 문법은 해석하지 않는다 (붙여넣은 `#`는 글자 `#`다)", () => {
    const host = new MarkdownHost("");
    host.exec({ t: "insertText", text: "# 제목처럼 보이는 글" });
    // 글자로 남으므로 저장할 때 이스케이프된다 = 다시 열어도 단락이다.
    expect(host.save()).toBe("\\# 제목처럼 보이는 글\n");
    const again = new MarkdownHost(host.save());
    expect(again.query().heading).toBe(0);
  });
});

describe("일반 텍스트 모드의 서식 비활성 (사용자 결정 3)", () => {
  it("서식 명령은 모두 아무 일도 하지 않고 canFormat이 false다", () => {
    const host = new PlainHost("로그 한 줄\n");
    expect(host.query().canFormat).toBe(false);
    expect(host.exec({ t: "bold" })).toBe(false);
    expect(host.exec({ t: "heading", level: 1 })).toBe(false);
    expect(host.exec({ t: "highlight", color: HIGHLIGHTS[0] })).toBe(false);
    expect(host.exec({ t: "table", rows: 2, cols: 2 })).toBe(false);
    expect(host.save()).toBe("로그 한 줄\n");
    expect(host.isDirty()).toBe(false);
  });
});
