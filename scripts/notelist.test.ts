/**
 * 메모 목록 — **모든 창 공통**(사용자 결정)의 합치기·정렬 규칙과 최근 파일 줄의 규칙.
 *
 * 그려지는 모양은 사용자가 확인한다(UI 자동 테스트 금지). 여기서 보는 것은 셋이다:
 *   1. 이 창이 올리는 요약에서 **숨긴 탭이 빠지는가**(§5: 어느 탭 줄에도 안 보인다).
 *   2. `다른 창` 묶음이 **내 창을 빼고 창 순서를 지키는가**.
 *   3. `최근 파일` 묶음이 **지금 열려 있는 파일을 빼는가**(같은 파일이 두 줄이 되지 않게).
 *
 * 최근 파일의 "맨 앞으로 + 중복 제거 + 상한 10"은 **쓰는 곳인 Rust**가 들고 있고
 * (`src-tauri/src/recent.rs`의 `promote`), 그쪽 단위 시험이 본다 — 규칙을 두 군데
 * 두면 둘이 어긋난다. 디스크는 어느 쪽 시험도 건드리지 않는다.
 */

import { describe, expect, it } from "vitest";

import {
  otherNotes,
  recentLabel,
  recentRows,
  summaryOf,
  type WindowNotes,
} from "../src/lib/noteList";
import { createTab, type Tab } from "../src/lib/tabs";

function tab(name: string | null, patch: Partial<Tab> = {}): Tab {
  return { ...createTab("none", name), ...patch };
}

function win(label: string, tabs: WindowNotes["tabs"]): WindowNotes {
  return { label, activeUid: tabs[0]?.uid ?? null, tabs };
}

function note(uid: string, name: string | null, path: string | null = null) {
  return { uid, name, path, tint: "none" as const, dirty: false };
}

describe("이 창이 올리는 요약", () => {
  it("보이는 탭만 올린다 — 숨긴 탭(알림 예외)은 다른 창의 목록에도 안 보인다", () => {
    const list = [tab("a.md"), tab("b.md", { hidden: true }), tab("c.md")];
    const summary = summaryOf("win1", list, list[0].uid);
    expect(summary.label).toBe("win1");
    expect(summary.activeUid).toBe(list[0].uid);
    expect(summary.tabs.map((t) => t.name)).toEqual(["a.md", "c.md"]);
  });

  it("글 내용은 올리지 않는다 — 줄 하나를 그릴 값만", () => {
    const list = [tab("a.md", { path: "C:\\a.md", dirty: true, tint: "mint" })];
    expect(summaryOf("main", list, null).tabs[0]).toEqual({
      uid: list[0].uid,
      name: "a.md",
      path: "C:\\a.md",
      tint: "mint",
      dirty: true,
    });
  });
});

describe("`다른 창` 묶음", () => {
  const all = [
    win("main", [note("m1", "내 메모")]),
    win("win1", [note("a1", "하나"), note("a2", "둘")]),
    win("win2", [note("b1", "셋")]),
  ];

  it("내 창은 빠지고 창 순서 그대로 늘어난다", () => {
    expect(otherNotes(all, "main").map((n) => [n.label, n.name])).toEqual([
      ["win1", "하나"],
      ["win1", "둘"],
      ["win2", "셋"],
    ]);
  });

  it("창이 하나면 비어 있다 — 그때는 섹션 라벨도 그려지지 않는다", () => {
    expect(otherNotes([win("main", [note("m1", "내 메모")])], "main")).toEqual([]);
  });

  it("아직 아무 요약도 받지 못했으면 비어 있다", () => {
    expect(otherNotes([], "main")).toEqual([]);
  });
});

describe("`최근 파일` 묶음", () => {
  it("지금 **어느 창에든** 열려 있는 파일은 빠진다", () => {
    const all = [
      win("main", [note("m1", "a.md", "C:\\Notes\\a.md")]),
      win("win1", [note("b1", "b.md", "C:\\Notes\\b.md")]),
    ];
    const recent = ["C:\\Notes\\a.md", "C:\\Notes\\b.md", "C:\\Notes\\c.md"];
    expect(recentRows(recent, all)).toEqual(["C:\\Notes\\c.md"]);
  });

  it("대소문자와 구분자가 달라도 같은 파일로 본다(Windows 규칙)", () => {
    const all = [win("main", [note("m1", "a.md", "c:/notes/A.MD")])];
    expect(recentRows(["C:\\Notes\\a.md", "C:\\Notes\\z.md"], all)).toEqual(["C:\\Notes\\z.md"]);
  });

  it("목록 안의 중복도 한 줄만 남고 순서는 그대로다", () => {
    const rows = recentRows(["C:\\a.md", "c:/A.md", "C:\\b.md"], []);
    expect(rows).toEqual(["C:\\a.md", "C:\\b.md"]);
  });

  it("빈 경로는 버리고 상한을 지킨다", () => {
    expect(recentRows(["", "C:\\a.md"], [])).toEqual(["C:\\a.md"]);
    expect(recentRows(["1", "2", "3", "4"], [], 2)).toEqual(["1", "2"]);
  });

  it("줄에 보이는 것은 파일 이름뿐이다(전체 경로는 툴팁)", () => {
    expect(recentLabel("C:\\Notes\\주간 메모.md")).toBe("주간 메모.md");
    expect(recentLabel("c:/notes/a.md")).toBe("a.md");
  });
});
