/**
 * 설정 화면(시안 S) ↔ 메뉴 양방향 동기화 (MIGRATION_HANDOFF §5).
 *
 * 검사하는 것은 **"두 화면이 같은 값을 보고 같은 일을 시키는가"**다. 그릴 수 있는지는
 * 사용자가 확인한다(UI 자동 테스트 금지).
 *
 * 핵심 보증 셋:
 *   1. 설정 화면의 모든 컨트롤은 메뉴 행과 **같은 `Action`**을 보낸다 → 누르는 길이
 *      하나(`App.runAction`)라 한쪽만 바뀌는 일이 생길 수 없다.
 *   2. 보이는 상태는 메뉴의 체크·라디오를 정하는 같은 `itemMark`로 정한다.
 *   3. ☰ › 보기에 임시로 있던 `시작` 두 줄은 **없어졌고**(설정 화면으로 옮겼다),
 *      ⚙와 ☰의 `설정`이 같은 명령 하나를 가리킨다.
 */

import { describe, expect, it } from "vitest";

import {
  ROOT_MENU,
  itemEnabled,
  itemMark,
  rootMenu,
  type Action,
  type Menu,
  type MenuItem,
  type MenuState,
} from "../src/lib/menus";
import {
  DEFAULTS,
  SHARED_KEYS,
  WINDOW_KEYS,
  mergeShared,
  type Settings,
} from "../src/lib/settings";
import {
  PANEL_STARTUP,
  PANEL_THEMES,
  PANEL_TINTS,
  PANEL_TOGGLES,
  panelOn,
} from "../src/lib/settingsPanel";

function state(patch: Partial<MenuState> = {}): MenuState {
  return {
    overlay: false,
    tapeOn: false,
    statusBar: DEFAULTS.statusBar,
    textBacking: DEFAULTS.textBacking,
    noteList: DEFAULTS.noteList,
    theme: DEFAULTS.theme,
    tint: DEFAULTS.tint,
    zoom: 100,
    startup: DEFAULTS.startup,
    highlight: DEFAULTS.highlight,
    fontFamily: DEFAULTS.fontFamily,
    fontSize: DEFAULTS.fontSize,
    maximized: false,
    minimized: false,
    edit: {
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      hasText: false,
      canFormat: true,
      remindCount: 0,
    },
    ...patch,
  };
}

/** 메뉴(하위 메뉴까지)의 모든 행 Action을 납작하게 모은다. */
function actions(menu: Menu): Action[] {
  const out: Action[] = [];
  const walk = (items: readonly MenuItem[]) => {
    for (const item of items) {
      if (item.kind === "row") out.push(item.act);
      else if (item.kind === "sub") walk(item.menu.items);
      // 간략 메뉴(시안 C2)의 덩어리 — 세그먼트 칸·색 점도 같은 `Action`을 보낸다.
      else if (item.kind === "segment" || item.kind === "dots") {
        for (const opt of item.options) out.push(opt.act);
      }
    }
  };
  walk(menu.items);
  return out;
}

const ALL = actions(ROOT_MENU);
const has = (act: Action) => ALL.some((a) => JSON.stringify(a) === JSON.stringify(act));

describe("설정 화면의 모든 컨트롤은 메뉴와 같은 Action을 쓴다", () => {
  it("앱 테마 세 칩 = 테마 메뉴의 세 행", () => {
    expect(PANEL_THEMES.map((c) => c.act)).toEqual([
      { t: "theme", value: "dark" },
      { t: "theme", value: "light" },
      { t: "theme", value: "system" },
    ]);
    for (const c of PANEL_THEMES) expect(has(c.act)).toBe(true);
  });

  // 사용자 결정 2026-11-08: 테마를 고르는 일이 색을 지우지 않으므로 `색 없음` 행이
  // 양쪽(메뉴·설정) 맨 앞에 있다.
  it("메모지 색 = `색 없음` + 4점, 테마 메뉴의 같은 다섯 행", () => {
    expect(PANEL_TINTS.map((c) => c.act)).toEqual([
      { t: "tint", value: "none" },
      { t: "tint", value: "yellow" },
      { t: "tint", value: "mint" },
      { t: "tint", value: "pink" },
      { t: "tint", value: "sky" },
    ]);
    for (const c of PANEL_TINTS) expect(has(c.act)).toBe(true);
    expect(has({ t: "tint", value: "none" })).toBe(true);
    // `색 없음`은 빈 동그라미 — 색 값이 없다.
    expect(PANEL_TINTS[0]!.color).toBe("");
    expect(PANEL_TINTS.slice(1).every((c) => c.color !== "")).toBe(true);
  });

  it("기타 카드의 토글 둘 = 보기 메뉴의 같은 두 토글", () => {
    expect(PANEL_TOGGLES.map((c) => c.act)).toEqual([
      { t: "toggle", id: "statusBar" },
      { t: "toggle", id: "textBacking" },
    ]);
    for (const c of PANEL_TOGGLES) expect(has(c.act)).toBe(true);
  });

  it("시안에 없는 항목은 설정 화면에 없다 (오버레이 · 메모 목록 · 형광펜)", () => {
    const panel = [
      ...PANEL_THEMES,
      ...PANEL_TINTS,
      ...PANEL_STARTUP,
      ...PANEL_TOGGLES,
    ].map((c) => JSON.stringify(c.act));
    expect(panel).not.toContain(JSON.stringify({ t: "toggle", id: "overlay" }));
    expect(panel).not.toContain(JSON.stringify({ t: "toggle", id: "noteList" }));
    expect(panel.some((a) => a.includes('"highlight"'))).toBe(false);
  });
});

describe("보이는 상태는 메뉴와 같은 itemMark로 정한다", () => {
  it("테마 라디오는 고른 값 하나만 켜진다", () => {
    for (const choice of ["dark", "light", "system"] as const) {
      const s = state({ theme: choice });
      const on = PANEL_THEMES.filter((c) => panelOn(c.act, s));
      expect(on).toHaveLength(1);
      expect(on[0]?.act).toEqual({ t: "theme", value: choice });
    }
  });

  it("시작 라디오의 기본값은 `이전 세션의 콘텐츠 열기`다", () => {
    const s = state();
    expect(panelOn(PANEL_STARTUP[0]!.act, s)).toBe(true);
    expect(panelOn(PANEL_STARTUP[1]!.act, s)).toBe(false);
    const fresh = state({ startup: "fresh" });
    expect(panelOn(PANEL_STARTUP[0]!.act, fresh)).toBe(false);
    expect(panelOn(PANEL_STARTUP[1]!.act, fresh)).toBe(true);
  });

  it("토글은 설정 값을 그대로 따라간다", () => {
    const [statusBar, textBacking] = PANEL_TOGGLES;
    expect(panelOn(statusBar!.act, state({ statusBar: true }))).toBe(true);
    expect(panelOn(statusBar!.act, state({ statusBar: false }))).toBe(false);
    expect(panelOn(textBacking!.act, state({ textBacking: true }))).toBe(true);
    expect(panelOn(textBacking!.act, state({ textBacking: false }))).toBe(false);
  });

  it("메모지 점은 **지금 탭의 색** 하나만 켜진다 (설정의 기본값이 아니라 탭 색)", () => {
    const s = state({ tint: "pink" });
    const on = PANEL_TINTS.filter((c) => panelOn(c.act, s));
    expect(on).toHaveLength(1);
    expect(on[0]?.act).toEqual({ t: "tint", value: "pink" });
    // 색이 없으면 `색 없음` 행 하나만 켜진다.
    const none = PANEL_TINTS.filter((c) => panelOn(c.act, state({ tint: "none" })));
    expect(none).toHaveLength(1);
    expect(none[0]?.act).toEqual({ t: "tint", value: "none" });
  });

  it("설정 화면과 메뉴가 **같은 답**을 낸다 (itemMark 하나를 쓰므로)", () => {
    const s = state({ theme: "system", startup: "fresh", statusBar: false });
    for (const c of [...PANEL_THEMES, ...PANEL_STARTUP, ...PANEL_TOGGLES]) {
      expect(panelOn(c.act, s)).toBe(itemMark(c.act, s)?.on ?? false);
    }
  });
});

describe("메모지 색 줄은 어느 테마에서도 보인다 (사용자 결정 2026-11-08)", () => {
  it("다크 테마에서도 메모지 점의 켜짐 상태를 그대로 낸다", () => {
    const dark = state({ theme: "dark", tint: "yellow" });
    const on = PANEL_TINTS.filter((c) => panelOn(c.act, dark));
    expect(on).toHaveLength(1);
    expect(on[0]?.act).toEqual({ t: "tint", value: "yellow" });
  });

  it("줄을 숨기는 규칙(`tintRowVisible`)은 더 이상 없다", async () => {
    const mod = await import("../src/lib/settingsPanel");
    expect("tintRowVisible" in mod).toBe(false);
  });
});

describe("☰ 메뉴와 보기 메뉴의 정리", () => {
  it("보기 메뉴에 `시작` 두 줄이 더 이상 없다 (설정 화면으로 옮겼다)", () => {
    expect(has({ t: "startup", value: "restore" })).toBe(false);
    expect(has({ t: "startup", value: "fresh" })).toBe(false);
  });

  // 폭 286은 `시작` 두 줄을 설정으로 옮기면서 되돌린 값이었다. 간략 메뉴(시안 C2,
  // 사용자 결정 2026-11-09)에서 다시 **글자에 맞춰** 좁아졌다 — 자세한 값은
  // `scripts/menuCompact.test.ts`가 지킨다.
  it("보기 메뉴 폭은 글자에 맞춘 간략 폭이다", () => {
    const view = ROOT_MENU.items.find(
      (item) => item.kind === "sub" && item.label === "moreView"
    );
    expect(view?.kind).toBe("sub");
    const width = view && view.kind === "sub" ? view.menu.width : 0;
    expect(width).toBeGreaterThanOrEqual(170);
    expect(width).toBeLessThan(286);
  });

  it("☰에 `설정` 행이 있고, ⚙와 같은 명령(`settings`)을 가리킨다", () => {
    expect(has({ t: "cmd", id: "settings" })).toBe(true);
    // 개발 빌드의 꼬리(토스트 미리보기)가 붙어도 설정 행은 그대로 하나다.
    const dev = actions(rootMenu(true)).filter(
      (a) => a.t === "cmd" && a.id === "settings"
    );
    expect(dev).toHaveLength(1);
  });

  // 사용자 결정 2026-11-09: UI 언어는 **항상 자동**(Windows 표시 언어)라
  // 고를 수 있는 자리가 어느 화면에도 없다.
  it("`언어` 그룹은 메뉴에도 설정에도 없다", async () => {
    expect(ALL.some((a) => a.t === ("lang" as string))).toBe(false);
    const menus = await import("../src/lib/menus");
    expect("LANG_MENU" in menus).toBe(false);
    const panel = await import("../src/lib/settingsPanel");
    expect("PANEL_LANGS" in panel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 다중 창 — 어떤 값이 번지고 어떤 값이 창에 머무는가 (사용자가 보고한 버그)
//
// 보고: "창 여러개 띄어놓고 메뉴나 하이라이터 적용하면 같이 다른창에도 같이 적용".
// 원인은 설정 방송(`save_settings` → `broadcast_settings` → `SETTINGS_EVENT` → `adopt`)이
// **창별 값까지** 실어 보내 받는 창이 그대로 심었던 것이다. 여기서 보는 것은 그 규칙의
// 순수한 부분(`mergeShared`)이다 — 받는 쪽이 무엇을 심는지는 `App`의 리스너가 정하고,
// 그 리스너도 같은 규칙을 적어 둔다.
// ---------------------------------------------------------------------------

/** 창 A가 바꾼 뒤 방송한 값. */
const FROM_A: Settings = {
  theme: "light",
  tint: "pink",
  statusBar: false,
  textBacking: false,
  highlight: 3,
  noteList: true,
  trayNoticeShown: true,
  startup: "fresh",
  fontFamily: "Consolas",
  fontSize: 20,
};

/** 창 B가 들고 있던 값. */
const MINE: Settings = { ...DEFAULTS };

describe("설정 방송 — 앱 전체 값만 번진다 (창별 값은 창에 머문다)", () => {
  it("모든 설정 항목은 `앱 전체`나 `창별` 하나로 분류돼 있다 (빠진 칸 없음)", () => {
    const all = [...SHARED_KEYS, ...WINDOW_KEYS].sort();
    expect(all).toEqual(Object.keys(DEFAULTS).sort());
    // 한 키가 양쪽에 들어가 있으면 규칙이 둘이 된다.
    for (const key of WINDOW_KEYS) {
      expect((SHARED_KEYS as readonly string[]).includes(key)).toBe(false);
    }
  });

  it("테마·상태 표시줄·글자 뒤 배경·시작 동작은 받는 창에 그대로 반영된다", () => {
    const next = mergeShared(MINE, FROM_A);
    expect(next.theme).toBe("light");
    expect(next.statusBar).toBe(false);
    expect(next.textBacking).toBe(false);
    expect(next.startup).toBe("fresh");
    expect(next.trayNoticeShown).toBe(true);
  });

  it("형광펜 색·메모 목록·메모지 색은 **내 값이 그대로** 남는다", () => {
    const next = mergeShared(MINE, FROM_A);
    expect(next.highlight).toBe(MINE.highlight);
    expect(next.noteList).toBe(MINE.noteList);
    expect(next.tint).toBe(MINE.tint);
  });

  it("창별 값을 이미 바꿔 둔 창도 방송을 받아 잃지 않는다", () => {
    const mine: Settings = { ...DEFAULTS, highlight: 1, noteList: true, tint: "sky" };
    const next = mergeShared(mine, FROM_A);
    expect(next.highlight).toBe(1);
    expect(next.noteList).toBe(true);
    expect(next.tint).toBe("sky");
    expect(next.theme).toBe("light");
  });

  it("깨진 값·빈 방송은 아무것도 바꾸지 않는다", () => {
    expect(mergeShared(MINE, null)).toEqual(MINE);
    expect(mergeShared(MINE, "nope")).toEqual(MINE);
    expect(mergeShared(MINE, {})).toEqual(MINE);
    // 범위를 벗어난 값은 기본값으로 떨어진다(`sanitize`와 같은 규칙).
    expect(mergeShared(MINE, { theme: "보라" }).theme).toBe(DEFAULTS.theme);
  });

  it("방송을 두 번 받아도 같은 값이다 (되울림이 값을 흔들지 않는다)", () => {
    const once = mergeShared(MINE, FROM_A);
    expect(mergeShared(once, FROM_A)).toEqual(once);
    // A가 B의 값을 되받아도 A의 창별 값은 그대로다.
    expect(mergeShared(FROM_A, once).highlight).toBe(FROM_A.highlight);
  });
});

describe("고정(테이프)·오버레이 중에는 찾기가 없다 (지시 2)", () => {
  it("고정 중에는 찾기·바꾸기 행이 꺼진다", () => {
    const pinned = state({ tapeOn: true });
    expect(itemEnabled({ t: "cmd", id: "find" }, pinned)).toBe(false);
    expect(itemEnabled({ t: "cmd", id: "replace" }, pinned)).toBe(false);
  });

  it("고정이 아니면 평소대로 켜져 있다", () => {
    const normal = state();
    expect(itemEnabled({ t: "cmd", id: "find" }, normal)).toBe(true);
    expect(itemEnabled({ t: "cmd", id: "replace" }, normal)).toBe(true);
  });

  it("고정이 찾기 말고 다른 행을 끄지는 않는다", () => {
    const pinned = state({ tapeOn: true, edit: { ...state().edit, hasText: true } });
    expect(itemEnabled({ t: "cmd", id: "save" }, pinned)).toBe(true);
    expect(itemEnabled({ t: "cmd", id: "selectAll" }, pinned)).toBe(true);
    expect(itemEnabled({ t: "toggle", id: "statusBar" }, pinned)).toBe(true);
  });
});
