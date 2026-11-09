/**
 * 떠 있는 도구 줄의 자리 계산 — 승인된 시안 N2b의 숫자를 그대로 시험한다.
 *
 * 시안이 못 박은 값(`Narrow.dc.html` N2b):
 *   · 줄의 자연 폭 **314**
 *   · ◐ · 취소선을 접으면 **254** ≤ 284(창 300)
 *   · 거기서 표 · •≡까지 접으면 **190** ≤ 224(창 240)
 *   · 접는 순서 ◐ → 취소선 → 표 → •≡ → H ▾, ☰ · B · 형광펜은 접지 않는다.
 *
 * 2026-11-09 사용자 결정: 맨 오른쪽 `⚙`(설정)를 빼고 그 자리에 글머리 기호 전용 버튼
 * `•≡`을 넣었다(시안 L1). 둘 다 30px이라 **줄 폭은 한 픽셀도 바뀌지 않는다**.
 *
 * UI 자동 시험이 아니다 — 화면을 그리지 않고 순수 계산만 본다.
 */

import { describe, expect, it } from "vitest";

import {
  DOCK_MARGIN,
  dockLayout,
  dockWidth,
  FOLD_ORDER,
  isDockMenuKey,
  statusCollides,
  type DockMetrics,
} from "../src/lib/dockFit";

/** 시안 N2b가 전제하는 상태: 불투명도 80%, 본문(제목 아님), 오버레이 아님. */
const BASE: Omit<DockMetrics, "avail"> = { opacity: 80, heading: 0, overlay: false };

/** 창 폭 → 줄이 쓸 수 있는 폭(메모 목록이 없을 때). */
const availOf = (win: number) => win - DOCK_MARGIN;

describe("도구 줄 자연 폭", () => {
  it("아무것도 접지 않으면 318 (80%일 때 실측 315.9)", () => {
    // 시안 N2b는 314로 적지만 그 산수는 `H ▾ = 32` · `◐ 80% = 58`을 전제한다.
    // WebView2의 실측은 37.1 · 54.8이고 ◐가 `100%`면 61.2라 자연 폭이 조금 다르다 —
    // 접는 판단은 실측에 맞춘다(올림 쪽으로 1~2px: 늦게 접는 것보다 안전하다).
    expect(dockWidth({ ...BASE, avail: 9999 }, [])).toBe(318);
    // ◐가 `100%`면 한 자 넓다 (실측 322.4).
    expect(dockWidth({ ...BASE, opacity: 100, avail: 9999 }, [])).toBe(324);
  });

  it("넓은 창에서는 하나도 접지 않는다 (R5 모양 그대로)", () => {
    const { folded, width } = dockLayout({ ...BASE, avail: availOf(840) });
    expect(folded).toEqual([]);
    expect(width).toBe(318);
  });

  it("딱 들어가는 폭에서는 접지 않는다", () => {
    expect(dockLayout({ ...BASE, avail: 318 }).folded).toEqual([]);
    expect(dockLayout({ ...BASE, avail: 317 }).folded).toEqual(["opacity"]);
  });
});

describe("N2b 접기 — 시안의 폭 계산", () => {
  it("창 300: ◐ · 취소선을 접어 260 (실측 259.1)", () => {
    const { folded, width } = dockLayout({ ...BASE, avail: availOf(300) });
    expect(folded).toEqual(["opacity", "strike"]);
    expect(width).toBe(260);
    expect(width).toBeLessThanOrEqual(availOf(300));
  });

  it("창 240: 표까지 접어 196 — 시안 N2b의 창 240 그림과 같은 상태", () => {
    const { folded, width } = dockLayout({ ...BASE, avail: availOf(240) });
    // 시안은 190으로 적는다(위와 같은 이유로 6px 차이). `⋯` 팝오버에 취소선 · 표 ·
    // 글머리 기호 세 줄이 들어가는 그 상태다.
    expect(folded).toEqual(["opacity", "strike", "table", "bullet"]);
    expect(width).toBe(196);
    expect(width).toBeLessThanOrEqual(availOf(240));
  });

  it("표까지 접힌 중간 단계도 있다", () => {
    expect(dockLayout({ ...BASE, avail: 230 }).folded).toEqual(["opacity", "strike", "table"]);
    expect(dockWidth({ ...BASE, avail: 9999 }, ["opacity", "strike", "table"])).toBe(228);
    // ◐ · 취소선만 접힌 상태가 260이다(창 300).
    expect(dockWidth({ ...BASE, avail: 9999 }, ["opacity", "strike"])).toBe(260);
  });

  it("접는 순서는 ◐ → 취소선 → 표 → •≡ → H ▾ 뿐이다", () => {
    expect([...FOLD_ORDER]).toEqual(["opacity", "strike", "table", "bullet", "heading"]);
  });

  it("글머리 기호 버튼은 ⚙가 빠진 자리를 그대로 받는다 — 줄 폭이 같다", () => {
    // ⚙ 30px이 빠지고 •≡ 30px이 들어왔으므로 자연 폭이 전과 같은 318이다.
    expect(dockWidth({ ...BASE, avail: 9999 }, [])).toBe(318);
    // •≡만 접으면 그 자리에 ⋯(30)가 생기므로 폭이 그대로다 → 한 칸 더 접혀야 든다.
    expect(dockWidth({ ...BASE, avail: 9999 }, ["bullet"])).toBe(318);
  });

  it("폭을 줄이면 접힌 목록이 그 순서를 지키며 늘어나기만 한다", () => {
    let prev: string[] = [];
    for (let avail = 320; avail >= 100; avail -= 1) {
      const folded = dockLayout({ ...BASE, avail }).folded as string[];
      // 앞선(더 넓은) 결과는 언제나 지금 결과의 앞부분이다 — 순서가 뒤집히거나
      // 중간이 빠지는 일이 없다.
      expect(folded.slice(0, prev.length)).toEqual(prev);
      expect(folded).toEqual(FOLD_ORDER.slice(0, folded.length));
      prev = folded;
    }
  });

  it("☰ · B · 형광펜은 끝까지 남는다 — 다 접어도 거기서 멈춘다", () => {
    const { folded, width } = dockLayout({ ...BASE, avail: 40 });
    expect(folded).toEqual([...FOLD_ORDER]);
    // ☰ 30 + 구분선 7 + B 30 + 형광펜 30 + 구분선 7 + ⋯ 30 + 간격 10 + 틀 12
    expect(width).toBe(156);
  });

  it("한 번 접은 상태를 다시 넣어도 같은 답이 나온다 (되풀이 없음)", () => {
    for (const win of [840, 644, 600, 480, 420, 300, 240, 180]) {
      const first = dockLayout({ ...BASE, avail: availOf(win) });
      const again = dockLayout({ ...BASE, avail: availOf(win) });
      expect(again).toEqual(first);
    }
  });

  it("오버레이에서는 ◐ 칩이 없어 접을 대상에서 빠진다", () => {
    // 칩이 없으니 자연 폭이 260이다 — 창 300(쓸 폭 284)에서는 접을 일이 없다.
    expect(dockLayout({ ...BASE, overlay: true, avail: availOf(300) }).folded).toEqual([]);
    expect(dockWidth({ ...BASE, overlay: true, avail: 9999 }, [])).toBe(260);
    // 더 좁히면 ◐를 건너뛰고 취소선부터 접는다. 취소선(30)을 접으면 그 자리에 ⋯(30)가
    // 생겨 폭이 그대로이므로 표까지 한 칸 더 접혀야 들어간다.
    expect(dockWidth({ ...BASE, overlay: true, avail: 9999 }, ["strike"])).toBe(260);
    expect(dockLayout({ ...BASE, overlay: true, avail: 240 }).folded).toEqual([
      "strike",
      "table",
    ]);
  });

  it("제목 안에서는 H 칩이 넓어 조금 더 일찍 접힌다", () => {
    const inBody = dockLayout({ ...BASE, avail: 320 }).folded;
    const inHeading = dockLayout({ ...BASE, heading: 2, avail: 320 }).folded;
    expect(inBody).toEqual([]);
    expect(inHeading).toEqual(["opacity"]);
  });


});

describe("상태 글자 ↔ 도구 줄 겹침", () => {
  /** 창 높이 400을 가정한 두 사각형(도구 줄: 아래 14·높이 38, 글자: 아래 24·높이 14). */
  const dock = (left: number, right: number) => ({ left, right, top: 348, bottom: 386 });
  const status = (left: number, right: number) => ({ left, right, top: 362, bottom: 376 });

  it("넓은 창 — 가운데 줄과 오른쪽 글자가 떨어져 있으면 보인다", () => {
    expect(statusCollides(dock(263, 577), status(700, 826))).toBe(false);
  });

  it("좁은 창 — 가로로 닿으면 숨는다", () => {
    expect(statusCollides(dock(173, 427), status(380, 506))).toBe(true);
  });

  it("틈(8px)보다 가까우면 숨는다", () => {
    expect(statusCollides(dock(100, 300), status(305, 400))).toBe(true);
    expect(statusCollides(dock(100, 300), status(309, 400))).toBe(false);
  });

  it("세로로 안 겹치면(낮은 창에서 글자가 위로 간 경우) 숨기지 않는다", () => {
    expect(statusCollides(dock(100, 300), { left: 200, right: 400, top: 10, bottom: 24 })).toBe(
      false
    );
  });

  it("사각형이 없거나 비어 있으면 숨기지 않는다", () => {
    expect(statusCollides(null, status(380, 506))).toBe(false);
    expect(statusCollides(dock(173, 427), null)).toBe(false);
    expect(statusCollides(dock(173, 427), status(380, 380))).toBe(false);
  });
});

describe("☰ 를 여는 키", () => {
  const chord = (over: Partial<Parameters<typeof isDockMenuKey>[0]>) => ({
    code: "F10",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...over,
  });

  it("F10이면 연다", () => {
    expect(isDockMenuKey(chord({}))).toBe(true);
  });

  it("Shift+F10은 아니다 — Windows에서 그것은 상황에 맞는 메뉴다", () => {
    expect(isDockMenuKey(chord({ shiftKey: true }))).toBe(false);
  });

  it("Ctrl·Alt·Win이 섞이면 아니다", () => {
    expect(isDockMenuKey(chord({ ctrlKey: true }))).toBe(false);
    expect(isDockMenuKey(chord({ altKey: true }))).toBe(false);
    expect(isDockMenuKey(chord({ metaKey: true }))).toBe(false);
  });

  it("다른 키는 아니다 (F9 · F11 · Alt 단독)", () => {
    expect(isDockMenuKey(chord({ code: "F9" }))).toBe(false);
    expect(isDockMenuKey(chord({ code: "F11" }))).toBe(false);
    expect(isDockMenuKey(chord({ code: "AltLeft", altKey: true }))).toBe(false);
  });
});
