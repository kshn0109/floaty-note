/**
 * 탭 이전 직렬화 왕복 (§5 · 단계 7의 완료 조건).
 *
 * **이 시험이 지키는 약속**: 탭을 다른 창으로 옮긴 뒤 `Ctrl+Z`가 이어서 동작하고
 * 미저장 표시가 그대로여야 한다. 창을 만들지 않고(그건 Tauri 쪽이다) 꾸러미가
 * `JSON.stringify` → `JSON.parse`를 건너도 같은 문서가 되는지만 본다 — 실제 이전도
 * IPC를 건너므로 그 왕복이 전부다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { freezeTab, thawTab, type TransferTab } from "../src/lib/transfer";

function meta(over: Partial<TransferTab> = {}): TransferTab {
  return {
    uid: "t1",
    name: null,
    path: null,
    tint: "none",
    dirty: false,
    format: "markdown",
    enc: "utf8",
    eol: "lf",
    bigMd: false,
    hidden: false,
    reminder: null,
    ...over,
  };
}

/** 꾸러미를 IPC처럼 한 번 건너게 한다. */
function hop(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe("왕복 — 마크다운 탭", () => {
  it("옮긴 뒤 Ctrl+Z가 이어서 동작한다 (실행 취소 스택이 따라간다)", () => {
    const from = new MarkdownHost("hello world\n");
    from.select(1, 6);
    from.exec({ t: "bold" });
    expect(from.save()).toBe("**hello** world\n");

    const got = thawTab(hop(freezeTab(meta({ dirty: true }), from.serialize(), 0)));
    expect(got).not.toBeNull();

    const to = new MarkdownHost("");
    to.restore(got!.doc);
    expect(to.save()).toBe("**hello** world\n");
    // 받은 창에서 Ctrl+Z 한 번 — 굵게가 풀린다.
    expect(to.undo()).toBe(true);
    expect(to.save()).toBe("hello world\n");
    expect(to.redo()).toBe(true);
    expect(to.save()).toBe("**hello** world\n");
  });

  it("미저장 표시가 그대로다 (저장했던 탭은 깨끗한 채로 간다)", () => {
    const dirty = new MarkdownHost("a\n");
    dirty.select(1, 2);
    dirty.exec({ t: "bold" });
    expect(dirty.isDirty()).toBe(true);
    const moved = new MarkdownHost("");
    moved.restore(thawTab(hop(freezeTab(meta(), dirty.serialize(), 0)))!.doc);
    expect(moved.isDirty()).toBe(true);

    const clean = new MarkdownHost("a\n");
    const same = new MarkdownHost("");
    same.restore(thawTab(hop(freezeTab(meta(), clean.serialize(), 0)))!.doc);
    expect(same.isDirty()).toBe(false);
  });

  it("원문 보존 기준이 따라가므로 **손대지 않은 글은 바이트가 같다**", () => {
    // 우리가 쓰지 않는 마크다운(각주·HTML)이 섞인 글. 왕복해도 글자 그대로여야 한다.
    const src = "# 제목\n\n본문 <kbd>A</kbd> 글자\n\n> 인용\n";
    const from = new MarkdownHost(src);
    const to = new MarkdownHost("");
    to.restore(thawTab(hop(freezeTab(meta(), from.serialize(), 0)))!.doc);
    expect(to.save()).toBe(src);
  });

  it("선택과 스크롤도 함께 간다", () => {
    const from = new MarkdownHost("hello\nworld\n");
    from.select(3, 5);
    from.noteScroll(240);
    const got = thawTab(hop(freezeTab(meta(), from.serialize(), 0)))!;
    expect(got.doc.scrollTop).toBe(240);
    const to = new MarkdownHost("");
    to.restore(got.doc);
    expect(to.selectionRange()).toEqual({ from: 2, to: 4 });
  });
});

describe("왕복 — 일반 텍스트 탭", () => {
  it("모드가 보존되고 실행 취소가 이어진다", () => {
    const from = new PlainHost("one two\n");
    from.select(0, 3);
    from.exec({ t: "insertText", text: "ONE" });
    expect(from.save()).toBe("ONE two\n");

    const got = thawTab(hop(freezeTab(meta({ format: "plain" }), from.serialize(), 2)))!;
    expect(got.doc.format).toBe("plain");
    expect(got.at).toBe(2);

    const to = new PlainHost("");
    to.restore(got.doc);
    expect(to.save()).toBe("ONE two\n");
    expect(to.undo()).toBe(true);
    expect(to.save()).toBe("one two\n");
  });
});

describe("탭 메타", () => {
  it("이름·경로·색·인코딩·줄바꿈·큰 파일 안내가 전부 따라간다", () => {
    const host = new MarkdownHost("x\n");
    const got = thawTab(
      hop(
        freezeTab(
          meta({
            uid: "abc-123",
            name: "메모.md",
            path: "C:\\dir\\메모.md",
            tint: "yellow",
            dirty: true,
            enc: "utf16le",
            eol: "crlf",
            bigMd: true,
          }),
          host.serialize(),
          1
        )
      )
    )!;
    expect(got.tab).toEqual({
      uid: "abc-123",
      name: "메모.md",
      path: "C:\\dir\\메모.md",
      tint: "yellow",
      dirty: true,
      format: "markdown",
      enc: "utf16le",
      eol: "crlf",
      bigMd: true,
      hidden: false,
      reminder: null,
    });
  });
});

describe("받은 꾸러미를 믿지 않는다 (IPC를 건너온 모르는 값)", () => {
  it("모양이 아니면 null — 탭 하나를 잃는 편이 창이 깨지는 것보다 낫다", () => {
    expect(thawTab(null)).toBeNull();
    expect(thawTab("hello")).toBeNull();
    expect(thawTab({})).toBeNull();
    // `uid`가 없으면 버퍼 이름을 만들 수 없다.
    expect(thawTab({ tab: { name: "a" }, doc: {}, at: 0 })).toBeNull();
  });

  it("빠진 칸은 기본값이다 (새 칸이 생겨도 옛 꾸러미가 읽힌다)", () => {
    const got = thawTab({ tab: { uid: "t9" } })!;
    expect(got.tab.tint).toBe("none");
    expect(got.tab.format).toBe("markdown");
    expect(got.tab.dirty).toBe(false);
    expect(got.doc.text).toBe("");
    expect(got.doc.history).toEqual({ done: [], undone: [], savedId: null, seq: 0 });
    expect(got.at).toBe(0);
  });

  it("모르는 색·인코딩·줄바꿈은 기본값으로 떨어진다", () => {
    const got = thawTab({
      tab: { uid: "t9", tint: "보라", enc: "euc-kr", eol: "lfcr", format: "rtf" },
    })!;
    expect(got.tab.tint).toBe("none");
    expect(got.tab.enc).toBe("utf8");
    expect(got.tab.eol).toBe("lf");
    expect(got.tab.format).toBe("markdown");
  });

  it("깨진 실행 취소 스택은 빈 스택으로 — 글은 그대로 간다", () => {
    const got = thawTab({
      tab: { uid: "t9" },
      doc: { text: "글\n", history: { done: 3 } },
    })!;
    expect(got.doc.text).toBe("글\n");
    expect(got.doc.history.done).toEqual([]);
  });

  it("들어갈 자리가 음수나 소수면 바로잡는다", () => {
    expect(thawTab({ tab: { uid: "t9" }, at: -4 })!.at).toBe(0);
    expect(thawTab({ tab: { uid: "t9" }, at: 2.6 })!.at).toBe(3);
  });
});
