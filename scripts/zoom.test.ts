/**
 * 확대/축소 — 걸음·범위·키 맞추기와 세션 왕복 (사용자 보고: "Ctrl+휠 글자 크기 조절").
 *
 * 화면을 보지 않는다(사용자 규칙): 여기서 보는 것은 **순수한 계산**뿐이다 —
 * 몇 %가 되는가, 어느 조합이 확대/축소/복원인가, 그 값이 세션을 왕복하는가.
 * 실제로 글자가 커지는지는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import { parseSession, windowRecord, SESSION_VERSION, type WindowSnapshot } from "../src/lib/session";
import {
  anchorShift,
  clampZoom,
  matchZoomKey,
  zoomLabel,
  zoomScale,
  zoomStep,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  type ZoomChord,
} from "../src/lib/zoom";

const chord = (over: Partial<ZoomChord>): ZoomChord => ({
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  code: "KeyA",
  ...over,
});

describe("걸음 — 10%씩 (메모장과 같다)", () => {
  it("확대·축소가 10% 단위로 움직인다", () => {
    expect(zoomStep(100, 1)).toBe(110);
    expect(zoomStep(110, 1)).toBe(120);
    expect(zoomStep(100, -1)).toBe(90);
    expect(zoomStep(90, -1)).toBe(80);
  });

  it("10의 배수가 아닌 값에서는 걸음에 **맞춘다**", () => {
    // 세션에서 115%가 돌아와도 한 번 누르면 걸음이 흔들리지 않는다.
    expect(zoomStep(115, 1)).toBe(120);
    expect(zoomStep(115, -1)).toBe(110);
  });

  it("끝에 닿으면 그 값에 머문다", () => {
    expect(zoomStep(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(zoomStep(495, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(15, -1)).toBe(ZOOM_MIN);
  });

  it("한 걸음으로 끝까지 가는 길이 있다 — 10%에서 올리면 20%", () => {
    expect(zoomStep(ZOOM_MIN, 1)).toBe(20);
  });
});

describe("범위 — 10%~500%", () => {
  it("밖으로 나가면 당겨 온다", () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-200)).toBe(ZOOM_MIN);
    expect(clampZoom(10000)).toBe(ZOOM_MAX);
  });

  it("숫자가 아니거나 NaN이면 100%", () => {
    expect(clampZoom(undefined)).toBe(ZOOM_DEFAULT);
    expect(clampZoom("120")).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_DEFAULT);
  });

  it("소수는 정수로 (CSS 변수 값이 흔들리지 않게)", () => {
    expect(clampZoom(119.6)).toBe(120);
  });

  it("CSS 변수는 배수다 — 본문 15px × 이 값", () => {
    expect(zoomScale(100)).toBe(1);
    expect(zoomScale(150)).toBe(1.5);
  });
});

describe("키 맞추기", () => {
  it("확대 — Ctrl+= · Ctrl+Shift+=(= Ctrl++) · Ctrl+숫자패드 +", () => {
    expect(matchZoomKey(chord({ code: "Equal" }))).toBe("in");
    expect(matchZoomKey(chord({ code: "Equal", shiftKey: true }))).toBe("in");
    expect(matchZoomKey(chord({ code: "NumpadAdd" }))).toBe("in");
  });

  it("축소 — Ctrl+- · Ctrl+숫자패드 -", () => {
    expect(matchZoomKey(chord({ code: "Minus" }))).toBe("out");
    expect(matchZoomKey(chord({ code: "NumpadSubtract" }))).toBe("out");
  });

  it("복원 — Ctrl+0 · Ctrl+숫자패드 0", () => {
    expect(matchZoomKey(chord({ code: "Digit0" }))).toBe("reset");
    expect(matchZoomKey(chord({ code: "Numpad0" }))).toBe("reset");
  });

  it("Ctrl이 없으면 아니다 — 그냥 `-`나 `0`을 치는 것은 글자 입력이다", () => {
    expect(matchZoomKey(chord({ code: "Minus", ctrlKey: false }))).toBeNull();
    expect(matchZoomKey(chord({ code: "Digit0", ctrlKey: false }))).toBeNull();
  });

  it("Alt가 끼면 아니다 (Ctrl+Alt는 AltGr)", () => {
    expect(matchZoomKey(chord({ code: "Equal", altKey: true }))).toBeNull();
    expect(matchZoomKey(chord({ code: "Digit0", altKey: true }))).toBeNull();
  });

  it("메모장에 없는 조합은 받지 않는다 — Ctrl+Shift+- · Ctrl+Shift+0", () => {
    expect(matchZoomKey(chord({ code: "Minus", shiftKey: true }))).toBeNull();
    expect(matchZoomKey(chord({ code: "Digit0", shiftKey: true }))).toBeNull();
  });

  it("다른 단축키를 가로채지 않는다 — Ctrl+Z · Ctrl+1", () => {
    expect(matchZoomKey(chord({ code: "KeyZ" }))).toBeNull();
    expect(matchZoomKey(chord({ code: "Digit1" }))).toBeNull();
  });
});

describe("상태 글자 — 100%에서는 보여 주지 않는다 (메모장과 같다)", () => {
  it("100%는 빈 문자열", () => {
    expect(zoomLabel(100)).toBe("");
  });

  it("그 밖에는 퍼센트", () => {
    expect(zoomLabel(120)).toBe("120%");
    expect(zoomLabel(90)).toBe("90%");
  });
});

// ---------------------------------------------------------------------------
// 세션 왕복 — 창 기록에 들어가고, 옛 세션(칸이 없던 때)은 100%로 읽힌다
// ---------------------------------------------------------------------------

function snapWin(zoom: number): WindowSnapshot {
  return {
    id: "w1",
    rect: null,
    maximized: false,
    overlay: false,
    opacity: 100,
    pinned: false,
    zoom,
    activeUid: "t1",
    tabs: [
      {
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
      },
    ],
  };
}

function roundTrip(zoom: number): number | undefined {
  const { record } = windowRecord(snapWin(zoom));
  const text = JSON.stringify({ v: SESSION_VERSION, activeWindow: 0, windows: [record] });
  return parseSession(text)?.windows[0]?.zoom;
}

describe("세션 왕복 (창의 성질 — 탭이 아니다)", () => {
  it("값이 그대로 돌아온다", () => {
    expect(roundTrip(150)).toBe(150);
    expect(roundTrip(ZOOM_DEFAULT)).toBe(ZOOM_DEFAULT);
  });

  it("쓸 때도 범위 안으로 당긴다 — 깨진 값이 파일에 들어가지 않는다", () => {
    expect(roundTrip(10000)).toBe(ZOOM_MAX);
    expect(roundTrip(0)).toBe(ZOOM_MIN);
  });

  it("**옛 세션**(zoom 칸이 없는 파일)은 100%로 읽힌다", () => {
    const old = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 0,
      windows: [
        {
          id: "w1",
          rect: null,
          maximized: false,
          overlay: false,
          opacity: 100,
          pinned: false,
          activeTab: "t1",
          tabs: [{ id: "t1", format: "markdown" }],
        },
      ],
    });
    expect(parseSession(old)?.windows[0]?.zoom).toBe(ZOOM_DEFAULT);
  });

  it("깨진 값(문자열)도 100%로 읽힌다", () => {
    const bad = JSON.stringify({
      v: SESSION_VERSION,
      activeWindow: 0,
      windows: [
        {
          id: "w1",
          rect: null,
          opacity: 100,
          zoom: "크게",
          activeTab: "t1",
          tabs: [{ id: "t1", format: "markdown" }],
        },
      ],
    });
    expect(parseSession(bad)?.windows[0]?.zoom).toBe(ZOOM_DEFAULT);
  });
});

/**
 * 읽던 자리 — 메모장은 확대/축소에서 **맨 위에 보이던 줄을 그 자리에 둔다**(커서로
 * 뛰지 않는다). 여기서 보는 것은 "얼마나 더 스크롤해야 제자리인가"라는 순수한 계산이고,
 * 실제로 줄이 안 튀는지는 사용자가 확인한다.
 */
describe("확대/축소 — 읽던 줄 되돌리기", () => {
  it("줄이 딱 맞게 붙어 있었으면 움직일 거리는 그 줄이 밀려난 만큼이다", () => {
    // 전에 0px(윗변에 딱), 확대 뒤 그 줄이 40px 내려와 있으면 40px 더 스크롤한다.
    expect(anchorShift(40, 0, 1.2)).toBe(40);
  });

  it("위로 걸쳐 있던 만큼은 배율만큼 같이 커진다", () => {
    // 전에 -10px(윗변 위로 10px 잘려 있었다) → 1.5배면 -15px여야 한다.
    expect(anchorShift(30, -10, 1.5)).toBe(45);
    expect(anchorShift(0, -10, 0.5)).toBe(5);
  });

  it("아무것도 안 바뀌었으면 움직이지 않는다", () => {
    expect(anchorShift(-7, -7, 1)).toBe(0);
  });

  it("잴 수 없는 값(NaN)이 들어오면 움직이지 않는다", () => {
    expect(anchorShift(Number.NaN, 0, 1)).toBe(0);
    expect(anchorShift(10, Number.NaN, 1)).toBe(0);
  });
});
