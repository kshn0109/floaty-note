/**
 * 메뉴 정의 — 원본 `main.cpp`의 `MoreItem` / `MenuSpec` 표를 그대로 옮긴 것.
 *
 * 모양은 승인된 시안 `Popups.dc.html`이다(팝업 r12 · 패딩 5 · bar 배경 · 1px hairline ·
 * 행 30 r8 · 단축키 오른쪽 정렬 dim · 구분선 1px 여백 4 8 · 섹션 라벨 22px dim).
 * 그리는 쪽은 `components/Popup.tsx` 하나이고, 이 파일은 **무엇이 들어 있는지만** 말한다.
 *
 * 원본과 달라진 곳 두 군데 (둘 다 R5 배치 때문):
 *   1. 바에 있던 `파일`·`보기`·`테마` 머리 세 개가 없어졌으므로(R5에는 서식 바가 없다)
 *      셋을 ☰ 한 버튼 아래 **하위 메뉴**로 모았다. AI는 원본에서 바의 버튼이었고
 *      시안 R5에 그 버튼이 없어 ☰ 안의 행 하나로 들어왔다(모양만, 기능 없음).
 *   2. `반투명일 때 글자 뒤 배경`은 원본에서 형광펜 색 팝업 안에 있었는데 `보기`로
 *      옮겼다. R5의 형광펜 팝업은 이번 단계에서 **모양만**이라, 거기 하나만 진짜로
 *      동작하는 토글을 두면 더 혼란스럽다. 되돌리기 쉬운 한 줄이다.
 *
 * 단축키 문자열("Ctrl+N", "Alt+F4")은 어느 언어에서나 같은 토큰이라 문자열 표가 아니라
 * 여기 직접 쓴다 — 원본과 같은 규칙이다(상태 표시줄의 "UTF-8", "LF"와 같은 이유).
 */

import type { CommandId } from "./commands";
import type { StrId } from "./i18n";
import { HIGHLIGHTS, TINT_DOTS } from "./palette";
import type { StartupMode } from "./settings";
import type { ThemeChoice, Tint } from "./theme";

/** 시스템 메뉴의 여섯 항목 — Rust `syscmd::SysCommand`와 1:1 (camelCase로 직렬화). */
export const SYS_COMMANDS = [
  "restore",
  "move",
  "size",
  "minimize",
  "maximize",
  "close",
] as const;
export type SysCommand = (typeof SYS_COMMANDS)[number];

/**
 * 체크 표시를 갖는 켜고 끄기 항목. **이름이 `MenuState`의 키와 같아야 한다**
 * (`itemMark`가 `state[act.id]`로 체크 상태를 읽는다).
 *
 * `tapeOn`은 테이프(항상 위)다 — 켜진 모양은 `pinned || overlay`이고 그 값이 곧
 * `MenuState.tapeOn`이다.
 */
export type ToggleId = "overlay" | "statusBar" | "textBacking" | "noteList" | "tapeOn";

export type Action =
  | { t: "none" }
  | { t: "cmd"; id: CommandId }
  | { t: "sys"; id: SysCommand }
  | { t: "toggle"; id: ToggleId }
  | { t: "theme"; value: ThemeChoice }
  | { t: "tint"; value: Tint }
  | { t: "startup"; value: StartupMode }
  // 설정 › 모양 › `글꼴` 카드(시안 G1). 글꼴 이름은 PC마다 다르므로 자유 문자열이고
  // `""`가 `기본`이다. 크기는 pt(`lib/fonts.ts`의 `FONT_SIZES`).
  | { t: "font"; value: string }
  | { t: "fontSize"; value: number }
  | { t: "highlight"; value: number }
  /** 탭 목록(시안 T1)에서 탭 하나를 골랐다 — `id`는 `Tab.id`. */
  | { t: "tab"; id: number };

/** 세그먼트 버튼의 칸 하나 · 색 점 하나 (시안 C2의 `테마` 메뉴). */
export interface Choice {
  label: StrId;
  act: Action;
}
export interface DotChoice extends Choice {
  /** 색 점의 색. `""`면 `색 없음`(빈 동그라미). */
  color: string;
}

export type MenuItem =
  | { kind: "sep" }
  | { kind: "heading"; label: StrId; key?: string }
  /**
   * 고르는 행. 보통은 `label`(문자열 표의 id)이지만, **글꼴 목록처럼 값이 그때그때
   * 다른 행**은 `text`에 글자를 그대로 담는다(시안 G1 — 설치된 글꼴 이름·크기 숫자).
   * `font`를 주면 그 행만 그 글꼴로 그린다(글꼴 이름을 자기 글꼴로 보여 주는 자리).
   *
   * `short`는 **간략 메뉴(`compact`)에서만** 쓰는 짧은 라벨이다(시안 C2는 폭을 글자에
   * 맞추므로 `반투명일 때 글자 뒤 배경` 같은 긴 문구가 들어가지 않는다). 설정 카드는
   * 긴 쪽을 그대로 쓴다.
   */
  | {
      kind: "row";
      label?: StrId;
      short?: StrId;
      text?: string;
      font?: string;
      key?: string;
      act: Action;
    }
  | { kind: "sub"; label: StrId; menu: Menu }
  /**
   * 확대/축소 한 줄 (시안 C2): 왼쪽 라벨 + [−] [현재 배율] [+]. 머리 + 세 행을
   * 한 줄로 접은 것이고 명령은 그대로 `zoomOut`/`zoomReset`/`zoomIn`이다.
   */
  | { kind: "zoom" }
  /** 세그먼트 버튼 한 덩어리 (시안 C2의 `테마` 3칸). `key`는 말풍선·낭독기용. */
  | { kind: "segment"; label: StrId; key?: string; options: readonly Choice[] }
  /** 색 점 한 덩어리 (시안 C2의 `메모지 색` 5점). */
  | { kind: "dots"; label: StrId; options: readonly DotChoice[] }
  /**
   * 탭 목록의 한 줄 (승인된 시안 T1): 색 점 8 · 이름(길면 `…`) · 저장 안 됨 점 6 ·
   * 지금 탭 ✓. 높이·반지름·폭은 **기존 팝업 그대로**(행 30 · r8 · 팝업 r12 · 236)라
   * 새 모양이 아니다. 이름은 PC마다 다른 값이라 `row`의 `text`처럼 글자를 직접 담는다.
   */
  | {
      kind: "tab";
      id: number;
      text: string;
      /** 색 점의 색. `""`면 `색 없음`(dim 테두리 빈 점) — `dots`·`swatch`와 같은 규칙. */
      color: string;
      dirty: boolean;
      active: boolean;
    };

export interface Menu {
  /** 스크린 리더가 읽는 이름 겸 디버그용 이름. */
  title: StrId;
  /** 팝업 폭(px). 행 높이가 고정이라 폭까지 정하면 위치 계산에 추측이 없다. */
  width: number;
  items: MenuItem[];
  /**
   * **간략 메뉴**(승인된 시안 C2 — 사용자 결정 2026-11-09). 줄 26 · 패딩 0 8 · r7 ·
   * 구분선 여백 3 6 · 머리 20이고 **단축키 글자를 줄에 그리지 않는다**(대신 말풍선).
   * ☰의 하위 메뉴 셋(파일·보기·테마)만 참이다 — 다른 메뉴는 Popups 시안 그대로.
   */
  compact?: boolean;
  /** 팝업 안쪽 여백. 없으면 `POPUP_PAD`(5). 시안 C2의 `테마`는 8이다. */
  pad?: number;
  /**
   * 이 index부터의 행들은 **따로 구르는 칸**에 들어간다(시안 G1의 글꼴 목록: 맨 위
   * `기본`과 구분선은 제자리에 있고 설치된 글꼴만 스크롤). 없으면 전부 제자리다.
   */
  scrollFrom?: number;
  /** 구르는 칸의 최대 높이(px). `scrollFrom`과 같이 쓴다. */
  scrollH?: number;
}

// ---------------------------------------------------------------------------
// 파일 — **Windows 11 메모장의 파일 메뉴 구성**(지시).
//
// 메모장 11: 새 탭 Ctrl+N · 새 창 Ctrl+Shift+N · 열기 Ctrl+O · 저장 Ctrl+S ·
// 다른 이름으로 저장 Ctrl+Shift+S · 모두 저장 Ctrl+Alt+S · (페이지 설정 · 인쇄) ·
// 탭 닫기 Ctrl+W · 창 닫기 Ctrl+Shift+W · 끝내기. 인쇄 두 줄은 넣지 않는다(지시).
//
// 원본에 있던 `새 문서` 행은 없어졌다: 메모장에는 "이 탭을 비우기"가 없고 `Ctrl+N`이
// 새 탭이다. `Ctrl+T`도 새 탭으로 동작하지만 **메뉴에는 `Ctrl+N` 한 줄만** 보인다
// (메모장이 그렇게 하고, 지시도 그렇다).
// ---------------------------------------------------------------------------
//
// 시안 C2(사용자 결정 2026-11-09): **간략 메뉴**다 — 줄 26, 폭은 글자에 맞춘 150,
// 단축키는 줄에서 빼고 말풍선으로 보여 준다(`key`는 그대로 남아 말풍선과
// `aria-keyshortcuts`가 쓴다).
const FILE_MENU: Menu = {
  title: "moreFile",
  width: 150,
  compact: true,
  items: [
    { kind: "row", label: "menuNewTab", key: "Ctrl+N", act: { t: "cmd", id: "newTab" } },
    { kind: "row", label: "menuNewWindow", key: "Ctrl+Shift+N", act: { t: "cmd", id: "newWindow" } },
    { kind: "sep" },
    { kind: "row", label: "btnOpen", key: "Ctrl+O", act: { t: "cmd", id: "open" } },
    { kind: "row", label: "btnSave", key: "Ctrl+S", act: { t: "cmd", id: "save" } },
    { kind: "row", label: "menuSaveAs", key: "Ctrl+Shift+S", act: { t: "cmd", id: "saveAs" } },
    { kind: "row", label: "menuSaveAll", key: "Ctrl+Alt+S", act: { t: "cmd", id: "saveAll" } },
    { kind: "sep" },
    { kind: "row", label: "menuCloseTab", key: "Ctrl+W", act: { t: "cmd", id: "closeTab" } },
    {
      kind: "row",
      label: "menuCloseWindow",
      key: "Ctrl+Shift+W",
      act: { t: "cmd", id: "closeWindow" },
    },
    { kind: "row", label: "menuExit", act: { t: "cmd", id: "exit" } },
  ],
};

// ---------------------------------------------------------------------------
// 보기 — 원본 kViewItems + 메모 목록 + 글자 뒤 배경
//
// `언어` 그룹 세 줄은 **없어졌다**(사용자 결정 2026-11-09): UI 언어는 **항상 자동** —
// Windows 표시 언어를 따른다. 고르는 입구가 없으므로 메뉴에도 설정에도 줄이 없다.
// ---------------------------------------------------------------------------
//
// `시작` 두 줄(`Inkwell이 시작될 때`)은 설정 창이 없던 동안 여기 임시로 있었다.
// 설정 화면(시안 S)이 생겼으므로 **지웠고**, 폭도 그 긴 한국어 문구 때문에 올렸던
// 360에서 원래의 286으로 되돌렸다. 값과 동작은 그대로 `settings.ts`에 있고, 설정
// 화면과 이 메뉴는 같은 `Action`·같은 `runAction`을 쓰므로 양방향 동기화는 공짜다.
//
// 시안 C2(사용자 결정 2026-11-09): 간략 메뉴다. 시안의 폭은 170인데 **176**을 쓴다 —
// `확대/축소` 줄이 라벨 + 22 + 38 + 22 + 간격 12를 들고 있어 170에서는 한국어 라벨이
// 몇 px 눌린다(사용자 지시: 넘치면 넓히되 시안 폭 이상).
const VIEW_MENU: Menu = {
  title: "moreView",
  width: 176,
  compact: true,
  items: [
    { kind: "row", label: "menuFind", key: "Ctrl+F", act: { t: "cmd", id: "find" } },
    { kind: "row", label: "findBtnReplace", key: "Ctrl+H", act: { t: "cmd", id: "replace" } },
    { kind: "sep" },
    { kind: "row", label: "menuNoteList", act: { t: "toggle", id: "noteList" } },
    // `항상 위에 고정` — 테이프(시안 Pin)와 **같은 상태**다. 테이프는 위 줄 가운데에
    // 있어 좁은 창(≤420)에서 자리를 잃으므로, 테이프를 못 보는 폭에서도 고정을 켜고
    // 끌 입구가 있어야 한다(지시 5). 메모장 11에는 이 기능 자체가 없다.
    { kind: "row", label: "menuAlwaysOnTop", act: { t: "toggle", id: "tapeOn" } },
    { kind: "row", label: "menuOverlay", key: "Ctrl+Shift+T", act: { t: "toggle", id: "overlay" } },
    { kind: "row", label: "menuStatusBar", act: { t: "toggle", id: "statusBar" } },
    {
      kind: "row",
      label: "menuTextBacking",
      short: "menuTextBackingShort",
      act: { t: "toggle", id: "textBacking" },
    },
    { kind: "sep" },
    // 확대/축소 — 메모장 11의 `보기 › 확대/축소`와 같은 세 명령이지만 시안 C2는 머리 +
    // 세 줄을 **한 줄**로 접는다(− 100% +). 누르면 메뉴는 닫히지 않고 배율 글자만 바뀐다.
    { kind: "zoom" },
  ],
};

// ---------------------------------------------------------------------------
// 테마 — 원본 kThemeItems 그대로.
//
// 머리가 Ctrl+Shift+M을 들고 있는 것도 원본과 같다: 순환은 세 값 중 하나에 속한
// 것이 아니라 그룹에 속한다. 메모지 색 그룹 맨 위에는 `색 없음` 행이 있다
// (사용자 결정 2026-11-08) — 테마를 고르는 일이 더는 색을 지우지 않으므로 색을
// 끄는 입구가 여기 있어야 한다. 색은 테마와 무관하게 유지되므로 이 그룹은
// **다크 테마에서도** 그대로 보인다.
// ---------------------------------------------------------------------------
// 시안 C2(사용자 결정 2026-11-09): 11줄이 **두 덩어리**가 되었다 — 세그먼트 버튼
// 셋과 색 점 다섯. 고르는 `Action`은 그대로이고(설정 카드와 같은 길), 고른 뒤 메뉴는
// 닫히지 않는다(설정 카드처럼 즉시 반영). Ctrl+Shift+M은 `테마` 덩어리의 말풍선이다.
const THEME_MENU: Menu = {
  title: "menuTheme",
  width: 176,
  compact: true,
  pad: 8,
  items: [
    {
      kind: "segment",
      label: "menuTheme",
      key: "Ctrl+Shift+M",
      options: [
        { label: "menuThemeDark", act: { t: "theme", value: "dark" } },
        { label: "menuThemeLight", act: { t: "theme", value: "light" } },
        { label: "menuThemeSystem", act: { t: "theme", value: "system" } },
      ],
    },
    {
      kind: "dots",
      label: "menuMemoColor",
      options: [
        { label: "memoNone", act: { t: "tint", value: "none" }, color: "" },
        { label: "memoYellow", act: { t: "tint", value: "yellow" }, color: TINT_DOTS.yellow },
        { label: "memoMint", act: { t: "tint", value: "mint" }, color: TINT_DOTS.mint },
        { label: "memoPink", act: { t: "tint", value: "pink" }, color: TINT_DOTS.pink },
        { label: "memoSky", act: { t: "tint", value: "sky" }, color: TINT_DOTS.sky },
      ],
    },
  ],
};

/** ☰ — R5의 도구 줄 왼쪽 끝. 원래 바의 메뉴 머리 셋을 하위 메뉴로 모았다. */
export const ROOT_MENU: Menu = {
  title: "dockMenu",
  width: 196,
  items: [
    { kind: "sub", label: "moreFile", menu: FILE_MENU },
    { kind: "sub", label: "moreView", menu: VIEW_MENU },
    { kind: "sub", label: "menuTheme", menu: THEME_MENU },
    { kind: "sep" },
    // AI 줄은 출시 전까지 뺐다(사용자 요청 2026-11-11 — 미완성이라 Store 베타에 안 보이게).
    // 다시 넣을 때: { kind: "row", label: "btnAi", key: "Ctrl+Shift+A", act: { t: "cmd", id: "aiPanel" } }, { kind: "sep" },
    // 알림 — 원본은 ⋯ 메뉴에 `알림` 머리 아래 `알림 예약…`과 `예약된 알림` 두 줄을
    // 두었다. 여기는 **목록 한 줄만** 둔다(지시 3): `알림 예약…`은 선택한 글에
    // 걸리는 명령이라 우클릭 메뉴와 Ctrl+Shift+R이 제자리고, ☰를 누르는 사이
    // 선택이 살아 있는지가 불분명한 자리에 같은 줄을 또 두면 회색 줄만 늘어난다.
    // 예약이 없으면 이 줄은 회색이다(`itemEnabled`의 `remindList`).
    { kind: "row", label: "menuReminderList", act: { t: "cmd", id: "remindList" } },
    { kind: "sep" },
    // 설정(시안 S) — 도구 줄의 ⚙와 **같은 명령**이다. Windows 11 메모장도 ☰의
    // 맨 아래 구분선 뒤에 `설정`을 두고, **단축키는 없다**(메모장에도, 원본
    // Win32 Inkwell에도 설정 단축키가 없다 — 없는 것을 만들지 않는다).
    { kind: "row", label: "dockSettings", act: { t: "cmd", id: "settings" } },
    // 개발 빌드에서만 붙는 두 줄(아래 `rootMenu`). 승인된 토스트(T2) 모양을 사용자가
    // 바로 볼 수 있게 하는 길이고 **배포판에는 들어가지 않는다**(지시 검증 방법).
  ],
};

/**
 * 개발 빌드에서만 보이는 ☰ 메뉴의 꼬리 — 토스트 **모양 확인** 두 줄(떠 있는 동안
 * ✕·hover 정지·8초 닫힘·쌓임을 본다).
 *
 * `선택한 글 1분 뒤 알림(개발용)` 세 번째 줄은 **지웠다**(단계 10): 예약 창이 생겨
 * 진짜 UI로 예약을 넣을 수 있으므로 같은 API를 부르는 우회로가 필요 없다.
 *
 * 조건이 `rootMenu(dev)`의 인자가 아니라 **여기** 있는 이유: 인자로만 거르면
 * 배열 리터럴 자체는 배포 번들에 그대로 남는다(쓰이지 않는 채로 `devToastPreview`
 * 문자열까지 들고). `import.meta.env.DEV`는 번들러가 `false`로 접어 넣으므로 이렇게
 * 쓰면 가지 전체가 사라진다.
 */
const DEV_TOAST_ITEMS: MenuItem[] = import.meta.env.DEV
  ? [
      { kind: "sep" },
      { kind: "row", label: "devToastPreview", act: { t: "cmd", id: "toastPreview" } },
      { kind: "row", label: "devToastPreviewMissed", act: { t: "cmd", id: "toastPreviewMissed" } },
    ]
  : [];

/**
 * ☰ 메뉴. `dev`가 참일 때만 토스트 미리보기 두 줄이 붙는다 — `App`이
 * `import.meta.env.DEV`를 넘긴다.
 */
export function rootMenu(dev: boolean): Menu {
  if (!dev) return ROOT_MENU;
  return { ...ROOT_MENU, items: [...ROOT_MENU.items, ...DEV_TOAST_ITEMS] };
}

/**
 * 시스템 메뉴 — 원본 kSysItems 그대로, 같은 순서·같은 비활성 규칙.
 * 여섯 항목 모두 `WM_SYSCOMMAND`로 **보낸다**(Rust `syscmd.rs`) — `이동`·`크기 조정`이
 * Windows 자신의 키보드 루프를 그대로 쓰게 하려면 그 길뿐이다.
 */
export const SYSTEM_MENU: Menu = {
  title: "sysMenuTitle",
  width: 206,
  items: [
    { kind: "row", label: "sysRestore", act: { t: "sys", id: "restore" } },
    { kind: "row", label: "sysMove", act: { t: "sys", id: "move" } },
    { kind: "row", label: "sysSize", act: { t: "sys", id: "size" } },
    { kind: "row", label: "sysMinimize", act: { t: "sys", id: "minimize" } },
    { kind: "row", label: "sysMaximize", act: { t: "sys", id: "maximize" } },
    { kind: "sep" },
    { kind: "row", label: "sysClose", key: "Alt+F4", act: { t: "sys", id: "close" } },
  ],
};

/** H ▾ — 제목 1~3. 서식은 다음 단계라 아직 아무 일도 하지 않는다. */
export const HEADING_MENU: Menu = {
  title: "btnH1",
  width: 160,
  items: [
    { kind: "row", label: "btnH1", key: "Ctrl+1", act: { t: "cmd", id: "h1" } },
    { kind: "row", label: "btnH2", key: "Ctrl+2", act: { t: "cmd", id: "h2" } },
    { kind: "row", label: "btnH3", key: "Ctrl+3", act: { t: "cmd", id: "h3" } },
  ],
};

/**
 * 우클릭 메뉴 — 원본 `kCtxItems` 그대로, 같은 순서. Windows 메모장의 구성
 * (실행 취소 / 잘라내기·복사·붙여넣기·삭제 / 모두 선택)에 Inkwell의 형광펜과
 * 알림 예약이 붙은 모양이다.
 *
 * 알림 두 줄은 예약 창(`알림 예약…` — 선택이 있어야 켜진다)과 예약 목록
 * (`예약된 알림` — 예약이 있어야 켜진다)을 연다.
 */
export const EDIT_MENU: Menu = {
  title: "ctxTitle",
  width: 236,
  items: [
    { kind: "row", label: "menuUndo", key: "Ctrl+Z", act: { t: "cmd", id: "undo" } },
    { kind: "sep" },
    { kind: "row", label: "menuCut", key: "Ctrl+X", act: { t: "cmd", id: "cut" } },
    { kind: "row", label: "menuCopy", key: "Ctrl+C", act: { t: "cmd", id: "copy" } },
    { kind: "row", label: "menuPaste", key: "Ctrl+V", act: { t: "cmd", id: "paste" } },
    { kind: "row", label: "menuDelete", key: "Del", act: { t: "cmd", id: "delete" } },
    { kind: "sep" },
    { kind: "row", label: "menuSelectAll", key: "Ctrl+A", act: { t: "cmd", id: "selectAll" } },
    { kind: "sep" },
    { kind: "row", label: "menuHighlight", key: "Ctrl+Shift+H", act: { t: "cmd", id: "highlight" } },
    { kind: "row", label: "menuHighlightOff", act: { t: "cmd", id: "highlightOff" } },
    { kind: "sep" },
    { kind: "row", label: "menuSetReminder", key: "Ctrl+Shift+R", act: { t: "cmd", id: "remind" } },
    { kind: "row", label: "menuReminderList", act: { t: "cmd", id: "remindList" } },
  ],
};

/**
 * 우클릭 메뉴 — 커서가 **표 안**이면 `표 삭제` 한 줄이 더 붙는다(사용자 보고:
 * "표 삭제가 안 돼"). 표 밖에서는 `EDIT_MENU` 그대로라 메모장 구성이 그대로다.
 * 자리는 `삭제` 바로 아래 — 지우는 것끼리 모아 둔다.
 */
export function editMenu(inTable: boolean): Menu {
  if (!inTable) return EDIT_MENU;
  const items: MenuItem[] = [];
  for (const item of EDIT_MENU.items) {
    items.push(item);
    if (item.kind === "row" && item.label === "menuDelete") {
      items.push({ kind: "row", label: "menuDeleteTable", act: { t: "cmd", id: "deleteTable" } });
    }
  }
  return { ...EDIT_MENU, items };
}

/**
 * 형광펜 — 원본 색 팝업의 다섯 색과 지우기.
 * 색을 고르면 그 색이 저장되고(원본의 `HighlightColor` 레지스트리 값과 같은 자리)
 * **바로 칠한다**: 선택이 있으면 그 범위에, 없으면 펜 모드를 켜고 끈다
 * (원본 `HighlightCommand`: `if (!HighlightSelection(...)) SetPenMode(!penMode)`).
 */
export const PEN_MENU: Menu = {
  title: "hlPickTitle",
  width: 212,
  items: [
    { kind: "heading", label: "hlPickTitle", key: "Ctrl+Shift+H" },
    { kind: "row", label: "hlYellow", act: { t: "highlight", value: 0 } },
    { kind: "row", label: "hlGreen", act: { t: "highlight", value: 1 } },
    { kind: "row", label: "hlPink", act: { t: "highlight", value: 2 } },
    { kind: "row", label: "hlBlue", act: { t: "highlight", value: 3 } },
    { kind: "row", label: "hlOrange", act: { t: "highlight", value: 4 } },
    { kind: "sep" },
    { kind: "row", label: "hlRemove", act: { t: "cmd", id: "highlightOff" } },
  ],
};

// ---------------------------------------------------------------------------
// 탭 목록 — 승인된 시안 T1 (사용자 결정 2026-11-10)
// ---------------------------------------------------------------------------

/** 탭 목록이 한 줄을 그리는 데 필요한 것 전부. `TitleBar`가 `Tab`에서 뽑아 준다. */
export interface TabRow {
  id: number;
  /** 보이는 이름(`tabs.tabLabel`) — `제목 없음`도 여기서 이미 풀려 있다. */
  label: string;
  tint: Tint;
  dirty: boolean;
}

/** 탭 목록 팝업의 폭 — 기존 팝업(우클릭 메뉴)과 같은 236. */
export const TAB_LIST_WIDTH = 236;
/** 구르지 않고 보여 주는 최대 줄 수. 넘으면 이 높이까지만 쓰고 **구른다**(시안 G1 방식). */
export const TAB_LIST_MAX_ROWS = 10;

/**
 * 「N ▾」가 여는 탭 목록 (시안 T1). **보이는 탭 전부**가 순서대로 들어가고 — 숨은
 * 탭(`Tab.hidden`)은 `App`의 `shownTabs`가 이미 걸러 두었다 — 지금 탭에 ✓가 선다.
 *
 * 전체가 구르는 칸이다(`scrollFrom: 0`): 맨 위에 고정해 둘 줄이 없고, 줄이 적으면
 * `menuHeight`가 내용 높이만 세므로 짧은 목록에서 빈 자리가 남지 않는다.
 */
export function tabListMenu(tabs: readonly TabRow[], activeId: number): Menu {
  return {
    title: "tabListTitle",
    width: TAB_LIST_WIDTH,
    scrollFrom: 0,
    scrollH: TAB_LIST_MAX_ROWS * ROW_H,
    items: tabs.map((tab) => ({
      kind: "tab",
      id: tab.id,
      text: tab.label,
      color: tab.tint === "none" ? "" : TINT_DOTS[tab.tint],
      dirty: tab.dirty,
      active: tab.id === activeId,
    })),
  };
}

// ---------------------------------------------------------------------------
// 행의 상태 — 체크/라디오 표시, 색 네모, 비활성
// ---------------------------------------------------------------------------

/** 메뉴를 그릴 때 필요한 현재 상태 전부. `App`이 한 덩어리로 넘긴다. */
export interface MenuState {
  overlay: boolean;
  /**
   * 테이프가 켜진 모양인가 = 고정 중(`pinned || overlay`). 고정 중에는 **찾기·바꾸기
   * 행이 꺼진다**(지시 2) — 그때는 찾기 카드가 그려지지 않으므로 눌러도 열 자리가 없다.
   */
  tapeOn: boolean;
  statusBar: boolean;
  textBacking: boolean;
  noteList: boolean;
  theme: ThemeChoice;
  tint: Tint;
  /** 본문 배율(%) — ☰ › 보기의 `확대/축소` 한 줄이 보여 주는 값(`lib/zoom.ts`). */
  zoom: number;
  /** 시작할 때 이전 세션을 열지 버릴지(§5 · 시안 S의 `시작` 그룹). */
  startup: StartupMode;
  /** 본문 글꼴(`""` = 기본) · 글자 크기(pt) — 시안 G1의 `글꼴` 카드. */
  fontFamily: string;
  fontSize: number;
  highlight: number;
  /** 시스템 메뉴의 비활성 규칙에 쓰인다 (원본 `SysMenuItemEnabled`). */
  maximized: boolean;
  minimized: boolean;
  /** 편집기가 말해 주는 값 — 우클릭 메뉴의 활성 규칙(원본 `MoreItemEnabled`). */
  edit: EditMenuState;
}

/** 우클릭 메뉴의 행 하나하나를 켜고 끄는 데 필요한 것 전부. */
export interface EditMenuState {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  hasText: boolean;
  /** 서식 명령을 쓸 수 있는가 — 일반 텍스트 탭에서는 false(사용자 결정 3). */
  canFormat: boolean;
  /** 예약된 알림 개수. 0이면 `예약된 알림` 행이 꺼진다(원본과 같다). */
  remindCount: number;
}

export type Mark =
  | { kind: "check"; on: boolean }
  | { kind: "radio"; on: boolean }
  | { kind: "swatch"; on: boolean; color: string }
  | null;

/**
 * 이 행이 들고 있는 표시. 원본의 `MoreItemHasMark` / `DrawMoreMark`와 같은 구분:
 * 켜고 끄기는 체크, 셋 중 하나 고르기는 라디오, 색이 있는 것은 색 네모.
 */
export function itemMark(act: Action, state: MenuState): Mark {
  switch (act.t) {
    case "toggle":
      return { kind: "check", on: state[act.id] };
    case "theme":
      return { kind: "radio", on: state.theme === act.value };
    case "startup":
      return { kind: "radio", on: state.startup === act.value };
    case "font":
      return { kind: "radio", on: state.fontFamily === act.value };
    case "fontSize":
      return { kind: "radio", on: state.fontSize === act.value };
    case "tint":
      // `색 없음`은 색 값이 없다 — 빈 동그라미(`remind-dot[data-none]`와 같은 규칙).
      return {
        kind: "swatch",
        on: state.tint === act.value,
        color: act.value === "none" ? "" : TINT_DOTS[act.value],
      };
    case "highlight":
      return { kind: "swatch", on: state.highlight === act.value, color: HIGHLIGHTS[act.value] };
    default:
      return null;
  }
}

/**
 * 행이 활성인가. 원본 `MoreItemEnabled`와 같은 구분:
 * 시스템 메뉴는 창 상태로, 편집 명령은 선택·실행취소·클립보드 상태로 정한다.
 */
export function itemEnabled(act: Action, state: MenuState): boolean {
  if (act.t === "cmd") {
    const e = state.edit;
    switch (act.id) {
      // 고정(테이프)·오버레이 중에는 찾기가 없다(지시 2). `App`의 `openFind`도 같은
      // 규칙으로 막으므로 메뉴를 어떻게 열어도 아무 일도 일어나지 않는다.
      case "find":
      case "replace":
        return !state.tapeOn;
      // 잘라내기·복사·삭제와 형광펜 두 줄, 알림 예약은 모두 **선택**에 작용한다.
      case "cut":
      case "copy":
      case "delete":
      case "remind":
        return e.hasSelection;
      case "highlight":
      case "highlightOff":
        return e.hasSelection && e.canFormat;
      case "undo":
        return e.canUndo;
      case "redo":
        return e.canRedo;
      // `붙여넣기`는 **언제나 켜져 있다**: 클립보드를 미리 들여다보려면 WebView2의
      // 권한 창이 뜨고(사용자 보고 1), 될 수도 있는 명령을 미리 끄지 않는다는 이
      // 파일의 원칙에도 어긋난다. 비어 있으면 눌러도 아무 일도 일어나지 않는다.
      case "selectAll":
        return e.hasText;
      case "remindList":
        return e.remindCount > 0;
      case "bold":
      case "h1":
      case "h2":
      case "h3":
      case "table":
        return e.canFormat;
      default:
        return true;
    }
  }
  if (act.t === "highlight") return state.edit.canFormat;
  if (act.t !== "sys") return true;
  switch (act.id) {
    case "restore":
      return state.maximized || state.minimized;
    case "move":
    case "size":
      return !state.maximized && !state.minimized;
    case "minimize":
      return !state.minimized;
    case "maximize":
      return !state.maximized;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// 크기 — 행 높이가 전부 고정이라 팝업 높이를 정확히 셀 수 있다.
// 화면 밖으로 넘지 않게 자리를 잡을 때 추측이 필요 없다는 뜻이다.
// 시안 Popups: 팝업 패딩 5 + 테두리 1, 행 30, 머리 22, 구분선 1 + 위아래 여백 4.
// ---------------------------------------------------------------------------
export const POPUP_PAD = 5;
export const POPUP_BORDER = 1;
export const ROW_H = 30;
export const HEADING_H = 22;
export const SEP_H = 9;

// 간략 메뉴(시안 C2) — 줄 26, 구분선 1 + 여백 3·3, 머리 20.
export const ROW_C = 26;
export const HEADING_C = 20;
export const SEP_C = 7;

// 덩어리(시안 C2의 `테마`): 작은 라벨 16 + 아래 여백 5, 세그먼트 22 + 패딩 2·2 +
// 테두리 1·1 = 28, 색 점 20. 덩어리 사이는 9.
export const GROUP_LABEL_H = 21;
export const SEG_H = 28;
export const DOTS_H = 20;
export const GROUP_GAP = 9;

function isGroup(item: MenuItem | undefined): boolean {
  return item?.kind === "segment" || item?.kind === "dots";
}

export function itemHeight(item: MenuItem, compact = false): number {
  switch (item.kind) {
    case "sep":
      return compact ? SEP_C : SEP_H;
    case "heading":
      return compact ? HEADING_C : HEADING_H;
    case "segment":
      return GROUP_LABEL_H + SEG_H;
    case "dots":
      return GROUP_LABEL_H + DOTS_H;
    default:
      return compact ? ROW_C : ROW_H;
  }
}

/**
 * 항목 하나가 차지하는 높이 — 덩어리가 덩어리 뒤에 오면 사이 여백(9)까지 센다
 * (CSS의 `.popup-group + .popup-group { margin-top: 9px }`와 같은 값).
 */
function itemBox(menu: Menu, i: number): number {
  const item = menu.items[i];
  if (!item) return 0;
  const gap = i > 0 && isGroup(item) && isGroup(menu.items[i - 1]) ? GROUP_GAP : 0;
  return itemHeight(item, menu.compact) + gap;
}

/** 항목 i의 위쪽 offset(팝업 안 좌표) — 하위 메뉴를 그 줄 높이에 맞춰 열기 위해. */
export function itemOffset(menu: Menu, index: number): number {
  let y = (menu.pad ?? POPUP_PAD) + POPUP_BORDER;
  for (let i = 0; i < index; i += 1) y += itemBox(menu, i);
  // 자기 앞에 붙는 덩어리 사이 여백은 `itemBox`가 **그 항목 쪽에** 달아 두었으므로
  // 여기서 한 번 더 더해야 윗변이 맞는다.
  if (index > 0 && isGroup(menu.items[index]) && isGroup(menu.items[index - 1])) y += GROUP_GAP;
  return y;
}

/**
 * 팝업 높이. `scrollFrom`이 있으면 그 뒤의 행들은 **구르는 칸의 높이까지만** 센다
 * (글꼴 목록이 수백 줄이어도 팝업은 화면에 들어온다 — 시안 G1).
 */
export function menuHeight(menu: Menu): number {
  const from = menu.scrollFrom ?? menu.items.length;
  let fixed = 0;
  let scroll = 0;
  menu.items.forEach((_item, i) => {
    if (i < from) fixed += itemBox(menu, i);
    else scroll += itemBox(menu, i);
  });
  const rolled = menu.scrollH === undefined ? scroll : Math.min(scroll, menu.scrollH);
  return 2 * ((menu.pad ?? POPUP_PAD) + POPUP_BORDER) + fixed + rolled;
}
