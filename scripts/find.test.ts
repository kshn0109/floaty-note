/**
 * 찾기/바꾸기 — 설계 문서 §8, 단계 10의 완료 조건.
 *
 * 검사 방식은 명령 시험과 같다: "찾기/바꾸기 → **저장될 문자열**". 화면(시안 F2)은
 * 사용자가 확인하고, 여기서는 원본 규격(`main.cpp` `RebuildMatches`/`ReplaceAll`,
 * USAGE §4의 찾기 절)과 맞대 볼 수 있는 성질만 본다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import {
  expandReplacement,
  runSearch,
  stepIndex,
  wordEdgesOk,
  type SearchQuery,
} from "../src/lib/editor/search";

const q = (text: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({
  text,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...extra,
});

const spans = (hits: { from: number; to: number }[] | null) =>
  hits?.map((h) => [h.from, h.to]) ?? null;

describe("글자 찾기 (원본 RebuildMatches)", () => {
  it("기본은 대소문자를 구별하지 않고, Aa를 켜면 구별한다", () => {
    expect(spans(runSearch("Memo memo MEMO", q("memo")))).toEqual([
      [0, 4],
      [5, 9],
      [10, 14],
    ]);
    expect(spans(runSearch("Memo memo MEMO", q("memo", { caseSensitive: true })))).toEqual([
      [5, 9],
    ]);
  });

  it("일치는 겹치지 않는다 (모든 편집기가 하는 방식)", () => {
    expect(spans(runSearch("aaaa", q("aa")))).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("단어 단위는 양 끝 바로 밖에 단어 글자가 붙으면 버린다", () => {
    expect(spans(runSearch("alpha alphabet", q("alpha", { wholeWord: true })))).toEqual([[0, 5]]);
    // 한글도 단어 글자로 본다(사용자 결정 2 — 마크다운 쪽과 같은 판정).
    expect(spans(runSearch("메모 메모장", q("메모", { wholeWord: true })))).toEqual([[0, 2]]);
    expect(wordEdgesOk("a_b", 1, 2)).toBe(false);
    expect(wordEdgesOk("a b", 1, 2)).toBe(true);
  });

  it("찾을 글자가 비면 일치 0개 (원본도 아무것도 세지 않는다)", () => {
    expect(runSearch("아무 글", q(""))).toEqual([]);
  });

  it("정규식: 폭 0 일치는 버리고, 틀린 정규식은 **null**(오류)이다", () => {
    expect(spans(runSearch("aab", q("a*", { regex: true })))).toEqual([[0, 2]]);
    expect(runSearch("abc", q("(", { regex: true }))).toBe(null);
    expect(runSearch("abc", q("[z-a]", { regex: true }))).toBe(null);
  });

  it("정규식은 대소문자 토글을 따르고 단어 단위와 함께 쓸 수 있다", () => {
    expect(spans(runSearch("Cat cat", q("c.t", { regex: true })))).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(
      spans(runSearch("Cat cat", q("c.t", { regex: true, caseSensitive: true })))
    ).toEqual([[4, 7]]);
    expect(
      spans(runSearch("cat category", q("c.t", { regex: true, wholeWord: true })))
    ).toEqual([[0, 3]]);
  });
});

describe("그룹 참조 ($1 · $& · $$)", () => {
  const m = /(\w+)@(\w+)/.exec("say bob@host end") as RegExpExecArray;

  it("원본 std::regex의 format과 같은 다섯 가지를 채운다", () => {
    expect(expandReplacement("$2/$1", m)).toBe("host/bob");
    expect(expandReplacement("[$&]", m)).toBe("[bob@host]");
    expect(expandReplacement("$$1", m)).toBe("$1");
    expect(expandReplacement("$`|$'", m)).toBe("say | end");
    // 없는 그룹은 빈 글자, `$x`는 글자 그대로.
    expect(expandReplacement("$3$x", m)).toBe("$x");
  });
});

describe("다음 / 이전 (끝에서 처음으로 돌아감)", () => {
  const hits = [
    { from: 0, to: 2 },
    { from: 10, to: 12 },
    { from: 20, to: 22 },
  ];

  it("앞으로: 선택된 일치는 건너뛰고, 끝에서 맨 위로 돌아간다", () => {
    expect(stepIndex(hits, 0, 0, true)).toBe(0); // 커서만 있으면 그 자리의 일치도 센다
    expect(stepIndex(hits, 0, 2, true)).toBe(1); // 일치가 선택되어 있으면 다음
    expect(stepIndex(hits, 20, 22, true)).toBe(0); // 랩어라운드
  });

  it("뒤로: 선택 앞의 마지막 일치, 맨 위에서 맨 아래로 돌아간다", () => {
    expect(stepIndex(hits, 20, 22, false)).toBe(1);
    expect(stepIndex(hits, 0, 2, false)).toBe(2); // 랩어라운드
    expect(stepIndex([], 0, 0, false)).toBe(-1);
  });
});

describe("마크다운 모드", () => {
  it("찾기 대상은 **보이는 글자**다 — 마커는 찾히지 않는다", () => {
    const host = new MarkdownHost("**굵게** 글\n");
    expect(host.plainText()).toBe("굵게 글");
    expect(host.search(q("굵게"))?.length).toBe(1);
    expect(host.search(q("**"))?.length).toBe(0);
  });

  it("검색만 한 뒤 저장하면 바이트가 같다 (원본도 테스트 항목)", () => {
    const src = "# 제목\n\n본문 메모와 메모\n";
    const host = new MarkdownHost(src);
    const hits = host.search(q("메모"));
    expect(hits?.length).toBe(2);
    host.selectHit(hits![1]);
    host.setHits(hits!, 1);
    expect(host.save()).toBe(src);
    expect(host.isDirty()).toBe(false);
  });

  it("모두 바꾸기는 **실행 취소 한 번**이다", () => {
    const src = "a a a\n";
    const host = new MarkdownHost(src);
    expect(host.replaceAll(q("a"), "b")).toBe(3);
    expect(host.save()).toBe("b b b\n");
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(src);
    expect(host.isDirty()).toBe(false);
    expect(host.undo()).toBe(false); // 항목이 하나뿐이었다
  });

  it("바뀐 글자는 일치가 시작하던 자리의 서식을 물려받는다", () => {
    const host = new MarkdownHost("**hello** world\n");
    const hits = host.search(q("hello"))!;
    expect(host.replaceHit(hits[0], "bye")).toBe(true);
    expect(host.save()).toBe("**bye** world\n");
  });

  it("정규식 그룹 치환이 문서에 적용된다", () => {
    const host = new MarkdownHost("ab cd\n");
    const query = q("(\\w)(\\w)", { regex: true });
    expect(host.replaceAll(query, "$2$1")).toBe(2);
    expect(host.save()).toBe("ba dc\n");
  });

  it("블록 경계를 걸친 일치는 찾히지만 바꾸지는 않는다 (문서 구조를 바꾸지 않는다)", () => {
    const src = "one\n\ntwo\n";
    const host = new MarkdownHost(src);
    expect(host.plainText()).toBe("one\ntwo");
    expect(host.search(q("e\nt"))?.length).toBe(1);
    expect(host.replaceAll(q("e\nt"), "X")).toBe(0);
    expect(host.save()).toBe(src);
  });

  it("표 안의 글자도 찾는다 (칸 순서대로, 칸 경계는 줄바꿈 하나)", () => {
    const host = new MarkdownHost("| a | 메모 |\n| --- | --- |\n| 메모 | d |\n");
    expect(host.search(q("메모"))?.length).toBe(2);
  });
});

describe("일반 텍스트 모드", () => {
  it("모두 바꾸기 개수와 실행 취소 한 번", () => {
    const src = "log a\nlog b\nlog c\n";
    const host = new PlainHost(src);
    expect(host.replaceAll(q("log"), "LOG")).toBe(3);
    expect(host.save()).toBe("LOG a\nLOG b\nLOG c\n");
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(src);
    expect(host.isDirty()).toBe(false);
  });

  it("검색·강조만 한 뒤 저장하면 바이트가 같다", () => {
    const src = "메모 하나\n메모 둘\n";
    const host = new PlainHost(src);
    const hits = host.search(q("메모"))!;
    expect(hits.length).toBe(2);
    host.selectHit(hits[0]);
    host.setHits(hits, 0);
    expect(host.save()).toBe(src);
    expect(host.isDirty()).toBe(false);
  });

  it("하나 바꾸기는 선택을 바꾼 글자 뒤에 둔다", () => {
    const host = new PlainHost("aaa\n");
    const hits = host.search(q("a"))!;
    expect(host.replaceHit(hits[1], "B")).toBe(true);
    expect(host.save()).toBe("aBa\n");
    expect(host.selectionRange()).toEqual({ from: 2, to: 2 });
  });
});
