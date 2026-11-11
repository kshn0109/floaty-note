import { EditorState } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { backingPlugin, backingSet } from "../src/lib/editor/MarkdownHost";
import { blocksToDoc, schema } from "../src/lib/md/pmdoc";
import { loadMarkdown } from "../src/lib/md/parse";

/**
 * 받침(`.backing`) 장식을 **글자 하나 입력에 문서 전체를 다시 세우지 않는지** 본다.
 *
 * 전에는 `docChanged`마다 `DecorationSet.create(tr.doc, …)`로 처음부터 다시 만들었다.
 * `prosemirror-view`의 `takeSpansForNode`가 맨 위 층 블록마다 장식 배열을 통째로
 * 훑으므로 블록 수의 **제곱**이고, 짧은 단락 1MB(≈36,000 블록)에서 타자 한 번에
 * 4.7초가 걸렸다(측정). 이제 `patchBacking`이 바뀐 블록만 고친다.
 *
 * 보는 것 둘:
 *   1) 1MB 문서에서 글자 하나 입력이 **50ms 아래**인가.
 *   2) 그 결과가 통째로 다시 만든 집합과 **똑같은가**(from/to/class 전부).
 *
 * DOM은 필요 없다 — `DecorationSet`은 순수 자료구조다(기본 환경 `node`).
 */

/** 짧은 단락으로 이루어진 `bytes` 크기쯤의 마크다운 문서. */
function paragraphDoc(bytes: number): PMNode {
  const line = "The quick brown fox jumps.";
  const n = Math.ceil(bytes / (line.length + 2));
  const md = Array.from({ length: n }, (_v, i) => `${line} ${i}`).join("\n\n");
  return blocksToDoc(loadMarkdown(md).blocks);
}

/** 집합을 비교할 수 있는 모양으로 — 자리와 속성만, 순서는 정렬로 고른다. */
function flatten(set: DecorationSet): string[] {
  return set
    .find()
    .map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`)
    .sort();
}

function stateWith(doc: PMNode): EditorState {
  return EditorState.create({ doc, schema, plugins: [backingPlugin] });
}

function backingOf(state: EditorState): DecorationSet {
  const found = state.plugins
    .map((p) => p.getState(state))
    .find((v): v is DecorationSet => v instanceof DecorationSet);
  if (!found) throw new Error("backing plugin state missing");
  return found;
}

describe("받침 장식은 바뀐 블록만 고친다", () => {
  it("1MB 문서에서 글자 하나 입력이 빠르고 결과가 전체 재구성과 같다", () => {
    const doc = paragraphDoc(1024 * 1024);
    expect(doc.childCount).toBeGreaterThan(20000);

    const state = stateWith(doc);

    // 문서 중간쯤의 단락에 한 글자.
    const mid = Math.floor(doc.content.size / 2);
    const $mid = doc.resolve(mid);
    const at = $mid.depth === 0 ? mid + 1 : mid;

    const t0 = performance.now();
    const next = state.apply(state.tr.insertText("x", at));
    const incremental = backingOf(next);
    const ms = performance.now() - t0;

    expect(flatten(incremental)).toEqual(flatten(backingSet(next.doc)));
    expect(ms).toBeLessThan(50);
  }, 120000);

  it("여러 가지 편집에서도 전체 재구성과 같다", () => {
    const md = [
      "# 머리글",
      "",
      "첫 단락입니다.",
      "",
      "- 하나",
      "- 둘",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "마지막 단락.",
      "",
      "",
      "끝.",
    ].join("\n");
    let state = stateWith(blocksToDoc(loadMarkdown(md).blocks));

    const edits: ((s: EditorState) => EditorState)[] = [
      // 단락 안에 글자
      (s) => s.apply(s.tr.insertText("가", 12)),
      // 단락 쪼개기(Enter)
      (s) => s.apply(s.tr.split(14)),
      // 두 블록 합치기(줄머리에서 Backspace)
      (s) => s.apply(s.tr.delete(13, 15)),
      // 빈 단락에 글자 — 전에 없던 장식이 생긴다
      (s) => s.apply(s.tr.insertText("새 글", s.doc.content.size - 6)),
      // 단락 비우기 — 장식이 사라진다
      (s) => {
        const $end = s.doc.resolve(s.doc.content.size);
        const last = $end.nodeBefore;
        if (!last || !last.isTextblock || last.content.size === 0) return s;
        const start = s.doc.content.size - 1 - last.content.size;
        return s.apply(s.tr.delete(start, start + last.content.size));
      },
      // 목록 항목에 글자
      (s) => s.apply(s.tr.insertText("!", 25)),
      // 맨 앞에 단락 끼우기
      (s) => s.apply(s.tr.insert(0, schema.nodes.paragraph.create(null, schema.text("앞")))),
      // 문서를 통째로 갈기(불러오기 — 전체 재구성 길)
      (s) =>
        s.apply(
          s.tr.replaceWith(
            0,
            s.doc.content.size,
            blocksToDoc(loadMarkdown("바뀐 글\n\n둘째 줄").blocks).content
          )
        ),
    ];

    for (let i = 0; i < edits.length; i += 1) {
      state = edits[i](state);
      expect(flatten(backingOf(state)), `편집 ${i}`).toEqual(flatten(backingSet(state.doc)));
    }
  });
});
