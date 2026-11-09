/**
 * 파일 계층의 순수 부분 — 설계 문서 단계 5.
 *
 * 바이트를 읽고 쓰는 쪽(인코딩 감지·줄바꿈 정규화·원자적 교체)은 Rust에 있고 그쪽
 * 단위 시험(`src-tauri/src/textfile.rs` `mod tests`)이 본다. 여기서는 그 결과가
 * 상태 글자와 탭에 어떻게 보이는지, 그리고 **열고 바로 저장하면 바이트가 같은지**를 본다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { encName, eolName, leafOf } from "../src/lib/file";
import { setLangMode } from "../src/lib/i18n";
import { createTab, suggestedSaveName } from "../src/lib/tabs";

setLangMode("en");

describe("상태 글자의 인코딩·줄바꿈 이름 (원본 DocEncName / DocEolName)", () => {
  it("이름은 어느 언어에서나 같은 토큰이고, 단어인 둘만 표에서 온다", () => {
    expect(encName("utf8")).toBe("UTF-8");
    expect(encName("utf8Bom")).toBe("UTF-8 (BOM)");
    expect(encName("utf16le")).toBe("UTF-16 LE");
    expect(encName("ansi")).toBe("ANSI");
    expect(eolName("lf")).toBe("LF");
    expect(eolName("crlf")).toBe("CRLF");
    expect(eolName("cr")).toBe("CR");
    expect(eolName("mixed")).toBe("Mixed");
  });
});

describe("경로", () => {
  it("파일 이름만 떼어 낸다 (원본 PathLeaf)", () => {
    expect(leafOf("C:\\notes\\메모.md")).toBe("메모.md");
    expect(leafOf("/home/a/b.txt")).toBe("b.txt");
    expect(leafOf("메모.md")).toBe("메모.md");
  });

  it("제목 없는 탭의 기본 저장 이름은 `.txt`다 (사용자 결정 2026-11-09 — 메모장처럼)", () => {
    const tab = createTab("none");
    expect(tab.path).toBe(null);
    expect(tab.enc).toBe("utf8");
    expect(tab.eol).toBe("lf");
    expect(suggestedSaveName(tab)).toBe("Untitled.txt");
    expect(suggestedSaveName({ ...tab, path: "C:\\notes\\메모.md" })).toBe("메모.md");
  });
});

describe("열고 바로 저장하면 바이트가 같다 (단계 5의 완료 조건)", () => {
  // 읽기 계층은 늘 LF로 정규화한 문자열을 준다 — 그것이 `fileSrc`이고 보존의 기준이다.
  const samples = [
    "# 제목\n\n본문 한 줄\n",
    "C:\\Users\\ksch3\\메모.md 경로가 든 줄\n",
    "| a | b |\n| :--- | ---: |\n| 1 | 2 |\n",
    "__굵게__ 와 _기울임_ 과 `코드`\n",
    "- 목록\n- 항목\n\n> 인용\n",
    "끝에 줄바꿈이 없는 파일",
    "\n",
    "",
  ];

  it("마크다운: 손대지 않은 문서는 읽은 바이트 그대로 돌아온다", () => {
    for (const src of samples) {
      const host = new MarkdownHost(src);
      expect(host.save()).toBe(src);
      expect(host.isDirty()).toBe(false);
    }
  });

  it("일반 텍스트: 문자열 그대로", () => {
    for (const src of samples) {
      const host = new PlainHost(src);
      expect(host.save()).toBe(src);
      expect(host.plainText()).toBe(src);
    }
  });

  it("마크다운 탭을 `.txt`로 저장할 때 쓰는 글자는 **보이는 글자**다", () => {
    // 서식이 버려지는 자리(원본 SaveToPath의 PlainDocText 분기).
    const host = new MarkdownHost("# 제목\n\n**굵게** 글\n");
    expect(host.save()).toBe("# 제목\n\n**굵게** 글\n");
    expect(host.plainText()).toBe("제목\n굵게 글");
  });

  it("저장한 뒤에는 그 바이트가 새 보존 기준이 된다", () => {
    const host = new MarkdownHost("one\n");
    host.select(1, 4);
    host.exec({ t: "insertText", text: "two" });
    expect(host.isDirty()).toBe(true);
    const written = host.save();
    expect(written).toBe("two\n");
    host.markSaved();
    expect(host.isDirty()).toBe(false);
    expect(host.save()).toBe(written);
  });
});
