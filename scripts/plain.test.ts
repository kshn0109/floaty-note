/**
 * 일반 텍스트 모드 — spike `docs/editor-spike/cm.mjs`를 vitest로 옮긴 것 (설계 문서 §3-2 · §5).
 *
 * `@codemirror/state`만 쓴다(`@codemirror/view`는 DOM이 있어야 한다). 여기서 보는 것은
 * **문서와 실행취소의 성질**이고, 화면은 사용자가 확인한다:
 *   - 5MB 문자열이 바이트 그대로 돌아오는가
 *   - 실행취소 기록(`ChangeSet.toJSON`)이 직렬화되고, 옮긴 뒤 끝까지 되돌리면 원문인가
 */

import { ChangeSet, EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { EditHistory } from "../src/lib/editor/history";
import { formatOfFile, formatOfName, MARKDOWN_MAX_BYTES } from "../src/lib/editor/mode";

describe("모드 결정 (확장자, §5 · §11)", () => {
  it("`.md`·`.markdown`·확장자 없음은 마크다운, 나머지는 일반 텍스트", () => {
    expect(formatOfName(null)).toBe("markdown");
    expect(formatOfName("메모.md")).toBe("markdown");
    expect(formatOfName("메모.MARKDOWN")).toBe("markdown");
    expect(formatOfName("README")).toBe("markdown");
    expect(formatOfName("메모.txt")).toBe("plain");
    expect(formatOfName("server.log")).toBe("plain");
    expect(formatOfName("a.b.md")).toBe("markdown");
    expect(formatOfName("C:\\notes\\a.txt")).toBe("plain");
  });

  it("임계값(1MB)을 넘는 `.md`는 일반 텍스트로 연다", () => {
    expect(MARKDOWN_MAX_BYTES).toBe(1024 * 1024);
    expect(formatOfFile("메모.md", MARKDOWN_MAX_BYTES)).toBe("markdown");
    expect(formatOfFile("메모.md", MARKDOWN_MAX_BYTES + 1)).toBe("plain");
    expect(formatOfFile("메모.txt", 10)).toBe("plain");
  });
});

describe("큰 일반 텍스트", () => {
  it(
    "5MB 문자열이 바이트 그대로 돌아온다",
    () => {
      const unit = "2026-11-07 09:12:33 [info] 어떤 로그 한 줄과 값 = 12345 그리고 꼬리말\n";
      let big = "";
      while (big.length < 5 * 1024 * 1024) big += unit;

      let t = performance.now();
      const st = EditorState.create({ doc: big });
      const tCreate = performance.now() - t;
      t = performance.now();
      const out = st.doc.toString();
      const tOut = performance.now() - t;
      expect(out).toBe(big);
      expect(st.doc.lines).toBeGreaterThan(90_000);
      console.log(
        `  5MB 일반 텍스트: 상태 생성 ${tCreate.toFixed(0)}ms / 저장용 문자열 ${tOut.toFixed(0)}ms / ` +
          `${st.doc.lines}줄`
      );
    },
    60_000
  );

  it("가운데 위치의 줄·칸을 바로 찾는다 (상태 글자)", () => {
    const unit = "한 줄과 값 = 12345\n";
    let big = "";
    while (big.length < 1024 * 1024) big += unit;
    const st = EditorState.create({ doc: big });
    const line = st.doc.lineAt(Math.floor(big.length / 2));
    expect(line.number).toBeGreaterThan(1);
    expect(line.text).toBe(unit.slice(0, -1));
  });
});

describe("일반 텍스트의 실행 취소 (직렬화 가능)", () => {
  it("한 글자 입력 200번 → 옮긴 뒤 끝까지 되돌리면 원문 바이트", () => {
    const md0 = "첫 줄\n둘째 줄\n셋째 줄\n";
    let st = EditorState.create({ doc: md0 });
    const hist = new EditHistory();
    for (let k = 0; k < 200; k += 1) {
      const tr = st.update({ changes: { from: 3, insert: "가" } });
      hist.record({
        steps: [tr.changes.toJSON()],
        inverted: [tr.changes.invert(st.doc).toJSON()],
        selBefore: st.selection.toJSON(),
        selAfter: tr.state.selection.toJSON(),
        groupTag: null,
      });
      st = tr.state;
    }
    expect(st.doc.toString()).not.toBe(md0);

    // 창 이전: 문서 문자열 + 선택 + 스택을 JSON으로
    const packet = JSON.parse(
      JSON.stringify({ doc: st.doc.toString(), sel: st.selection.toJSON(), hist: hist.toJSON() })
    ) as { doc: string; sel: unknown; hist: ReturnType<EditHistory["toJSON"]> };

    let st2 = EditorState.create({
      doc: packet.doc,
      selection: EditorSelection.fromJSON(packet.sel),
    });
    expect(st2.doc.toString()).toBe(st.doc.toString());

    const hist2 = EditHistory.fromJSON(packet.hist);
    let undos = 0;
    for (;;) {
      const e = hist2.takeUndo();
      if (!e) break;
      for (let i = e.inverted.length - 1; i >= 0; i -= 1) {
        st2 = st2.update({ changes: ChangeSet.fromJSON(e.inverted[i] as never) }).state;
      }
      undos += 1;
    }
    expect(undos).toBe(200);
    expect(st2.doc.toString()).toBe(md0);
    expect(hist2.isDirty()).toBe(false);

    // 다시 실행도 된다
    const e = hist2.takeRedo();
    expect(e).not.toBeNull();
    st2 = st2.update({ changes: ChangeSet.fromJSON(e!.steps[0] as never) }).state;
    expect(st2.doc.toString()).not.toBe(md0);
  });

  it("실행취소 200개의 직렬화 크기가 작다 (문서 스냅샷 방식이 아니다)", () => {
    let st = EditorState.create({ doc: "x".repeat(200_000) });
    const hist = new EditHistory();
    for (let k = 0; k < 200; k += 1) {
      const tr = st.update({ changes: { from: 10, insert: "가" } });
      hist.record({
        steps: [tr.changes.toJSON()],
        inverted: [tr.changes.invert(st.doc).toJSON()],
        selBefore: st.selection.toJSON(),
        selAfter: tr.state.selection.toJSON(),
        groupTag: null,
      });
      st = tr.state;
    }
    const kb = JSON.stringify(hist.toJSON()).length / 1024;
    console.log(`  200KB 문서 / 실행취소 200개 직렬화: ${kb.toFixed(0)}KB`);
    // 스냅샷 방식이면 200개 × 200KB = 40MB가 된다. 스텝 방식은 수십 KB다.
    expect(kb).toBeLessThan(200);
  });
});
