/**
 * 세션 직렬화 (§5 · 단계 6의 완료 조건).
 *
 * **파일을 만들지 않는다**: 쓰기는 Rust 쪽이고 여기서는 "무엇을 쓰기로 했는가"(기록과
 * 버퍼 목록)와 "읽은 것을 어떻게 믿는가"(깨진 세션·모르는 형식·사라진 모니터)만 본다.
 * 시험이 실제 `%APPDATA%\Inkwell-Tauri\session\`에 손대면 안 된다(지시).
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import {
  bufName,
  clampRect,
  histName,
  parseHistory,
  parseSession,
  referencedBuffers,
  SESSION_VERSION,
  splitSession,
  windowRecord,
  type SessionFile,
  type SessionWindow,
  type TabSnapshot,
  type WindowSnapshot,
} from "../src/lib/session";

const EMPTY_HISTORY = { done: [], undone: [], savedId: null, seq: 0 };

function snapTab(over: Partial<TabSnapshot> = {}): TabSnapshot {
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
    doc: null,
    ...over,
  };
}

function snapWin(tabs: TabSnapshot[]): WindowSnapshot {
  return {
    id: "w1",
    rect: { x: 10, y: 20, w: 800, h: 500 },
    maximized: false,
    overlay: false,
    pinned: false,
    opacity: 100,
    zoom: 100,
    activeUid: tabs[0]?.uid ?? null,
    tabs,
  };
}

describe("쓰기 — 어떤 탭이 버퍼를 갖는가", () => {
  it("미저장 탭만 글을 쓴다 (깨끗한 탭은 다음 실행에 파일을 다시 읽는다)", () => {
    const host = new MarkdownHost("hello\n");
    const dirty = snapTab({ uid: "d1", dirty: true, doc: host.serialize() });
    const clean = snapTab({ uid: "c1", path: "C:\\a.md", name: "a.md" });
    const { record, buffers } = windowRecord(snapWin([dirty, clean]));

    expect(buffers.map((b) => b.name)).toEqual([bufName("d1")]);
    expect(buffers[0].text).toBe("hello\n");
    expect(record.tabs[0].buf).toBe(bufName("d1"));
    expect(record.tabs[1].buf).toBeNull();
    // 깨끗한 탭의 경로는 그대로 남는다 — 그게 다음 실행에 읽을 진실이다.
    expect(record.tabs[1].path).toBe("C:\\a.md");
  });

  it("미저장 탭의 실행 취소 스택도 함께 쓴다", () => {
    const host = new MarkdownHost("hello world\n");
    host.select(1, 6);
    host.exec({ t: "bold" });
    const doc = host.serialize();
    expect(doc.history.done.length).toBeGreaterThan(0);

    const { record, buffers } = windowRecord(
      snapWin([snapTab({ uid: "d1", dirty: true, doc })])
    );
    expect(buffers.map((b) => b.name)).toEqual([bufName("d1"), histName("d1")]);
    expect(record.tabs[0].hist).toBe(histName("d1"));
    // 쓴 글은 **그 탭을 저장했다면 나왔을 바이트**다(원본 규칙).
    expect(buffers[0].text).toBe("**hello** world\n");
    const back = parseHistory(buffers[1].text);
    expect(back?.done.length).toBe(doc.history.done.length);
  });

  it("스택이 비어 있으면 스택 파일을 만들지 않는다", () => {
    const host = new MarkdownHost("x\n");
    const { record, buffers } = windowRecord(
      snapWin([snapTab({ uid: "d1", dirty: true, doc: host.serialize() })])
    );
    expect(buffers.map((b) => b.name)).toEqual([bufName("d1")]);
    expect(record.tabs[0].hist).toBeNull();
  });

  it("커서와 스크롤이 기록에 들어간다 (§5)", () => {
    const host = new MarkdownHost("hello\n");
    host.select(3);
    host.noteScroll(120);
    const { record } = windowRecord(snapWin([snapTab({ doc: host.serialize() })]));
    expect(record.tabs[0].scrollTop).toBe(120);
    expect(record.tabs[0].selection).not.toBeNull();
  });

  it("인덱스가 대는 버퍼 목록이 정리 규칙의 기준이다", () => {
    const host = new MarkdownHost("a\n");
    host.select(1, 2);
    host.exec({ t: "bold" });
    const { record } = windowRecord(
      snapWin([
        snapTab({ uid: "d1", dirty: true, doc: host.serialize() }),
        snapTab({ uid: "c1", path: "C:\\a.md" }),
      ])
    );
    expect(referencedBuffers({ v: SESSION_VERSION, activeWindow: 0, windows: [record] })).toEqual([
      bufName("d1"),
      histName("d1"),
    ]);
  });
});

describe("읽기 — 깨진 세션은 첫 실행처럼", () => {
  const good = JSON.stringify({
    v: SESSION_VERSION,
    activeWindow: 0,
    windows: [
      {
        id: "w1",
        rect: { x: 1, y: 2, w: 300, h: 200 },
        maximized: true,
        overlay: false,
        pinned: false,
        opacity: 80,
        activeTab: "t2",
        tabs: [
          { id: "t1", name: "a.md", path: "C:\\a.md" },
          { id: "t2", dirty: true, buf: "buf_t2.txt", tint: "yellow", scrollTop: 40 },
        ],
      },
    ],
  });

  it("제대로 된 파일을 읽는다", () => {
    const file = parseSession(good);
    expect(file).not.toBeNull();
    expect(file?.windows).toHaveLength(1);
    expect(file?.windows[0].maximized).toBe(true);
    expect(file?.windows[0].opacity).toBe(80);
    expect(file?.windows[0].activeTab).toBe("t2");
    expect(file?.windows[0].tabs[1].tint).toBe("yellow");
    expect(file?.windows[0].tabs[1].scrollTop).toBe(40);
    // 없는 칸은 기본값이다 — 새 칸이 생겨도 옛 세션이 읽힌다.
    expect(file?.windows[0].tabs[0].dirty).toBe(false);
    expect(file?.windows[0].tabs[0].format).toBe("markdown");
    expect(file?.windows[0].tabs[0].hidden).toBe(false);
  });

  it("테이프(항상 위)는 창마다 저장·복원되고, 없는 칸은 꺼짐이다", () => {
    const pinnedFile = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 0,
      windows: [
        { id: "w1", pinned: true, tabs: [{ id: "t1" }] },
        // `pinned` 칸이 없는 옛 세션 — 기본값(꺼짐)으로 읽힌다.
        { id: "w2", tabs: [{ id: "t2" }] },
      ],
    });
    const file = parseSession(pinnedFile);
    expect(file?.windows[0].pinned).toBe(true);
    expect(file?.windows[1].pinned).toBe(false);
  });

  it("JSON이 아니거나 모르는 형식 번호면 null", () => {
    expect(parseSession("{")).toBeNull();
    expect(parseSession("null")).toBeNull();
    expect(parseSession(JSON.stringify({ v: 99, windows: [] }))).toBeNull();
  });

  it("탭이 없는 창은 버리고, 남는 창이 없으면 null (원본과 같다)", () => {
    const text = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 0,
      windows: [{ id: "w1", tabs: [] }],
    });
    expect(parseSession(text)).toBeNull();
  });

  it("id 없는 탭은 버린다 (버퍼 이름을 만들 수 없다)", () => {
    const text = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 0,
      windows: [{ id: "w1", tabs: [{ name: "a" }, { id: "t1" }] }],
    });
    expect(parseSession(text)?.windows[0].tabs.map((t) => t.id)).toEqual(["t1"]);
  });

  it("범위를 벗어난 활성 창 번호는 0으로", () => {
    const text = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 7,
      windows: [{ id: "w1", tabs: [{ id: "t1" }] }],
    });
    expect(parseSession(text)?.activeWindow).toBe(0);
  });

  it("왕복: 쓴 것을 그대로 읽는다", () => {
    const host = new MarkdownHost("hello\n");
    const { record } = windowRecord(snapWin([snapTab({ uid: "t1", doc: host.serialize() })]));
    const text = JSON.stringify({ v: SESSION_VERSION, activeWindow: 0, windows: [record] });
    const back = parseSession(text);
    expect(back?.windows[0].tabs[0].id).toBe("t1");
    expect(back?.windows[0].rect).toEqual({ x: 10, y: 20, w: 800, h: 500 });
  });
});

describe("실행 취소 스택 읽기", () => {
  it("깨진 스택은 null — 그 탭은 글만 돌아온다", () => {
    expect(parseHistory("{")).toBeNull();
    expect(parseHistory(JSON.stringify({ done: 3 }))).toBeNull();
    expect(parseHistory(JSON.stringify(EMPTY_HISTORY))?.done).toEqual([]);
  });
});

describe("창 위치 — 사라진 모니터 보정 (지시 6)", () => {
  const main = { x: 0, y: 0, w: 1920, h: 1080 };

  it("모니터를 모르면 그대로 둔다", () => {
    const rect = { x: 50, y: 60, w: 800, h: 500 };
    expect(clampRect(rect, [])).toEqual(rect);
  });

  it("화면 안이면 그대로", () => {
    const rect = { x: 50, y: 60, w: 800, h: 500 };
    expect(clampRect(rect, [main])).toEqual(rect);
  });

  it("사라진 둘째 모니터의 창을 남은 모니터 안으로 당긴다", () => {
    // 오른쪽 모니터(2560, 0)에 있던 창. 그 모니터가 없어졌다.
    const rect = { x: 2600, y: 100, w: 800, h: 500 };
    const fixed = clampRect(rect, [main]);
    expect(fixed.x).toBe(0);
    expect(fixed.w).toBe(800);
    expect(fixed.h).toBe(500);
  });

  it("위로 완전히 빠진 창도 끌어내린다", () => {
    const fixed = clampRect({ x: 100, y: -900, w: 800, h: 500 }, [main]);
    expect(fixed.y).toBe(0);
  });

  it("크기는 절대 바꾸지 않는다", () => {
    const fixed = clampRect({ x: -4000, y: -4000, w: 640, h: 400 }, [main]);
    expect(fixed.w).toBe(640);
    expect(fixed.h).toBe(400);
  });
});

describe("복원 — 읽은 세션을 내 것과 새 창으로 가른다 (§5의 다중 창)", () => {
  const rec = (id: string, tabs = 1): SessionWindow => ({
    id,
    rect: null,
    maximized: false,
    overlay: false,
    pinned: false,
    opacity: 100,
    zoom: 100,
    activeTab: "t1",
    tabs: Array.from({ length: tabs }, (_, i) => ({
      id: `t${i + 1}`,
      name: null,
      path: null,
      tint: "none" as const,
      dirty: false,
      format: "markdown" as const,
      enc: "utf8" as const,
      eol: "lf" as const,
      bigMd: false,
      hidden: false,
      reminder: null,
      buf: null,
      hist: null,
      selection: null,
      scrollTop: 0,
    })),
  });

  const file = (windows: SessionWindow[], activeWindow = 0): SessionFile => ({
    v: SESSION_VERSION,
    activeWindow,
    windows,
  });

  it("첫 기록은 그 창이 직접 되살리고 나머지가 새 창이 된다", () => {
    const split = splitSession(file([rec("w1"), rec("w2"), rec("w3")]));
    expect(split.mine?.id).toBe("w1");
    expect(split.others.map((w) => w.id)).toEqual(["w2", "w3"]);
  });

  it("활성 창을 **맨 나중에** 만든다 (마지막에 만든 창이 앞에 선다)", () => {
    const split = splitSession(file([rec("w1"), rec("w2"), rec("w3")], 1));
    expect(split.focusMine).toBe(false);
    // w2가 활성이므로 w3 → w2 순서로 만든다.
    expect(split.others.map((w) => w.id)).toEqual(["w3", "w2"]);
  });

  it("활성 창이 내 것이면 끝에 내가 포커스를 되찾는다", () => {
    const split = splitSession(file([rec("w1"), rec("w2")], 0));
    expect(split.focusMine).toBe(true);
    expect(split.others.map((w) => w.id)).toEqual(["w2"]);
  });

  it("탭이 없는 창은 아예 세지 않는다 (원본과 같다)", () => {
    const split = splitSession(file([rec("w1", 0), rec("w2"), rec("w3", 0)]));
    expect(split.mine?.id).toBe("w2");
    expect(split.others).toHaveLength(0);
  });

  it("창이 하나면 만들 창이 없다", () => {
    const split = splitSession(file([rec("w1")]));
    expect(split.mine?.id).toBe("w1");
    expect(split.others).toHaveLength(0);
    expect(split.focusMine).toBe(true);
  });
});
