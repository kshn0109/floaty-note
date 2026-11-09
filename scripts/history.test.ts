/**
 * 실행 취소 스택 — spike `docs/editor-spike/undo.mjs`를 vitest로 옮긴 것 (설계 문서 §6).
 *
 * `MarkdownHost`는 화면에 붙이지 않아도 돈다(뷰는 `mount`에서 생기고 그전에는 `null`).
 * 그래서 DOM 없이 "명령 → 저장 문자열 → Ctrl+Z" 경로를 전부 셀 수 있다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { EditHistory } from "../src/lib/editor/history";

const MD = "# 제목\n\n본문 한 줄.\n\n- 목록 하나\n- 목록 둘\n\n끝 문단.\n";

function entry(id: number, tag: string | null, now: number) {
  return {
    steps: [`s${id}`],
    inverted: [`i${id}`],
    selBefore: id,
    selAfter: id,
    groupTag: tag,
    now,
  };
}

describe("EditHistory", () => {
  it("묶기 태그가 없으면 한 명령 = 한 항목", () => {
    const h = new EditHistory();
    h.record(entry(1, null, 1000));
    h.record(entry(2, null, 1010));
    expect(h.takeUndo()?.steps).toEqual(["s2"]);
    expect(h.takeUndo()?.steps).toEqual(["s1"]);
    expect(h.canUndo()).toBe(false);
  });

  it("같은 태그의 연속 입력은 500ms 안이면 합쳐진다", () => {
    const h = new EditHistory();
    h.record(entry(1, "typing", 1000));
    h.record(entry(2, "typing", 1200));
    const e = h.takeUndo();
    expect(e?.steps).toEqual(["s1", "s2"]);
    expect(h.canUndo()).toBe(false);
  });

  it("500ms를 넘으면 끊긴다", () => {
    const h = new EditHistory();
    h.record(entry(1, "typing", 1000));
    h.record(entry(2, "typing", 1600));
    expect(h.takeUndo()?.steps).toEqual(["s2"]);
    expect(h.takeUndo()?.steps).toEqual(["s1"]);
  });

  it("breakGroup()은 다음 기록을 끊는다 (한글 조합이 끝났을 때)", () => {
    const h = new EditHistory();
    h.record(entry(1, "typing", 1000));
    h.breakGroup();
    h.record(entry(2, "typing", 1050));
    expect(h.takeUndo()?.steps).toEqual(["s2"]);
  });

  it("저장 지점을 넘어서는 합치지 않는다", () => {
    const h = new EditHistory();
    h.record(entry(1, "typing", 1000));
    h.markSaved();
    h.record(entry(2, "typing", 1050));
    expect(h.isDirty()).toBe(true);
    expect(h.takeUndo()?.steps).toEqual(["s2"]);
    expect(h.isDirty()).toBe(false);
  });

  it("끝까지 되돌리면 깨끗해지고, 같은 깊이의 다른 편집은 수정됨이다", () => {
    const h = new EditHistory();
    expect(h.isDirty()).toBe(false);
    h.record(entry(1, null, 1000));
    expect(h.isDirty()).toBe(true);
    h.takeUndo();
    expect(h.isDirty()).toBe(false);
    // 같은 깊이(0 → 1)지만 다른 편집이므로 깨끗하지 않다. 깊이만 비교하면 놓친다.
    h.record(entry(2, null, 2000));
    expect(h.isDirty()).toBe(true);
  });

  it("다시 실행은 같은 항목을 되살린다", () => {
    const h = new EditHistory();
    h.record(entry(1, null, 1000));
    h.takeUndo();
    expect(h.canRedo()).toBe(true);
    expect(h.takeRedo()?.steps).toEqual(["s1"]);
    expect(h.isDirty()).toBe(true);
  });

  it("JSON으로 내보내고 되살리면 그대로 동작한다", () => {
    const h = new EditHistory();
    h.record(entry(1, null, 1000));
    h.record(entry(2, null, 2000));
    h.markSaved();
    const h2 = EditHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(h2.isDirty()).toBe(false);
    expect(h2.takeUndo()?.steps).toEqual(["s2"]);
    expect(h2.isDirty()).toBe(true);
  });
});

describe("MarkdownHost 실행 취소", () => {
  it("명령 하나 = 실행 취소 한 번, 끝까지 되돌리면 원문 바이트", () => {
    const host = new MarkdownHost(MD);
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);

    host.select(1, 3); // "제목" (제목 블록 안쪽은 1~3)
    expect(host.exec({ t: "bold" })).toBe(true);
    expect(host.save()).toContain("# **제목**");
    expect(host.isDirty()).toBe(true);
    expect(host.query().canUndo).toBe(true);

    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);
    expect(host.redo()).toBe(true);
    expect(host.save()).toContain("# **제목**");
    expect(host.undo()).toBe(true);
    expect(host.save()).toBe(MD);
  });

  it("여러 명령을 쌓아도 각각 한 번씩 되돌아간다", () => {
    const host = new MarkdownHost(MD);
    host.select(1, 3); // 제목의 "제목"
    host.exec({ t: "bold" });
    host.select(5, 7); // 둘째 단락의 "본문"
    host.exec({ t: "highlight", color: "#FFEB3B" });
    host.select(6);
    host.exec({ t: "heading", level: 2 });
    let depth = 0;
    while (host.undo()) depth += 1;
    expect(depth).toBe(3);
    expect(host.save()).toBe(MD);
    expect(host.isDirty()).toBe(false);
  });

  it("테마·탭 전환·펜 모드·선택은 깨끗한 문서를 더럽히지 않는다", () => {
    const host = new MarkdownHost(MD);
    // 이 호출들이 곧 테마 변경·탭 전환·찾기가 하는 일 전부다(트랜잭션이 아니다).
    host.query();
    host.stats();
    host.setPen("#9BF06A");
    host.setPen(null);
    host.select(3, 5);
    host.select(0);
    host.serialize();
    expect(host.isDirty()).toBe(false);
    expect(host.save()).toBe(MD);
  });

  it("저장하면 그 바이트가 새 기준이 되고 수정 표시가 지워진다", () => {
    const host = new MarkdownHost(MD);
    host.select(1, 3);
    host.exec({ t: "bold" });
    const saved = host.save();
    host.markSaved();
    expect(host.isDirty()).toBe(false);
    // 손대지 않으면 저장 바이트가 그대로 돌아온다(원문 보존의 기준이 바뀐 것).
    expect(host.save()).toBe(saved);
    expect(host.undo()).toBe(true);
    expect(host.isDirty()).toBe(true);
  });
});

describe("탭 상태 직렬화 (§10)", () => {
  it("직렬화 → 복원 후 문서·저장 바이트·실행취소가 같다", () => {
    const host = new MarkdownHost(MD);
    host.select(1, 3);
    host.exec({ t: "bold" });
    host.select(6);
    host.exec({ t: "heading", level: 3 });
    const before = host.save();

    const packet = JSON.parse(JSON.stringify(host.serialize())) as ReturnType<
      MarkdownHost["serialize"]
    >;
    const moved = new MarkdownHost();
    moved.restore(packet);

    expect(moved.save()).toBe(before);
    expect(moved.isDirty()).toBe(true);
    // 옮긴 쪽에서 끝까지 Ctrl+Z → 원문 바이트로 복귀
    let depth = 0;
    while (moved.undo()) depth += 1;
    expect(depth).toBe(2);
    expect(moved.save()).toBe(MD);
    expect(moved.isDirty()).toBe(false);
  });

  it("꾸러미는 문서 JSON이 아니라 텍스트다", () => {
    const host = new MarkdownHost(MD);
    const packet = host.serialize();
    expect(packet.text).toBe(MD);
    expect(packet.fileSrc).toBe(MD);
    expect(packet.format).toBe("markdown");
  });
});
