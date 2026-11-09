/**
 * 탭 떼어내기 · 합치기의 판정 (§5 · 단계 7의 완료 조건).
 *
 * 창을 만들거나 고스트를 띄우지 않는다 — 그 흐름은 Tauri 쪽이고, 여기서는 "언제
 * 떼어내기가 시작되는가"와 "커서가 어느 창의 몇 번째 자리인가"만 본다.
 */

import { describe, expect, it } from "vitest";

import {
  boxContains,
  dropTargetAt,
  insertIndexIn,
  newWindowRect,
  tearStarted,
  TEAR_CROSS,
  type DropZone,
} from "../src/lib/tearoff";

/** 알약 줄 하나: x=100부터 폭 80짜리 탭 세 개(간격 0), 줄 높이 26. */
function pills(label: string, count = 3): DropZone {
  return {
    label,
    axis: "x",
    strip: { x: 100, y: 10, w: 400, h: 26 },
    tabs: Array.from({ length: count }, (_, i) => ({
      x: 100 + i * 80,
      y: 10,
      w: 80,
      h: 26,
    })),
  };
}

/** 메모 목록 하나: y=50부터 높이 30짜리 항목 세 개. */
function notes(label: string, count = 3): DropZone {
  return {
    label,
    axis: "y",
    strip: { x: 0, y: 50, w: 168, h: 300 },
    tabs: Array.from({ length: count }, (_, i) => ({
      x: 6,
      y: 50 + i * 30,
      w: 156,
      h: 30,
    })),
  };
}

describe("상자 판정", () => {
  const box = { x: 10, y: 20, w: 100, h: 50 };

  it("왼쪽 위는 안, 오른쪽 아래 경계는 밖 (사각형이 겹치지 않게)", () => {
    expect(boxContains(box, 10, 20)).toBe(true);
    expect(boxContains(box, 109, 69)).toBe(true);
    expect(boxContains(box, 110, 69)).toBe(false);
    expect(boxContains(box, 109, 70)).toBe(false);
    expect(boxContains(box, 9, 20)).toBe(false);
  });
});

describe("떼어내기가 시작되는 순간 (원본 설계 5-A)", () => {
  const strip = { x: 100, y: 10, w: 400, h: 26 };
  const press = { x: 140, y: 23 };

  it("줄 안에서 가로로만 끌면 순서 바꾸기다 (떼어내지 않는다)", () => {
    expect(tearStarted("x", { x: 400, y: 23 }, press, strip)).toBe(false);
    expect(tearStarted("x", { x: 101, y: 12 }, press, strip)).toBe(false);
  });

  it("축을 가로질러 14px을 넘기면 떼어내기다", () => {
    expect(tearStarted("x", { x: 140, y: 23 + TEAR_CROSS }, press, strip)).toBe(false);
    expect(tearStarted("x", { x: 140, y: 23 + TEAR_CROSS + 1 }, press, strip)).toBe(true);
  });

  it("줄 바깥으로 6px 여유를 넘어가면 떼어내기다", () => {
    // 줄 왼쪽 밖으로 **세로 이동 없이** 나가도 떼어내기다(가로는 임계값이 없다).
    expect(tearStarted("x", { x: 100 - 6, y: 23 }, press, strip)).toBe(false);
    expect(tearStarted("x", { x: 100 - 7, y: 23 }, press, strip)).toBe(true);
    // 줄 오른쪽 끝(500)도 같다.
    expect(tearStarted("x", { x: 500 + 5, y: 23 }, press, strip)).toBe(false);
    expect(tearStarted("x", { x: 500 + 7, y: 23 }, press, strip)).toBe(true);
  });

  it("메모 목록은 축이 세로라 가로로 나가면 떼어내기다", () => {
    const panel = { x: 0, y: 50, w: 168, h: 300 };
    const at = { x: 80, y: 120 };
    expect(tearStarted("y", { x: 80, y: 300 }, at, panel)).toBe(false);
    expect(tearStarted("y", { x: 80 + TEAR_CROSS + 1, y: 120 }, at, panel)).toBe(true);
    expect(tearStarted("y", { x: 200, y: 120 }, at, panel)).toBe(true);
  });
});

describe("들어갈 자리", () => {
  it("탭의 가운데를 지나면 그 뒤다", () => {
    const zone = pills("main");
    expect(insertIndexIn(zone, 110, 20)).toBe(0); // 첫 탭 왼쪽 절반
    expect(insertIndexIn(zone, 145, 20)).toBe(1); // 첫 탭 오른쪽 절반
    expect(insertIndexIn(zone, 200, 20)).toBe(1); // 둘째 탭 왼쪽 절반
    expect(insertIndexIn(zone, 260, 20)).toBe(2);
  });

  it("줄 끝(마지막 탭 뒤·빈 자리)은 맨 뒤다", () => {
    const zone = pills("main");
    expect(insertIndexIn(zone, 480, 20)).toBe(3);
  });

  it("탭이 하나도 없는 줄은 0이다 (떼어낸 탭을 받으러 태어난 창)", () => {
    expect(insertIndexIn(pills("win1", 0), 300, 20)).toBe(0);
  });

  it("메모 목록은 세로로 센다", () => {
    const zone = notes("main");
    expect(insertIndexIn(zone, 80, 55)).toBe(0);
    expect(insertIndexIn(zone, 80, 70)).toBe(1);
    expect(insertIndexIn(zone, 80, 300)).toBe(3);
  });
});

describe("놓을 창 고르기", () => {
  it("커서가 그 줄 위면 그 창의 그 자리", () => {
    const zones = [pills("main"), notes("win1")];
    expect(dropTargetAt(145, 20, zones)).toEqual({ label: "main", index: 1 });
    expect(dropTargetAt(80, 70, zones)).toEqual({ label: "win1", index: 1 });
  });

  it("어느 줄도 아니면 null — 부르는 쪽이 새 창을 만든다", () => {
    expect(dropTargetAt(900, 900, [pills("main")])).toBeNull();
    // 창 안이지만 탭 줄이 아닌 자리(편집 영역)도 null이다.
    expect(dropTargetAt(300, 200, [pills("main")])).toBeNull();
  });

  it("줄이 겹치면 **앞에 온 창**이 이긴다 (마지막 활성 창이 앞으로 온다)", () => {
    const a = pills("main");
    const b = { ...pills("win1"), label: "win1" };
    // 두 줄이 같은 자리를 덮고 있다.
    expect(dropTargetAt(145, 20, [b, a])?.label).toBe("win1");
    expect(dropTargetAt(145, 20, [a, b])?.label).toBe("main");
  });

  it("올려 둔 줄이 없으면 null (창이 뜨는 중)", () => {
    expect(dropTargetAt(145, 20, [])).toBeNull();
  });
});

describe("떼어낸 새 창의 자리", () => {
  it("커서 아래에 그 탭이 그대로 오고 크기는 원래 창을 물려받는다", () => {
    const rect = newWindowRect(
      { x: 1000, y: 500 },
      { x: 20, y: 13 }, // 알약 안에서 잡은 자리
      { x: 110, y: 10 }, // 알약의 창 안 자리
      { w: 840, h: 520 }
    );
    expect(rect).toEqual({ x: 1000 - 20 - 110, y: 500 - 13 - 10, w: 840, h: 520 });
  });
});
