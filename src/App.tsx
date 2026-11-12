import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

import Dialog, { type DialogSpec } from "./components/Dialog";
import Editor from "./components/Editor";
import Tape from "./components/Tape";
import FindBar, { EMPTY_FIND, type FindState } from "./components/FindBar";
import NoteList from "./components/NoteList";
import Popup, {
  anchorAt,
  anchorOf,
  caretAnchor,
  placeMenu,
  type Anchor,
  type Placement,
  type Position,
} from "./components/Popup";
import RemindList from "./components/RemindList";
import RemindPick from "./components/RemindPick";
import ResizeEdges from "./components/ResizeEdges";
import Settings from "./components/Settings";
import StatusText, { type DocStats } from "./components/StatusText";
import TableGrid from "./components/TableGrid";
import TitleBar from "./components/TitleBar";
import ToolDock from "./components/ToolDock";
import {
  discardReminderToConfirm,
  loneDirtyTab,
  needsShutdownPrompt,
  tabsToPrompt,
  windowCloseMode,
  type WindowCloseTrigger,
} from "./lib/closing";
import type { CommandTable } from "./lib/commands";
import { isDockMenuKey, statusCollides, type FitRect } from "./lib/dockFit";
import type {
  ChangeReason,
  EditorQuery,
  SearchHit,
  SearchQuery,
  TabDoc,
  TopAnchor,
} from "./lib/editor/DocHost";
import type { HistoryJSON } from "./lib/editor/history";
import { formatOfFile, formatOfName } from "./lib/editor/mode";
import { dropHost, hostOf, peekHost, replaceHost } from "./lib/editor/registry";
import { hitAt, stepIndex } from "./lib/editor/search";
import {
  leafOf,
  pickOpenPath,
  pickSavePath,
  readTextFile,
  writeTextFile,
} from "./lib/file";
import { setSystemLang, t, tf, type Lang } from "./lib/i18n";
import { applyDisplayMode, textBackingWanted } from "./lib/displayMode";
import { docFontCss, docSizePx, monoFontCss } from "./lib/fonts";
import {
  editMenu,
  rootMenu,
  SYSTEM_MENU,
  type Action,
  type EditMenuState,
  type Menu,
  type MenuState,
} from "./lib/menus";
import { sendHitRects, setOverlay as setOverlayNative } from "./lib/overlayHitRects";
import {
  addReminder,
  cancelReminder,
  findFlattened,
  flattenText,
  noSelectionText,
  onlyHiddenLeft,
  previewToast,
  reconcileReminderTabs,
  reminderDiscardDetail,
  reminderState as fetchReminderState,
  reminderStatusText,
  REMINDERS_EVENT,
  REMINDER_REVEAL_EVENT,
  takeReveal,
  type Reminder,
  type ReminderRequest,
  type ReminderState,
  type RevealRequest,
} from "./lib/reminders";
import {
  ACTIVATE_TAB_EVENT,
  activateTab,
  NOTES_EVENT,
  otherNotes,
  putTabs,
  RECENT_EVENT,
  recentAdd,
  recentList,
  recentRemove,
  recentRows,
  summaryOf,
  type OtherNote,
  type WindowNotes,
} from "./lib/noteList";
import { HIGHLIGHTS, OPACITY_MAX, TINT_DOTS } from "./lib/palette";
import {
  adoptWindows,
  clampRect,
  clearSession,
  forgetWindow,
  freezeWindow,
  loadBuffer,
  loadSession,
  OPEN_FILES_EVENT,
  parseHistory,
  putWindow,
  SESSION_ENDING_ASK_EVENT,
  SESSION_ENDING_EVENT,
  sessionCounts,
  sessionEnding,
  sessionEndingAnswered,
  sessionEndingFlushed,
  setShutdownPrompt,
  splitSession,
  takeCliFiles,
  type MonitorBox,
  type SessionWindow,
  type WindowSnapshot,
  type WinRect,
} from "./lib/session";
import * as store from "./lib/settings";
import {
  activeAfterClose,
  activeTab as findTab,
  createTab,
  moveTab,
  newTabUid,
  shownTabs,
  stepTab,
  suggestedSaveName,
  tabLabel,
  type Tab,
} from "./lib/tabs";
import { listMode } from "./lib/tabStrip";
import { dropTargetAt, newWindowRect, type DropTarget, type DropZone } from "./lib/tearoff";
import {
  applyTint,
  chooseTheme,
  cycleTheme,
  paletteName,
  type ThemeChoice,
  type Tint,
} from "./lib/theme";
import { freezeTab, thawTab } from "./lib/transfer";
import {
  closeAllWindows,
  CLOSE_REQUEST_EVENT,
  dragBegin,
  dragEnd,
  DRAG_MOVE_EVENT,
  DROP_MARK_EVENT,
  dropZones,
  markDrop,
  publishDropZone,
  SETTINGS_EVENT,
  TAB_ARRIVE_EVENT,
  tabTransfer,
  windowBoot,
  windowCreate,
  windowFocus,
  type BootInfo,
  type GhostPaint,
} from "./lib/winmgr";
import { isReloadKey, isTimeDateKey, timeDateStamp } from "./lib/timestamp";
import {
  clampZoom,
  matchZoomKey,
  zoomScale,
  zoomStep,
  ZOOM_DEFAULT,
  type ZoomKey,
} from "./lib/zoom";
import type { TearInfo } from "./components/useTabDrag";

/*
 * 메모 목록의 단계 판정은 `lib/tabStrip.ts`의 `listMode`에 있다(`LIST_FULL_MIN_WIDTH`
 * = 480). 창이 그보다 좁으면 목록을 **숨기지 않고 색 점 막대로 접는다**(사용자 보고 2):
 * 켜 둔 목록은 어떤 폭에서도 사라지지 않는다. 켜고 끄기는 **토글 하나**다(사용자 보고 4):
 * 위 줄 목록 버튼 · ☰ › 보기 › 메모 목록 · 목록(막대 포함) 머리 버튼이 모두 `noteList`를
 * 켜고 끄고, 모양은 창 폭만 정한다 — 좁은 창에서 막대를 펼치는 단계는 없다.
 */

/**
 * 파일을 막 열었거나 저장한 탭의 편집기 상태 — 실행취소 스택은 비어 있다(원본 규칙).
 *
 * **상수가 아니라 함수다**: `EditHistory.fromJSON`은 받은 배열을 그대로 들고 쓰므로
 * 객체 하나를 돌려 쓰면 탭 여러 개가 **같은 실행취소 스택을 공유한다**. 세션 복원은
 * 한 번에 탭 여러 개를 만드는 첫 자리라 여기서 드러났다.
 */
const EMPTY_HISTORY = (): HistoryJSON => ({ done: [], undone: [], savedId: null, seq: 0 });

/**
 * 같은 파일인가. Windows의 파일 이름은 대소문자를 구별하지 않고 구분자가 둘이라
 * 둘 다 맞춘 뒤 비교한다(심볼릭 링크까지 같다고 보지는 않는다 — 메모장도 그렇다).
 */
function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\//g, "\\").toLowerCase();
  return norm(a) === norm(b);
}

const EMPTY_QUERY: EditorQuery = {
  bold: false,
  strike: false,
  heading: 0,
  bullet: false,
  highlight: null,
  inTable: false,
  hasSelection: false,
  hasText: false,
  canUndo: false,
  canRedo: false,
  canFormat: true,
};

/**
 * D1(저장 확인)이 끝난 결과. `cancel`이 아니면 닫아도 된다.
 *
 *   kept       깨끗한 탭이라 묻지 않았다.
 *   saved      저장했다(그 탭은 파일로 남는다).
 *   discarded  `저장 안 함` — 그 탭의 글을 **버린다**(세션에도 남지 않아야 한다).
 *   cancel     닫기를 그만둔다(`다른 이름으로 저장`을 취소한 경우도 여기다).
 */
type DiscardOutcome = "kept" | "saved" | "discarded" | "cancel";

export default function App() {
  // --- 저장되는 값 (settings.json) ---
  const [loaded, setLoaded] = useState(false);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(store.DEFAULTS.theme);
  const [statusBar, setStatusBar] = useState(store.DEFAULTS.statusBar);
  const [textBacking, setTextBacking] = useState(store.DEFAULTS.textBacking);
  const [highlight, setHighlight] = useState(store.DEFAULTS.highlight);
  const [noteList, setNoteList] = useState(store.DEFAULTS.noteList);
  const [trayNoticeShown, setTrayNoticeShown] = useState(store.DEFAULTS.trayNoticeShown);
  const [startup, setStartup] = useState<store.StartupMode>(store.DEFAULTS.startup);
  /**
   * 본문 글꼴과 글자 크기 — 시안 **G1**(설정 › 모양 › `글꼴`). 사용자 결정 2026-11-09:
   * **전역 값**(테마와 같은 부류 — 모든 창·모든 탭)이고, 창별 확대/축소(`--zoom`)는 그
   * 위에 곱해진다. `""`는 `기본`이다(지금 모습 그대로).
   */
  const [fontFamily, setFontFamily] = useState(store.DEFAULTS.fontFamily);
  const [fontSize, setFontSize] = useState(store.DEFAULTS.fontSize);
  /**
   * 저장되는 메모지 색 = **새 탭과 첫 실행이 물려받는 기본값**(원본 레지스트리 `MemoTint`의
   * 뜻 그대로). 활성 탭의 색을 그대로 저장하지 않는 이유는 다중 창이다: 창마다 활성 탭의
   * 색이 다른데 그것을 설정에 쓰면 창들이 서로의 값을 끝없이 되덮는다. 사용자가 색을
   * **고를 때만** 바뀐다(§5: 메모지 색은 탭의 성질이라 창 사이에 번지지 않는다).
   */
  const [defaultTint, setDefaultTint] = useState<Tint>(store.DEFAULTS.tint);

  // --- 저장되지 않는 값 ---
  // 불투명도는 원본도 저장하지 않는다(USAGE.ko.md: 다음 실행에서 다시 100%).
  const [opacity, setOpacity] = useState(OPACITY_MAX);
  const [overlay, setOverlay] = useState(false);
  /**
   * 테이프(항상 위) — 시안 `Pin.dc.html`. **창마다**의 성질이라 세션에 저장·복원한다.
   * 켜면 항상 위 + 테이프 말고 모든 UI를 숨긴다. 오버레이는 이것을 **강제**한다
   * (사용자 결정) — 그래서 "테이프가 켜진 모양"은 `pinned || overlay`이고, 오버레이를
   * 끄면 `pinned`에 남아 있던 **오버레이 전 값**으로 저절로 돌아온다.
   */
  const [pinned, setPinned] = useState(false);
  /**
   * 본문 글자 크기(%) — **창 하나의 성질**이다(`lib/zoom.ts`): 그 창의 모든 탭이 같은
   * 배율을 쓰고 다른 창에는 번지지 않는다(오버레이·테이프와 같은 부류라 세션의 창
   * 기록에 저장·복원한다). 메모장도 창마다 따로 기억한다.
   */
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [hover, setHover] = useState(false);
  const [overlayHover, setOverlayHover] = useState(false);
  const [dockFocus, setDockFocus] = useState(false);
  const [osDark, setOsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [winWidth, setWinWidth] = useState(() => window.innerWidth);
  const [openMenu, setOpenMenu] = useState<{ menu: Menu; position: Position } | null>(null);
  const [opacityOpen, setOpacityOpen] = useState(false);
  /** 도구 줄의 `⋯` 팝오버(시안 N2b) — 열려 있으면 도구 줄이 사라지지 않는다. */
  const [moreOpen, setMoreOpen] = useState(false);
  /**
   * 상태 글자가 떠 있는 도구 줄과 겹치는가 — 측정해서 정한다(사용자 보고 3).
   * 판단은 `lib/dockFit.ts`의 `statusCollides`가 하고, 겹치면 글자가 `visibility`로
   * 숨는다(자리는 남는다 — 지우면 되풀이가 생긴다).
   */
  const [statusCollide, setStatusCollide] = useState(false);
  /** ☰ 버튼 — `F10`이 이 버튼에 대고 메뉴를 연다. */
  const dockMenuRef = useRef<HTMLButtonElement | null>(null);
  const [tableAnchor, setTableAnchor] = useState<Anchor | null>(null);
  /**
   * 알림 예약 창(시안 Reminder — 휠 피커). 열 때 **그 순간의 선택**을 그대로 담아 둔다:
   * 사용자가 창 안에서 시각을 고르는 동안 문서가 바뀌어도 예약은 처음 고른 글에 걸린다
   * (원본도 `ReminderAdd`에 값을 넘겨 두고 나중에 다시 묻지 않는다).
   */
  const [remindPick, setRemindPick] = useState<{ anchor: Anchor; req: ReminderRequest } | null>(
    null
  );
  /** 예약 목록 팝업 — 떠 있는 자리만 들고 있고, 내용은 `reminders.pending`이다. */
  const [remindList, setRemindList] = useState<{ anchor: Anchor; placement: Placement } | null>(
    null
  );
  /**
   * 설정 화면(시안 S)이 열려 있는가 — **창이 아니라 이 창 안의 모달 카드**다
   * (`components/Settings.tsx`의 주석에 이유). 창마다 따로 열리고, 값은
   * `settings.json` 한 곳을 지나 모든 창에 번진다.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);

  // --- 편집기가 알려 주는 값 ---
  // 인코딩·줄바꿈·큰 파일 안내는 **탭**의 값이라 여기 없고, 그릴 때 합친다.
  const [stats, setStats] = useState<Omit<DocStats, "enc" | "eol" | "bigMd">>({
    line: 1,
    col: 1,
    chars: 0,
    format: "markdown",
  });
  const [query, setQuery] = useState<EditorQuery>(EMPTY_QUERY);
  /** 문서가 바뀔 때마다 1 오른다 — 찾기 결과를 다시 세는 시점(원본 `OnDocumentChangedForFind`). */
  const [docVersion, setDocVersion] = useState(0);
  /** 형광펜 펜 모드. 문서가 아니라 UI 상태다(§7). 원본도 저장하지 않는다. */
  const [penOn, setPenOn] = useState(false);

  // --- 찾기/바꾸기 (시안 F2) ---
  const [find, setFind] = useState<FindState>(EMPTY_FIND);
  /** 바뀌면 찾기 칸이 초점을 받는다(`Ctrl+F`를 다시 눌렀을 때). */
  const [findFocus, setFindFocus] = useState(0);
  /** 일치 목록. **`null`은 정규식 오류**다(원본 `g_find.error`). */
  const [hits, setHits] = useState<SearchHit[] | null>([]);
  const [hitIndex, setHitIndex] = useState(-1);
  /** `3개 바꿈` 같은 한 번짜리 알림(원본 `g_find.message`). */
  const [findMessage, setFindMessage] = useState("");

  // --- 대화상자 (시안 D1) — 지금은 파일 오류 카드만 ---
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  // --- 탭 (알약 탭과 메모 목록이 같이 보는 하나의 목록) ---
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab("none")]);
  const [activeId, setActiveId] = useState<number>(() => tabs[0]?.id ?? 0);
  /** 세션을 읽고 복원한 뒤에만 세션을 **쓴다**(복원 중의 반쪽 상태를 저장하지 않게). */
  const [sessionReady, setSessionReady] = useState(false);

  // --- 모든 창 공통의 메모 목록 (사용자 결정) ---------------------------
  /**
   * **모든 창**의 메모 요약 — 창 목록 순서대로. Rust가 창마다의 요약을 모아 보낸다
   * (`lib/noteList.ts`). 내 창의 것도 들어 있고, 그릴 때 `otherNotes`가 내 것을 뺀다.
   */
  const [allNotes, setAllNotes] = useState<WindowNotes[]>([]);
  /** 최근 연 파일 — **앱 전체 하나**(`%APPDATA%\Inkwell-Tauri\recent.json`). */
  const [recent, setRecent] = useState<string[]>([]);

  // --- 알림 (§4 · §5의 예외) -------------------------------------------
  /**
   * Rust가 알려 주는 알림 상태(대기 목록 + 아직 치우면 안 되는 탭).
   * **`null`이면 아직 못 받았다** — 그때는 숨은 탭을 치우지 않는다(한 번도 묻지 않은
   * 상태로 탭을 버리면 세션에 있던 알림 탭이 시작할 때마다 사라진다).
   */
  const [reminders, setReminders] = useState<ReminderState | null>(null);
  /**
   * `reminder_take_reveal`에 물어봤는가. 거짓인 동안은 **숨은 탭을 치우지도, 빈 탭을
   * 세우지도 않는다**: 카드 클릭으로 막 복원된 창은 되살릴 탭이 무엇인지 아직 모르고,
   * 그 사이에 도착한 `held=[]`를 믿으면 그 탭을 치운다(점검 2026-11-12).
   */
  const [revealChecked, setRevealChecked] = useState(false);

  // --- 다중 창 (§5) ---
  /** 이 창이 무엇인가 — Rust `window_boot`이 대답한다. `null`이면 아직 묻는 중. */
  const [boot, setBoot] = useState<BootInfo | null>(null);
  /** 떼어내기를 `App`이 몰고 가는 중인가(알약 줄은 순서 바꾸기를 멈춘다). */
  const [tearing, setTearing] = useState(false);
  /** 끌어온 탭이 내 탭 줄의 어디에 들어가는가. `null`이면 표시하지 않는다. */
  const [dropAt, setDropAt] = useState<number | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  /** 알약 줄(또는 메모 목록 항목) 요소 — 놓을 자리를 재는 기준. */
  const zoneRef = useRef<HTMLDivElement>(null);

  // --- 비동기 흐름(저장 확인 → 저장 대화상자 → 창 닫기)이 보는 '지금 값' ---
  // 대화상자를 기다리는 사이에 렌더가 몇 번이고 돌므로 클로저에 잡힌 값은 낡는다.
  // 닫기 규칙은 "낡은 목록으로 창을 닫았다"가 곧 글을 잃는 것이라 여기만 ref를 쓴다.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const startupRef = useRef(startup);
  startupRef.current = startup;
  /** Windows 세션이 끝나는 중인가(종료·로그오프) — 닫기 판정이 묻지 않게 하는 깃발. */
  const endingRef = useRef(false);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  /** 설정 모달이 열려 있는지 — 단축키 핸들러가 매번 다시 붙지 않게 ref로 본다. */
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  /**
   * 대화상자(시안 D1)가 떠 있는지 — 설정과 **같은 이유**로 ref다.
   *
   * 대화상자도 모달이다: 떠 있는 동안 앱 단축키는 쉰다(Windows 11 메모장과 같다 —
   * `저장하시겠습니까?`가 떠 있을 때 Ctrl+W는 듣지 않는다). `Dialog`는 캡처 단계에서
   * Enter·Esc만 가로채므로 Ctrl+W·Ctrl+Shift+W가 그냥 지나가 `closeTab`이 `askSave`를
   * 다시 불렀고, 그 바람에 기다리던 약속이 영원히 풀리지 않아 `창 닫기`·`모두 저장`이
   * 멈췄다.
   */
  const dialogOpenRef = useRef(dialog !== null);
  dialogOpenRef.current = dialog !== null;
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  /**
   * 확대/축소가 시작될 때 잡아 둔 "읽던 줄"과 그때의 배율. 한 프레임 안에 여러 걸음이
   * 들어와도 기준은 하나여야 한다(`applyZoom`). 되돌린 뒤 `null`로 비운다.
   */
  const zoomAnchorRef = useRef<{ anchor: TopAnchor | null; from: number } | null>(null);
  /**
   * 지금 열려 있는 팝업 — 예약 목록이 **그 메뉴가 있던 자리에** 뜨기 위해 본다.
   * 행을 고른 명령은 `Action` 하나만 받으므로(메뉴와 설정 화면이 같은 길을 쓰는 이유)
   * 눌린 요소가 어디였는지는 이 값으로만 알 수 있다.
   */
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;
  /**
   * 지금 알고 있는 알림 상태 — **대화상자를 기다리는 사이에** 보기 때문에 ref다
   * (닫기 흐름의 `tabsRef`와 같은 이유). 알림이 걸린 탭을 버리기 전 두 번째 확인이
   * 적을 시각·글을 여기서 찾는다.
   */
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;

  /** 이 창을 세션에서 가리키는 이름. 복원하면 저장돼 있던 이름을 물려받는다. */
  const windowIdRef = useRef<string>(newTabUid());
  /**
   * **최대화되지 않았을 때의** 창 사각형(물리 픽셀). 최대화된 창의 사각형을 저장하면
   * 복원 때 최대화를 풀 자리를 잃는다 — 원본도 `rcNormalPosition`만 저장했다.
   */
  const normalRectRef = useRef<WinRect | null>(null);
  /** 이 창의 Tauri 라벨 — 탭을 넘길 때의 주소. `window_boot`이 알려 준다. */
  const labelRef = useRef<string>("main");
  /** 클라이언트 영역 좌상단의 화면 물리 좌표 — 놓을 자리를 화면 좌표로 올릴 때 쓴다. */
  const originRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** 지금 창의 바깥 크기(물리 픽셀) — 떼어낸 새 창이 물려받는 크기. */
  const outerRef = useRef<{ w: number; h: number }>({ w: 840, h: 520 });
  /** 참이면 **떼어낸 탭이 곧 도착한다** — 첫 꾸러미가 시작할 때 만든 빈 탭을 대신한다. */
  const expectArrivalRef = useRef(false);

  const current = findTab(tabs, activeId);
  /**
   * 탭 줄에 보이는 탭만 — 숨은 탭(알림이 걸린 채 닫힌 탭)은 어디에도 안 보인다(§5).
   *
   * **`useMemo`인 이유**: 이 배열은 `TitleBar`·`NoteList`의 효과 의존성으로 들어간다.
   * 렌더마다 새 배열을 만들면 그 효과들이 **렌더마다 다시 돌고**, 그 안에서 재고
   * `setState`를 하므로 React가 "커밋 중에 끼어든 갱신"의 사슬로 세어
   * `Maximum update depth exceeded`를 뱉었다(점검에서 잡은 버그).
   */
  const shown = useMemo(() => shownTabs(tabs), [tabs]);
  const tint = current?.tint ?? "none";
  const format = current?.format ?? "markdown";
  const theme = paletteName(themeChoice, tint, osDark);
  /**
   * 메모 목록의 단계: 꺼짐 / 색 점 막대(좁은 창) / 제 폭 168 목록. 켜 둔 목록은
   * 어떤 폭에서도 사라지지 않는다(사용자 보고 2).
   */
  const listKind = listMode(noteList, winWidth);
  const showNoteList = listKind !== "off";
  /**
   * 목록의 아래 두 묶음 — **다른 창의 메모**와 **최근 파일**(둘 다 순수 변환이고
   * 규칙은 `lib/noteList.ts`에 있다). `boot`이 늦게 와도 `labelRef`는 `main`으로
   * 시작하므로 그 사이에 내 메모가 `다른 창`에 뜨는 일은 없다 — 아직 아무 요약도
   * 받지 못했으면 `allNotes`가 빈 배열이다.
   */
  const myLabel = boot?.label ?? "main";
  /**
   * 이 창이 다른 창에 알리는 요약. 숨긴 탭은 빠진다(§5: 어느 탭 줄에도 안 보인다 —
   * 다른 창의 목록도 탭 줄이다).
   */
  const mySummary = useMemo(
    () => summaryOf(myLabel, shown, findTab(tabs, activeId)?.uid ?? null),
    [myLabel, shown, tabs, activeId]
  );
  const others = useMemo(() => otherNotes(allNotes, myLabel), [allNotes, myLabel]);
  /**
   * `최근 파일`은 **지금 열려 있지 않은 것만**이고, "열려 있다"의 기준에 **내 창은
   * 방금의 내 상태**를 쓴다(Rust를 한 바퀴 돌아온 `allNotes`의 내 몫이 아니라). 그러지
   * 않으면 파일을 막 열었을 때 그 파일이 최근 목록에 한순간 보인다(요약은 디바운스된다).
   */
  const recentShown = useMemo(
    () => recentRows(recent, [mySummary, ...allNotes.filter((w) => w.label !== myLabel)]),
    [recent, allNotes, myLabel, mySummary]
  );
  /** 테이프가 켜진 모양 = 고정 중. 오버레이는 이것을 강제한다(사용자 결정). */
  const tapeOn = pinned || overlay;
  /** 테이프 말고 모든 UI를 숨기는가 — 탭·창 버튼·목록·도구 줄·상태 글자·찾기 카드. */
  const uiHidden = tapeOn;
  /** 단축키 처리기(한 번만 붙는다)가 지금 값을 보려고 쓰는 거울. */
  const uiHiddenRef = useRef(uiHidden);
  uiHiddenRef.current = uiHidden;
  /**
   * 고정 중에도 **고른 투명도 그대로**다(사용자 결정 2026-11-09 — 시안 ②의 "활성이거나
   * 마우스가 올라오면 불투명" 규칙을 없앴다: 고정하는 순간 100%로 돌아가 보였다).
   */
  const effOpacity = opacity;
  const backing = textBackingWanted({ overlay, opacity: effOpacity, textBacking });
  const dockVisible =
    hover || overlayHover || openMenu !== null || opacityOpen || moreOpen || dockFocus;
  const penColor = HIGHLIGHTS[highlight] ?? HIGHLIGHTS[0];

  /**
   * 지금 탭의 편집기. 탭마다 하나씩 살아 있고(`registry.ts`) 탭을 바꾸면 이 값이
   * 바뀌므로 `Editor`가 그 호스트를 붙인다 — 내용·커서·스크롤·실행취소가 탭마다 따로다.
   */
  const host = useMemo(() => hostOf(activeId, format), [activeId, format]);

  /** 편집기 → 화면. 내용·커서·뷰포트가 바뀔 때마다 불린다. */
  const refresh = useCallback(
    (why: ChangeReason) => {
      const s = host.stats();
      setStats({ line: s.line, col: s.col, chars: s.chars, format: host.kind });
      setQuery(host.query());
      if (why === "doc") setDocVersion((n) => n + 1);
      const dirty = host.isDirty();
      setTabs((old) =>
        old.some((tab) => tab.id === activeId && tab.dirty !== dirty)
          ? old.map((tab) => (tab.id === activeId ? { ...tab, dirty } : tab))
          : old
      );
    },
    [activeId, host]
  );

  // --- 설정 읽기 (한 번) ---
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [settings, sys] = await Promise.all([
        store.load(),
        invoke<string>("system_language").catch(() => "en"),
      ]);
      if (!alive) return;
      setSystemLang(sys === "ko" ? "ko" : ("en" as Lang));
      setThemeChoice(settings.theme);
      setStatusBar(settings.statusBar);
      setTextBacking(settings.textBacking);
      setHighlight(settings.highlight);
      setNoteList(settings.noteList);
      setTrayNoticeShown(settings.trayNoticeShown);
      setStartup(settings.startup);
      startupRef.current = settings.startup;
      setFontFamily(settings.fontFamily);
      setFontSize(settings.fontSize);
      setDefaultTint(settings.tint);
      setTabs((old) => old.map((tab, i) => (i === 0 ? { ...tab, tint: settings.tint } : tab)));
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- 설정 쓰기 (읽기가 끝난 뒤의 변화만) ---
  useEffect(() => {
    if (!loaded) return;
    store.save({
      theme: themeChoice,
      tint: defaultTint,
      statusBar,
      textBacking,
      highlight,
      noteList,
      trayNoticeShown,
      startup,
      fontFamily,
      fontSize,
    });
  }, [
    loaded,
    themeChoice,
    defaultTint,
    statusBar,
    textBacking,
    highlight,
    noteList,
    trayNoticeShown,
    startup,
    fontFamily,
    fontSize,
  ]);

  // --- 테마를 화면에 ---
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // `시스템`을 실시간으로 따라간다 (원본의 `WM_SETTINGCHANGE` 자리).
  useEffect(() => {
    const query2 = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    query2.addEventListener("change", onChange);
    return () => query2.removeEventListener("change", onChange);
  }, []);

  /**
   * 글꼴·글자 크기를 화면에 — CSS 변수 셋(`lib/fonts.ts`의 주석에 표). `기본`일 때는
   * 변수를 **지운다**: 그러면 `index.css`의 `:root` 값(지금 모습)이 그대로 산다.
   *
   * 아래 `applyDisplayMode` 효과보다 **먼저** 와야 한다 — 그쪽이 받침 띠(`.backing`)의
   * 세로 여유를 **실제 글꼴을 재서** 정하므로 변수가 이미 심겨 있어야 맞게 잰다.
   */
  useEffect(() => {
    const root = document.documentElement.style;
    if (fontFamily === "") {
      root.removeProperty("--doc-font");
      root.removeProperty("--mono-font");
    } else {
      root.setProperty("--doc-font", docFontCss(fontFamily));
      root.setProperty("--mono-font", monoFontCss(fontFamily));
    }
    root.setProperty("--doc-size", `${docSizePx(fontSize)}px`);
  }, [fontFamily, fontSize]);

  // 글꼴이 바뀌면 받침 띠를 **다시 재야 한다**(`displayMode.ts`의 `markBleedEm`이 글꼴
  // 상자를 재서 `--backing-bleed`를 만든다 — 글꼴마다 값이 다르다). 그래서 `fontFamily`가
  // 여기 의존성에 들어 있다.
  useEffect(() => {
    applyDisplayMode({ overlay, opacity: effOpacity, theme, textBacking, highlight });
  }, [overlay, effOpacity, theme, textBacking, highlight, fontFamily]);

  /**
   * 확대/축소를 화면에 — CSS 변수 하나(`--zoom`)다. 본문 글자 크기를 그 변수로 적은
   * 곳이 두 군데뿐이라(`index.css`의 `.editor`, `PlainHost`의 CodeMirror 테마) 창
   * UI는 영향을 받지 않는다. 메모장도 본문만 키운다.
   */
  useEffect(() => {
    document.documentElement.style.setProperty("--zoom", String(zoomScale(zoom)));
  }, [zoom]);

  /**
   * 내 탭 줄을 **화면 물리 좌표**로 올린다(§5의 합치기). 모든 창이 올려 두면 떼어내기
   * 중인 창이 `window_drop_zones`로 한 번에 가져와 "커서가 어느 창의 몇 번째 자리인가"를
   * 판정한다(`lib/tearoff.ts`). 좌표계는 Rust가 읽는 커서와 같은 **물리 픽셀**이라
   * 모니터마다 DPI가 달라도 보정이 따로 필요 없다(`overlay.rs`와 같은 선택).
   *
   * 렌더마다 갱신되는 `ref`에 담는 이유: 창 이동·크기 변경에서 불러야 하는데 그 자리는
   * React 상태가 아니라 Tauri 이벤트 핸들러다(상태로 만들면 리사이즈마다 재렌더한다).
   */
  const publishZoneRef = useRef<() => void>(() => undefined);
  publishZoneRef.current = () => {
    const el = zoneRef.current;
    // 고정 중(테이프 켬)에는 탭 줄도 목록도 없다 → **빈 자리**를 올린다. 올리지 않으면
    // 마지막으로 올렸던 사각형이 남아, 다른 창이 그 자리에 탭을 놓을 수 있다.
    if (!el) {
      void publishDropZone({
        label: labelRef.current,
        axis: "x",
        strip: { x: 0, y: 0, w: 0, h: 0 },
        tabs: [],
      });
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const origin = originRef.current;
    const toScreen = (r: DOMRect) => ({
      x: origin.x + r.left * dpr,
      y: origin.y + r.top * dpr,
      w: r.width * dpr,
      h: r.height * dpr,
    });
    const zone: DropZone = {
      label: labelRef.current,
      // 색 점 막대일 때는 알약이 위 줄에 그대로 있으므로 그 줄이 놓을 자리다(가로).
      axis: listKind === "full" ? "y" : "x",
      strip: toScreen(el.getBoundingClientRect()),
      tabs: Array.from(el.querySelectorAll<HTMLElement>('[data-tab="1"]')).map((t) =>
        toScreen(t.getBoundingClientRect())
      ),
    };
    void publishDropZone(zone);
  };

  // --- 창 상태 (최대화·최소화·폭·세션에 저장할 사각형·놓을 자리) ---
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten: UnlistenFn[] = [];
    let publishTimer = 0;
    const schedulePublish = () => {
      window.clearTimeout(publishTimer);
      publishTimer = window.setTimeout(() => publishZoneRef.current(), 120);
    };
    const sync = () => {
      void win.isMaximized().then(setMaximized);
      void win.isMinimized().then(setMinimized);
      setWinWidth(window.innerWidth);
      void (async () => {
        try {
          const inner = await win.innerPosition();
          originRef.current = { x: inner.x, y: inner.y };
          const outer = await win.outerSize();
          outerRef.current = { w: outer.width, h: outer.height };
          // 최대화·최소화가 아닐 때의 사각형만 기억한다(세션에 들어가는 값).
          if ((await win.isMaximized()) || (await win.isMinimized())) return;
          const p = await win.outerPosition();
          normalRectRef.current = { x: p.x, y: p.y, w: outer.width, h: outer.height };
        } catch {
          // 창 기하를 못 읽어도 다른 것은 다 저장된다.
        } finally {
          schedulePublish();
        }
      })();
    };
    sync();
    void win.onResized(sync).then((fn) => unlisten.push(fn));
    void win.onMoved(sync).then((fn) => unlisten.push(fn));
    window.addEventListener("resize", sync);
    return () => {
      window.clearTimeout(publishTimer);
      unlisten.forEach((fn) => fn());
      window.removeEventListener("resize", sync);
    };
  }, []);

  // 탭이 늘거나 줄거나 목록 패널이 열리고 닫히면 놓을 자리가 달라진다.
  // 고정(테이프)을 켜고 끄면 탭 줄 자체가 생기고 사라지므로 그때도 다시 올린다.
  useEffect(() => {
    publishZoneRef.current();
  }, [shown, listKind, uiHidden]);

  // --- 도구 줄에 키보드 초점이 있는지 (있으면 마우스가 밖에 있어도 남는다) ---
  useEffect(() => {
    const onFocusIn = () => {
      const el = document.activeElement;
      setDockFocus(el instanceof Element && el.closest(".dock") !== null);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusIn);
    };
  }, []);

  /**
   * --- 상태 글자 ↔ 도구 줄 겹침 (사용자 보고 3) ---
   *
   * 두 사각형을 **재서** 정한다: 도구 줄의 폭은 메모 목록·N2b 접기·◐ 글자 수에 따라
   * 달라지고 상태 글자의 폭도 인코딩·줄바꿈·배율 조각에 따라 달라져, 창 폭만 보는
   * 고정 경계로는 맞출 수 없다.
   *
   * 되풀이가 생기지 않는 이유: 겹치면 글자가 `visibility: hidden`이 되어 **사각형이
   * 그대로 남는다**(지우면 "안 겹침 → 보임 → 겹침"이 돈다). 측정은 rAF로 한 번만 묶고,
   * 값이 같으면 상태를 바꾸지 않는다.
   */
  useEffect(() => {
    if (uiHidden || !statusBar) {
      setStatusCollide(false);
      return undefined;
    }
    const dock = document.querySelector<HTMLElement>(".dock");
    const status = document.querySelector<HTMLElement>(".status-text");
    if (!dock || !status) return undefined;
    let raf = 0;
    const rectOf = (el: HTMLElement): FitRect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const measure = () => {
      raf = 0;
      const next = statusCollides(rectOf(dock), rectOf(status));
      setStatusCollide((old) => (old === next ? old : next));
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(dock);
    ro.observe(status);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [uiHidden, statusBar, overlay]);

  // --- 탭 ---
  // 새 탭은 현재 탭 색을 물려받는다 (§5).
  // `createTab`은 **갱신 함수 밖에서** 부른다 — StrictMode는 갱신 함수를 두 번
  // 호출하므로 안에서 id를 발급하면 번호가 건너뛴다.
  const newTab = useCallback(() => {
    const tab = createTab(findTab(tabs, activeId)?.tint ?? "none");
    setTabs((old) => [...old, tab]);
    setActiveId(tab.id);
  }, [activeId, tabs]);

  /** 끌어서 순서 바꾸기 — 알약 탭과 메모 목록이 **같은 목록**을 보므로 길이 하나다(§5). */
  const reorderTab = useCallback((id: number, to: number) => {
    setTabs((old) => moveTab(old, id, to));
  }, []);

  // --- 편집기 명령 ---
  const runEditor = useCallback(
    (fn: () => void) => {
      fn();
      refresh("doc");
      host.focus();
    },
    [host, refresh]
  );

  /**
   * 확대/축소 — 본문 글자 크기 한 걸음(`lib/zoom.ts`). **다른 창에 보내지 않는다**:
   * 창 하나의 성질이다(불투명도·오버레이와 같다).
   *
   * **글자 크기만** 바뀌어야 한다(사용자 보고: "확대 축소할 때 글자만 적용되어야
   * 되는데"). 여백(`--edit-pad-*`)은 px이라 그대로이고, 배율이 바뀌면 같은 스크롤
   * 값이 다른 줄을 가리키므로 **맨 위에 보이던 줄을 그 자리에 되돌린다**
   * (`captureTopAnchor`/`restoreTopAnchor` — 메모장과 같다). 전에는 커서로 스크롤해서
   * (`revealCaret`) 커서가 화면 밖이면 글이 통째로 튀었다.
   *
   * 되돌리기는 CSS 변수가 실제로 적용되고 편집기가 다시 재고 난 **다음 프레임**이다.
   * 휠을 빨리 돌리면 한 프레임에 여러 걸음이 들어오므로 기준점은 **첫 걸음 것 하나만**
   * 잡아 두고(`zoomAnchorRef`) 전체 비율로 한 번에 되돌린다.
   */
  const applyZoom = useCallback(
    (what: ZoomKey) => {
      // 지금 값을 **ref에서** 읽고 거기에 바로 써 둔다: 휠을 빨리 돌리면 한 프레임에
      // 여러 번 들어오는데, 그때 상태만 보면 같은 값에서 계속 한 걸음씩 세어 한 걸음만
      // 움직인다(걸음이 먹힌다).
      const now = zoomRef.current;
      const next = what === "reset" ? ZOOM_DEFAULT : zoomStep(now, what === "in" ? 1 : -1);
      if (next === now) return;
      if (zoomAnchorRef.current === null) {
        zoomAnchorRef.current = { anchor: host.captureTopAnchor(), from: now };
      }
      zoomRef.current = next;
      setZoom(next);
      requestAnimationFrame(() => {
        const held = zoomAnchorRef.current;
        zoomAnchorRef.current = null;
        if (held !== null) {
          host.restoreTopAnchor(held.anchor, zoomScale(zoomRef.current) / zoomScale(held.from));
        }
        refresh("viewport");
      });
    },
    [host, refresh]
  );

  /**
   * 글자 크기(설정 › 모양 › 글꼴 › `크기`) — 확대/축소와 **같은 배려**를 한다: 맨 위에
   * 보이던 줄을 그 자리에 둔다(`captureTopAnchor`/`restoreTopAnchor`). 확대/축소와 달리
   * 한 프레임에 여러 번 들어올 수 없으므로(드롭다운에서 한 번 고른다) 기준점을 모아
   * 둘 필요가 없다.
   */
  const applyDocSize = useCallback(
    (pt: number) => {
      const now = fontSizeRef.current;
      if (pt === now) return;
      const anchor = host.captureTopAnchor();
      fontSizeRef.current = pt;
      setFontSize(pt);
      requestAnimationFrame(() => {
        host.restoreTopAnchor(anchor, docSizePx(pt) / docSizePx(now));
        refresh("viewport");
      });
    },
    [host, refresh]
  );

  /**
   * 형광펜 — 원본 `HighlightCommand`와 같다: 선택이 있으면 그 범위에 칠하고(같은 색이면
   * 해제), 선택이 없으면 **펜 모드를 켜고 끈다**.
   */
  const highlightCommand = useCallback(
    (color: string) => {
      runEditor(() => {
        if (!host.exec({ t: "highlight", color })) setPenOn((on) => !on);
      });
    },
    [host, runEditor]
  );

  /**
   * 복사·잘라내기 — 우클릭 메뉴에서 부르면 초점이 팝업에 있어 `execCommand`가 듣지 않으므로
   * 선택된 글자를 클립보드에 직접 쓴다. `Ctrl+C`/`Ctrl+X`는 가로채지 않으므로 브라우저가
   * 평소대로(서식까지) 처리한다.
   */
  const copyCommand = useCallback(
    (andDelete: boolean) => {
      const text = host.selectedText();
      if (text === "") return;
      void navigator.clipboard.writeText(text).catch(() => undefined);
      if (andDelete) runEditor(() => host.exec({ t: "delete" }));
      else host.focus();
    },
    [host, runEditor]
  );

  /**
   * 붙여넣기(우클릭 메뉴) — **클립보드는 Rust가 읽는다**(`clipboard_read_text`).
   *
   * `navigator.clipboard.readText()`를 부르면 WebView2가 "클립보드에 복사된 텍스트 및
   * 이미지 보기 — 차단/이번만/허용" 권한 창을 띄운다. 메모장에는 그런 것이 없고, 처음
   * 우클릭하자마자 그 창이 떠서 메뉴를 가렸다(사용자 보고 1). 쓰기(`writeText`)는
   * 묻지 않으므로 복사·잘라내기는 그대로 둔다.
   *
   * `Ctrl+V`는 여기 오지 않는다 — 가로채지 않으므로 WebView2가 평소대로 처리한다.
   */
  const pasteCommand = useCallback(() => {
    void (async () => {
      let text = "";
      try {
        text = await invoke<string>("clipboard_read_text");
      } catch {
        text = "";
      }
      if (text === "") return;
      runEditor(() => host.exec({ t: "insertText", text }));
    })();
  }, [host, runEditor]);

  // --- 파일 (설계 문서 단계 5) -------------------------------------------
  // 편집기는 파일을 모른다: 여기서 Rust 커맨드로 바이트를 읽어 LF 문자열로 넘기고,
  // 저장할 때는 `DocHost.save()`가 준 문자열을 UTF-8(BOM 없음)로 쓴다.

  /** 오류 카드(시안 D1 아래쪽). 확인 하나뿐이고 Enter·Esc 둘 다 닫는다. */
  const showFileError = useCallback((kind: "dlgCannotRead" | "dlgCannotWrite", path: string) => {
    setDialog({
      message: t(kind),
      detail: path,
      buttons: [
        { label: t("dlgBtnOk"), primary: true, cancel: true, onClick: () => setDialog(null) },
      ],
    });
  }, []);

  /** 그 탭이 "비어 있고 깨끗한 새 문서"인가 — 열기가 그 탭을 다시 쓸 조건(메모장 11). */
  const isBlankTab = useCallback((tab: Tab | undefined): boolean => {
    if (!tab || tab.path !== null || tab.dirty) return false;
    const h = peekHost(tab.id);
    return h === undefined || h.plainText() === "";
  }, []);

  // 파일을 여는 길은 세 군데가 쓴다(열기 대화상자 · 첫 실행의 명령줄 · 이미 돌아가는
  // 인스턴스에 넘어온 파일). 뒤의 둘은 여러 경로를 **차례로 기다리며** 열므로 클로저에
  // 잡힌 탭 목록이 낡는다 — 그러면 두 번째 파일이 첫 번째가 쓴 빈 탭을 또 쓴다.
  // 그래서 여기서는 `tabsRef`/`activeRef`를 읽고 목록은 갱신 함수로만 고친다.
  /**
   * 파일 하나를 이 창의 탭으로. **성공했으면 `true`** — 최근 파일 줄을 눌렀을 때
   * "없어진 파일이면 목록에서 뺀다"를 판단하는 값이다.
   */
  const openPath = useCallback(
    async (path: string): Promise<boolean> => {
      const tabs = tabsRef.current;
      const activeId = activeRef.current;
      // 이미 열려 있는 같은 파일이면 그 탭으로 전환한다(메모장 11과 같다) — **숨은 탭(알림이 걸린 채
      // 닫힌 탭)이면 되살린다**. 숨은 채로 활성이 되면 탭 줄에 아무것도 없는 창이 된다.
      const already = tabs.find((tb) => tb.path !== null && samePath(tb.path, path));
      if (already) {
        if (already.hidden) {
          // 목록은 **지금의** `tabsRef`에서 만들고 `tabsRef`도 같이 고친다. 이 함수를
          // `await`로 부른 쪽(알림 되살리기 등)이 바로 뒤에서 `tabsRef`를 읽는다 —
          // 갱신을 다음 렌더에 맡기면 그쪽은 낡은 목록을 본다.
          const next = tabsRef.current.map((tb) =>
            tb.id === already.id ? { ...tb, hidden: false } : tb
          );
          tabsRef.current = next;
          setTabs(next);
        }
        setActiveId(already.id);
        activeRef.current = already.id;
        return true;
      }
      let got;
      try {
        got = await readTextFile(path);
      } catch {
        showFileError("dlgCannotRead", path);
        return false;
      }
      const name = leafOf(path);
      // 임계값(1MB)을 넘은 `.md`는 일반 텍스트로 연다 — 저장 바이트는 완전히 보존된다(§11).
      const format = formatOfFile(name, got.bytes);
      const bigMd = format === "plain" && formatOfName(name) === "markdown";

      const cur = findTab(tabs, activeId);
      const reuse = isBlankTab(cur) ? cur : undefined;
      const tab = reuse ?? createTab(cur?.tint ?? "none", name);
      // 파일을 열면 스택을 비우고 커서를 맨 앞으로(원본 규칙). `fileSrc`가 바이트 보존의
      // 기준이 되므로 손대지 않고 저장하면 바이트가 같다(§4-3).
      //
      // 모드가 같으면 **살아 있는 호스트에 `load`** 한다. 호스트를 갈아 끼우면
      // `useMemo`가 다시 돌 이유(`activeId`·`format`)가 없어 화면이 버려진 호스트를
      // 계속 들고 있게 된다 — 모드가 달라질 때만 갈아 끼운다.
      const living = peekHost(tab.id);
      if (living !== undefined && living.kind === format) {
        living.load(got.text);
      } else {
        const doc: TabDoc = {
          format,
          fileSrc: got.text,
          text: got.text,
          selection: null,
          scrollTop: 0,
          history: EMPTY_HISTORY(),
        };
        replaceHost(tab.id, doc);
      }
      const next: Tab = {
        ...tab,
        name,
        path,
        format,
        enc: got.enc,
        eol: got.eol,
        bigMd,
        dirty: false,
      };
      // `await` 뒤라 클로저의 `tabs`는 낡았을 수 있다 — 목록은 **지금의** `tabsRef`에서
      // 만들고, 부른 쪽이 바로 뒤에서 읽을 수 있게 `tabsRef`/`activeRef`도 같이 고친다.
      const old = tabsRef.current;
      const list = reuse ? old.map((tb) => (tb.id === next.id ? next : tb)) : [...old, next];
      tabsRef.current = list;
      setTabs(list);
      setActiveId(next.id);
      activeRef.current = next.id;
      // 최근 파일 — 파일을 **열거나 저장할 때** 맨 앞으로. 중복 제거와 상한은 Rust가
      // 한다(쓰는 곳이 하나여야 창이 여럿일 때 서로 덮어쓰지 않는다).
      void recentAdd(path);
      return true;
    },
    [isBlankTab, showFileError]
  );

  /** 이벤트 리스너가 늘 **지금의** `openPath`를 부르게 하는 자리. */
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  const openCommand = useCallback(() => {
    void (async () => {
      const path = await pickOpenPath();
      if (path === null) return;
      await openPath(path);
    })();
  }, [openPath]);

  /**
   * 저장. 경로가 없거나 `다른 이름으로`면 대화상자를 먼저 연다(원본 `DoSave`).
   * 저장 형식은 **늘 UTF-8(BOM 없음) + LF** — 어떤 인코딩으로 들어온 파일이든
   * 이 순간부터 UTF-8 / LF다(원본 주석: 추측이 아니라 사실의 기술).
   *
   * 탭 하나를 저장한다. **성공했으면 `true`** — 저장 확인(D1)에서 `저장`을 골랐을 때
   * 닫기를 계속할지 정하는 값이라 돌려줘야 한다(대화상자를 취소하면 닫기도 취소된다).
   *
   * 활성 탭이 아니어도 저장할 수 있다: 창을 닫을 때 탭마다 묻는 길과 `모두 저장`이
   * 활성이 아닌 탭을 저장한다. 그래서 `host`(활성 탭의 편집기) 대신 그 탭의 편집기를
   * 레지스트리에서 꺼내 쓴다.
   */
  const saveTab = useCallback(
    async (tabId: number, saveAs: boolean): Promise<boolean> => {
      const tab = findTab(tabsRef.current, tabId);
      if (!tab) return false;
      const host = peekHost(tab.id) ?? hostOf(tab.id, tab.format);
      {
        let path = tab.path;
        if (saveAs || path === null) {
          path = await pickSavePath(suggestedSaveName(tab));
          if (path === null) return false; // 대화상자를 취소하면 저장도 취소된다(원본과 같다).
        }
        const name = leafOf(path);
        const targetFormat = formatOfName(name);
        // `.md`는 마크다운으로 직렬화하고(바이트 보존), 그 밖의 확장자는 **보이는 글자**를
        // 쓴다 — 서식이 버려지는 자리이고 원본 `SaveToPath`와 같은 분기다.
        const text = targetFormat === "markdown" ? host.save() : host.plainText();
        try {
          await writeTextFile(path, text);
        } catch {
          showFileError("dlgCannotWrite", path);
          return false;
        }
        if (targetFormat === host.kind) {
          host.markSaved();
        } else {
          // 확장자를 바꿔 저장해 모드가 달라진 경우. 방금 쓴 글자가 새 문서이고
          // 실행취소 기록은 비워진다(엔진이 달라 스텝을 옮길 수 없다).
          replaceHost(tab.id, {
            format: targetFormat,
            fileSrc: text,
            text,
            selection: null,
            scrollTop: 0,
            history: EMPTY_HISTORY(),
          });
        }
        setTabs((old) =>
          old.map((tb) =>
            tb.id === tab.id
              ? {
                  ...tb,
                  name,
                  path,
                  format: targetFormat,
                  enc: "utf8",
                  eol: "lf",
                  bigMd: false,
                  dirty: false,
                }
              : tb
          )
        );
        void recentAdd(path);
        return true;
      }
    },
    [showFileError]
  );

  const saveCommand = useCallback(
    (saveAs: boolean) => {
      void saveTab(activeRef.current, saveAs);
    },
    [saveTab]
  );

  /**
   * `모두 저장`(Ctrl+Alt+S) — 메모장 11의 파일 메뉴에 있는 그 명령. 미저장 탭을
   * **줄 순서대로** 저장하고, 제목 없는 탭은 그때마다 `다른 이름으로 저장` 대화상자가 뜬다.
   *
   * 대화상자를 취소하면 **거기서 멈춘다**. 메모장이 남은 탭을 계속 묻는지 거기서 그만두는지
   * 확실히 모르므로, 사용자가 방금 "하지 마"라고 말한 뒤에 대화상자를 더 띄우지 않는
   * 쪽을 골랐다(이 판단은 보고에 적었다).
   */
  const saveAllCommand = useCallback(() => {
    void (async () => {
      for (const tab of shownTabs(tabsRef.current)) {
        if (!tab.dirty) continue;
        if (!(await saveTab(tab.id, false))) return;
      }
    })();
  }, [saveTab]);

  // --- 닫기 규칙 (§5) ----------------------------------------------------
  //
  // 메모장 11이 하는 대로다:
  //   * 탭 하나를 닫을 때는 **묻는다**(D1: 저장 / 저장 안 함 / 취소). `저장 안 함`은
  //     정말 버리는 것이라 다음 실행에 돌아오지 않는다.
  //   * 창을 닫을 때는 **묻지 않는다**. 미저장 글을 포함한 전부가 세션에 들어가고
  //     다음 실행에 그대로 돌아온다. 묻는 것은 **세션 저장이 실패했을 때뿐**이다 —
  //     그때만 "조용히"가 "잃는다"는 뜻이 되기 때문이다(원본 주석과 같은 이유).
  //   * 설정이 `새 세션 시작 및 저장되지 않은 변경 내용 삭제`면 창을 닫을 때
  //     미저장 탭마다 묻고 세션을 쓰지 않는다.

  /** D1 저장 확인의 답을 기다리는 자리. 한 번에 하나만 뜬다(원본의 모달 규칙). */
  const answerRef = useRef<((answer: "save" | "discard" | "cancel") => void) | null>(null);

  /** 시안 D1의 확인 카드. 버튼 순서·기본 버튼(저장)·Esc(취소)는 Windows의 것 그대로. */
  const askSave = useCallback(
    (tab: Tab) =>
      new Promise<"save" | "discard" | "cancel">((resolve) => {
        const done = (answer: "save" | "discard" | "cancel") => {
          if (answerRef.current !== done) return;
          answerRef.current = null;
          setDialog(null);
          resolve(answer);
        };
        // 한 번에 하나만 뜨지만(위의 모달 규칙), **그래도** 앞의 질문이 남아 있으면
        // 거기부터 `취소`로 끝낸다. 자리를 조용히 덮어 버리면 앞의 약속이 영원히
        // 풀리지 않아 부르던 쪽(`창 닫기`·`모두 저장`)이 멈춘다.
        // (`done`은 자기가 아직 그 자리에 있을 때만 듣는다 — 그래서 자리를 바꾸기
        // **전에** 부른다. 그쪽이 `setDialog(null)`을 한 뒤 바로 아래에서 새 카드를
        // 올리므로 React가 같은 차례에 한꺼번에 처리한다.)
        answerRef.current?.("cancel");
        answerRef.current = done;
        setDialog({
          title: t("dlgTitleSaveChanges"),
          message: tf("dlgSaveChangesFmt", tabLabel(tab)),
          buttons: [
            { label: t("dlgBtnSave"), primary: true, onClick: () => done("save") },
            { label: t("dlgBtnDontSave"), onClick: () => done("discard") },
            { label: t("dlgBtnCancel"), cancel: true, onClick: () => done("cancel") },
          ],
        });
      }),
    []
  );

  /**
   * 알림이 걸린 탭을 `저장 안 함`으로 버리기 전의 두 번째 확인 — 승인된 시안
   * `DiscardReminder.dc.html`의 ②. **같은 D1 카드**(`Dialog`의 확인 모양)이고 둘째 줄만
   * dim으로 예약 시각과 알림 글을 적는다.
   *
   * 기본(Enter·초기 초점·accent)은 **취소**다 — 실수로 예약을 지우지 않게. Esc도 취소.
   * 참을 돌려주면 "알림도 지우고 닫기"다.
   */
  const askDiscardReminder = useCallback(
    (rem: Reminder | null) =>
      new Promise<boolean>((resolve) => {
        const done = (answer: "save" | "discard" | "cancel") => {
          if (answerRef.current !== done) return;
          answerRef.current = null;
          setDialog(null);
          resolve(answer === "discard");
        };
        // `askSave`와 같은 자리를 쓴다(한 번에 하나만 뜨는 모달 규칙) — 앞의 질문이
        // 남아 있으면 거기부터 `취소`로 끝낸다.
        answerRef.current?.("cancel");
        answerRef.current = done;
        setDialog({
          title: t("dlgTitleDiscardReminder"),
          message: t("dlgDiscardReminder"),
          // 알림을 못 찾았으면(막 울려서 목록에서 빠졌다) 둘째 줄을 적지 않는다 —
          // 틀린 시각을 적는 것보다 비우는 쪽이 낫다.
          detail: rem === null ? undefined : reminderDiscardDetail(rem),
          buttons: [
            { label: t("dlgBtnDiscardReminder"), onClick: () => done("discard") },
            { label: t("dlgBtnCancel"), primary: true, cancel: true, onClick: () => done("cancel") },
          ],
        });
      }),
    []
  );

  /**
   * 그 탭을 버려도 되는가. 원본 `ConfirmDiscard`와 같다: 깨끗하면 바로 참,
   * `취소`는 거짓(부르는 쪽이 닫기를 그만둔다), `저장`은 **저장이 성공해야** 참이다
   * (제목 없는 탭이면 `다른 이름으로 저장` 대화상자가 뜨고, 그것을 취소하면 닫기도 취소).
   *
   * **§5의 예외 — 알림이 걸린 탭.** `저장 안 함`을 골랐는데 그 탭에 예약된 알림이 있으면
   * 한 번 더 묻는다(시안 `DiscardReminder` ②). 거기서 `알림도 지우고 닫기`를 고르면
   * 그 알림을 **취소하고** 탭을 버린다(숨겨 보관하지 않는다 — 사용자가 둘 다 버리기로
   * 답했다). `취소`면 탭도 알림도 그대로 두고 닫기를 그만둔다.
   * 저장한 탭의 알림은 건드리지 않는다 — 파일이 진실이므로 토스트가 그 파일을 열면 된다.
   */
  const confirmDiscardOutcome = useCallback(
    async (tab: Tab): Promise<DiscardOutcome> => {
      if (!tab.dirty) return "kept";
      const answer = await askSave(tab);
      if (answer === "cancel") return "cancel";
      if (answer === "save") return (await saveTab(tab.id, false)) ? "saved" : "cancel";
      const rid = discardReminderToConfirm(tab, answer);
      if (rid === null) return "discarded";
      const rem = remindersRef.current?.pending.find((r) => r.id === rid) ?? null;
      if (!(await askDiscardReminder(rem))) return "cancel";
      await cancelReminder(rid);
      return "discarded";
    },
    [askDiscardReminder, askSave, saveTab]
  );

  /** 위의 답을 `닫아도 되는가` 한 글자로 줄인 것 — 부르는 쪽 대부분은 이것만 쓴다. */
  const confirmDiscard = useCallback(
    async (tab: Tab): Promise<boolean> => (await confirmDiscardOutcome(tab)) !== "cancel",
    [confirmDiscardOutcome]
  );

  /** 지금 창의 상태를 세션 기록으로. 탭 목록은 **부르는 쪽이** 준다(닫는 중일 수 있다). */
  const snapshotWindow = useCallback(async (list: readonly Tab[]): Promise<WindowSnapshot> => {
    const win = getCurrentWindow();
    let maximizedNow = false;
    try {
      maximizedNow = await win.isMaximized();
    } catch {
      maximizedNow = false;
    }
    if (!maximizedNow) {
      try {
        const p = await win.outerPosition();
        const s = await win.outerSize();
        normalRectRef.current = { x: p.x, y: p.y, w: s.width, h: s.height };
      } catch {
        // 못 읽으면 마지막으로 알고 있던 사각형을 쓴다.
      }
    }
    const active = findTab(list, activeRef.current) ?? shownTabs(list)[0] ?? list[0];
    return {
      id: windowIdRef.current,
      rect: normalRectRef.current,
      maximized: maximizedNow,
      overlay: overlayRef.current,
      opacity: opacityRef.current,
      pinned: pinnedRef.current,
      zoom: zoomRef.current,
      activeUid: active?.uid ?? null,
      tabs: list.map((tab) => ({
        uid: tab.uid,
        name: tab.name,
        path: tab.path,
        tint: tab.tint,
        dirty: tab.dirty,
        format: tab.format,
        enc: tab.enc,
        eol: tab.eol,
        bigMd: tab.bigMd,
        hidden: tab.hidden,
        reminder: tab.reminder,
        doc: peekHost(tab.id)?.serialize() ?? null,
      })),
    };
  }, []);

  /**
   * 세션 쓰기 한 번 — **이 창의 기록만** 보낸다. 다른 창의 기록과 모아 인덱스를 쓰는 것은
   * Rust다(`src-tauri/src/session.rs`): 창마다 인덱스를 통째로 쓰면 마지막에 쓴 창만 남는다.
   */
  const writeSession = useCallback(
    async (list: readonly Tab[]) => {
      const snap = await snapshotWindow(list);
      return putWindow(snap);
    },
    [snapshotWindow]
  );

  /**
   * 창을 닫는다 — ✕ · Alt+F4 · Ctrl+Shift+W · 끝내기가 모두 여기로 온다.
   * 이 창이 마지막 창이면 창이 사라지는 것이 곧 앱 종료다(알림 트레이 상주는 알림 단계).
   *
   * `trigger`가 `app`이면 **앱 전체 종료**(트레이 `종료` · ☰ `끝내기`)다 — 창마다
   * 묻지 않는다(메모장과 같다). 창 하나를 닫는 길만 `askLoneTab`을 지난다.
   */
  const closeWindow = useCallback(
    async (list?: readonly Tab[], trigger: WindowCloseTrigger = "window"): Promise<void> => {
      let tabList = list ?? tabsRef.current;
      const win = getCurrentWindow();

      /** 미저장 탭마다 묻는 길. 하나라도 취소하면 닫기 전체를 그만둔다(원본과 같다). */
      const askEveryTab = async (): Promise<boolean> => {
        for (const tab of tabsToPrompt(tabList)) {
          // 그 탭을 앞으로 — 대화상자에 적힌 이름이 화면의 문서와 같아야 한다(원본).
          setActiveId(tab.id);
          if (!(await confirmDiscard(tab))) return false;
        }
        return true;
      };

      // 이 창 말고 세션에 남는 것이 있는가 — 살아 있는 다른 창 + 얼린 창. Rust가 센다
      // (얼린 창 목록이 프론트에 있으면 창마다 한 벌이 되어 창이 닫힐 때 사라진다).
      const counts = await sessionCounts();
      const others = Math.max(0, counts.live - 1) + counts.frozen;
      // Windows 종료·로그오프 중인가. 이벤트가 닿기 전에 닫기 요청이 먼저 올 수 있어
      // 깃발을 Rust에 **직접** 묻는다(`WM_QUERYENDSESSION`이 세워 둔 값).
      const ending = endingRef.current || (await sessionEnding());
      const mode = windowCloseMode({
        startup: startupRef.current,
        totalTabs: tabList.length,
        others,
        trigger,
        loneDirty: loneDirtyTab(tabList) !== null,
        ending,
      });

      if (mode === "askThenDiscard") {
        if (!(await askEveryTab())) return;
        await clearSession();
        await win.destroy();
        return;
      }

      // 보이는 탭이 하나뿐이고 미저장인 창을 **직접** 닫았다(사용자 결정). 탭 하나를
      // 닫을 때와 같은 D1 — 알림이 걸린 탭의 두 번째 확인도 `confirmDiscardOutcome`이
      // 그대로 따라온다. `저장 안 함`이면 그 탭을 목록에서 빼고(= 세션에도 들어가지
      // 않고, Rust의 `gc_buffers`가 그 탭의 `buf_*`를 치운다) 나머지로 다시 판정한다.
      if (mode === "askLoneTab") {
        const lone = loneDirtyTab(tabList);
        if (lone !== null) {
          setActiveId(lone.id);
          activeRef.current = lone.id;
          const outcome = await confirmDiscardOutcome(lone);
          if (outcome === "cancel") return;
          if (outcome === "discarded") {
            // 그 탭의 편집기(문서·실행취소)까지 버린다 — `저장 안 함`은 정말 버리는 것이다.
            dropHost(lone.id);
            const rest = tabsRef.current.filter((tb) => tb.id !== lone.id);
            tabList = rest;
            setTabs(rest);
            tabsRef.current = rest;
          } else {
            // 저장했다 — `saveTab`이 고친 탭(경로·이름·dirty)을 세션에 넣어야 한다.
            tabList = tabsRef.current;
          }
        }
      }

      // 탭이 하나도 남지 않은 채 닫히는 경우(마지막 탭을 닫았다). 디스크의 세션을
      // 그대로 두면 **방금 닫은 탭이 다음 실행에 돌아온다** — §5의 `저장 안 함 = 버림`과
      // 반대다. 그래서 세션을 지운다(다음 실행은 빈 탭 하나로 뜬다).
      // 원본은 마지막 탭을 목록에 남겨 둔 채(깨끗하게 만들어) 창을 닫아 그 탭이 다시
      // 돌아왔다 — 메모장 11은 돌아오지 않으므로 메모장 쪽을 따랐다(보고에 적었다).
      if (tabList.length === 0 && others === 0) {
        await clearSession();
        await win.destroy();
        return;
      }

      const snap = await snapshotWindow(tabList);
      if (!(await putWindow(snap))) {
        if (!(await askEveryTab())) return;
      } else {
        // §5: 먼저 닫은 창도 그 실행 동안 보관해 **다음 실행에 모든 창이 돌아온다**.
        // 저장이 성공했을 때만 얼린다 — 실패해서 사용자가 버리기로 했다면 그 답이
        // "버려라"는 뜻이므로 얼리면 되살아난다(원본의 판단과 같다).
        await freezeWindow();
      }
      await win.destroy();
    },
    [confirmDiscard, confirmDiscardOutcome, snapshotWindow]
  );

  /** 종료 보류의 물음이 부르는 '지금' 닫기 — 효과가 매번 다시 붙지 않게 ref로 둔다. */
  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;

  /**
   * 탭 하나 닫기 — ✕ · Ctrl+W · 가운데 클릭. 미저장이면 D1로 묻고,
   * **마지막 탭을 닫으면 창이 닫힌다**(§5).
   *
   * **§5의 예외 — 알림이 걸린 탭.** `저장 안 함`을 골랐는데 그 탭에 예약된 알림이 있으면
   * `confirmDiscard`가 한 번 더 묻는다(시안 `DiscardReminder` ②). 거기서 닫기로 하면
   * 그 알림을 취소하고 탭을 **정말 버린다** — 예전처럼 숨겨 보관하지 않는다.
   * (숨은 탭 자체는 그대로 남는다: 이미 그렇게 닫혀 세션에 들어가 있던 탭과, 알림이
   * 끝났을 때 치우는 `reconcileReminderTabs`는 전과 같다.)
   */
  const closeTab = useCallback(
    (id: number) => {
      void (async () => {
        const tab = findTab(tabsRef.current, id);
        if (!tab) return;
        if (!(await confirmDiscard(tab))) return;
        const before = tabsRef.current;
        const next = before.filter((tb) => tb.id !== id);
        const nextActive = activeAfterClose(before, id, activeRef.current);
        // 그 탭의 편집기(문서·실행취소)를 버린다 — `저장 안 함`은 정말 버리는 것이다.
        dropHost(id);
        setTabs(next);
        tabsRef.current = next;
        if (nextActive === null) {
          // 보이는 탭이 하나도 남지 않았다 → 창이 닫힌다. 숨은 탭(알림)은 세션에 남는다.
          await closeWindow(next);
          return;
        }
        setActiveId(nextActive);
        activeRef.current = nextActive;
      })();
    },
    [closeWindow, confirmDiscard]
  );

  // --- 다중 창: 탭 떼어내기 · 합치기 (§5) --------------------------------
  //
  // Windows 11 메모장이 하는 대로다:
  //   * 탭을 **탭 줄 밖으로** 끌면 고스트 탭이 커서를 따라다닌다. 고스트는 창 밖에서도
  //     보여야 하므로 작은 투명·항상 맨 위·포커스 없는 **자기 창**이고, 커서를 따라
  //     옮기는 것은 Rust다(`src-tauri/src/drag.rs` — 전역 커서 폴링).
  //   * 놓은 자리가 **다른 Inkwell 창의 탭 줄**이면 그 자리에 들어간다(합치기).
  //   * 그 밖이면 커서 자리에 **새 창**을 만들고 그 탭을 옮긴다.
  //   * 탭이 **하나뿐인 창**은 새 창을 만들지 않고 그 창 자체가 그 자리로 간다
  //     (메모장·Edge와 같다 — 탭이 하나면 창과 탭이 같은 것이다).
  //   * 원래 창의 마지막 탭을 다른 창에 합치면 원래 창은 **닫힌다**(세션에서도 제거).
  //
  // 문서 상태는 `DocHost.serialize()`로 넘긴다 — 원문 보존 기준·저장될 글·선택·스크롤·
  // 실행 취소 스택이 모두 들어 있어, 옮긴 뒤 Ctrl+Z가 이어서 동작하고 미저장 표시도
  // 그대로다(`lib/transfer.ts`).

  /** 끌고 있는 동안의 모든 것. React 상태가 아니라 ref다 — 16ms마다 갱신된다. */
  const tearRef = useRef<{
    info: TearInfo;
    zones: DropZone[];
    /** Rust가 알려 준 마지막 커서 자리. **아직 한 번도 못 받았으면 `null`** — 그 상태로
     *  놓으면 어디에 놓였는지 알 수 없으므로 끌기를 취소로 본다. */
    cursor: { x: number; y: number } | null;
    target: DropTarget | null;
    done: boolean;
  } | null>(null);

  /** 탭 하나를 이 창에서 **들어낸다**(닫는 것이 아니다 — 문서는 다른 창으로 간다). */
  const takeOutTab = useCallback((id: number) => {
    const before = tabsRef.current;
    const next = before.filter((tb) => tb.id !== id);
    const nextActive = activeAfterClose(before, id, activeRef.current);
    dropHost(id);
    setTabs(next);
    tabsRef.current = next;
    if (nextActive !== null) {
      setActiveId(nextActive);
      activeRef.current = nextActive;
    }
  }, []);

  /** 놓았을 때 실제로 옮기는 길. `tearRef`를 이미 비운 **사본**을 받는다. */
  const dropTab = useCallback(
    async (d: {
      info: TearInfo;
      cursor: { x: number; y: number };
      target: DropTarget | null;
    }) => {
      const tab = findTab(tabsRef.current, d.info.id);
      if (!tab) return;
      const visible = shownTabs(tabsRef.current);
      const only = visible.length <= 1;
      const target = d.target;

      // 1) 내 탭 줄 — 자리만 바꾼다(줄 밖으로 나갔다가 돌아온 경우).
      if (target && target.label === labelRef.current) {
        reorderTab(tab.id, Math.min(target.index, visible.length - 1));
        return;
      }

      const host = peekHost(tab.id) ?? hostOf(tab.id, tab.format);
      const doc = host.serialize();

      // 2) 다른 창의 탭 줄 — 합치기.
      if (target) {
        if (!(await tabTransfer(target.label, freezeTab(tab, doc, target.index)))) return;
        takeOutTab(tab.id);
        await windowFocus(target.label);
        if (only) {
          // 마지막 탭을 넘겼다 → 이 창은 사라지고 **세션에서도 지워진다**(얼리지 않는다).
          // 그 탭은 다른 창에 살아 있으므로 얼리면 다음 실행에 복제된다(§5).
          await forgetWindow();
          await getCurrentWindow().destroy();
        }
        return;
      }

      // 3) 아무 탭 줄도 아니다.
      // 떼어낸 창은 **최대화되지 않았을 때의** 크기를 물려받는다 — 최대화된 창에서
      // 탭을 떼어내면 화면만 한 창이 커서 밑에 생기는 것이 맞지 않다.
      const normal = normalRectRef.current;
      const rect = newWindowRect(
        d.cursor,
        { x: d.info.grabX, y: d.info.grabY },
        { x: d.info.tabX, y: d.info.tabY },
        normal === null ? outerRef.current : { w: normal.w, h: normal.h }
      );
      if (only) {
        // 탭이 하나뿐이면 **이 창이 그 자리로 간다**(새 창을 만들지 않는다).
        try {
          await getCurrentWindow().setPosition(new PhysicalPosition(rect.x, rect.y));
        } catch {
          // 못 옮겨도 탭과 글은 그대로다.
        }
        return;
      }
      const label = await windowCreate({
        role: "fresh",
        empty: true,
        tint: tab.tint,
        rect,
      });
      if (label === null) return;
      if (!(await tabTransfer(label, freezeTab(tab, doc, 0)))) return;
      takeOutTab(tab.id);
    },
    [reorderTab, takeOutTab]
  );

  /** 끌기를 끝낸다. `cancel`(Esc)이면 아무 일도 일어나지 않는다. */
  const finishTear = useCallback(
    (cancel: boolean) => {
      const d = tearRef.current;
      if (!d || d.done) return;
      d.done = true;
      tearRef.current = null;
      setTearing(false);
      void dragEnd();
      void markDrop(null, null);
      // 커서 자리를 한 번도 못 받았으면(끌기를 켠 바로 그 프레임에 놓았다) 취소와 같다.
      if (cancel || d.cursor === null) return;
      void dropTab({ info: d.info, cursor: d.cursor, target: d.target });
    },
    [dropTab]
  );

  /** 포인터가 탭 줄을 벗어났다 — 여기서부터 고스트 탭이 커서를 따라다닌다. */
  const beginTear = useCallback(
    (info: TearInfo) => {
      const tab = findTab(tabsRef.current, info.id);
      if (!tab || tearRef.current !== null) return;
      setTearing(true);
      tearRef.current = { info, zones: [], cursor: null, target: null, done: false };
      // 안전망: `tearing` 효과가 돌기 전에(한 프레임) 버튼을 떼면 놓기를 못 받아 고스트가
      // 영원히 커서를 따라다닌다. 여기서 한 번짜리 리스너를 미리 걸어 둔다 —
      // 효과의 리스너와 겹쳐도 `finishTear`가 `done`으로 막는다.
      window.addEventListener("pointerup", () => finishTear(false), { once: true });
      void (async () => {
        // 놓을 자리는 **끌기를 시작할 때 한 번** 가져온다 — 끄는 중에 창이 움직이지 않는다.
        const zones = await dropZones();
        if (tearRef.current) tearRef.current.zones = zones;
        // 고스트의 색은 여기서 계산해 넘긴다 — 팔레트가 두 곳에 생기면 테마가 어긋난다.
        const css = getComputedStyle(document.documentElement);
        const color = (name: string, fallback: string) =>
          css.getPropertyValue(name).trim() || fallback;
        const paint: GhostPaint = {
          name: tabLabel(tab),
          dirty: tab.dirty,
          dot: tab.tint === "none" ? null : (TINT_DOTS[tab.tint] ?? null),
          bar: color("--bar", "#17181C"),
          hair: color("--hair", "#2C2E35"),
          text: color("--text", "#C9CCD3"),
          accent: color("--accent", "#6EE7B7"),
          dim: color("--dim", "#7C818C"),
        };
        const ok = await dragBegin({
          w: info.w,
          h: info.h,
          grabX: info.grabX,
          grabY: info.grabY,
          paint,
        });
        if (!ok) finishTear(true);
      })();
    },
    [finishTear]
  );

  /** Rust가 16ms마다 알려 주는 커서 자리 — 놓을 자리 표시를 여기서 갱신한다. */
  const moveTear = useCallback((x: number, y: number) => {
    const d = tearRef.current;
    if (!d || d.done) return;
    d.cursor = { x, y };
    const next = dropTargetAt(x, y, d.zones);
    const same =
      (next?.label ?? null) === (d.target?.label ?? null) &&
      (next?.index ?? null) === (d.target?.index ?? null);
    d.target = next;
    // 바뀔 때만 보낸다(16ms마다 모든 창에 보내면 IPC가 낭비된다). 내 창의 표시도
    // 같은 길로 돌아온다 — `markDrop`은 모든 창에 보내고 그중 하나가 나다.
    if (!same) void markDrop(next?.label ?? null, next?.index ?? null);
  }, []);

  // Rust의 커서 — **늘 듣는다.** 끌기가 켜질 때 붙이면 리스너가 붙기까지의 한두 프레임
  // 동안 좌표를 놓치고, 그 사이에 놓으면 어디에 놓였는지 알 수 없게 된다.
  // 끌고 있지 않을 때는 Rust가 보내지 않고, 보내도 `moveTear`가 아무 일도 하지 않는다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<[number, number]>(DRAG_MOVE_EVENT, (e) => {
        const [x, y] = e.payload;
        moveTear(x, y);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [moveTear]);

  // 끌고 있는 동안만: 놓기(pointerup)와 취소(Esc).
  useEffect(() => {
    if (!tearing) return undefined;
    // 놓기는 **포인터 캡처가 붙은 이 창**의 `pointerup`이 가장 정확하다. 끌고 있던 알약은
    // DOM에서 사라질 수 있으므로 창 수준에서 받는다.
    const onUp = () => finishTear(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      finishTear(true);
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [finishTear, tearing]);

  // 놓을 자리 표시(이 창이 대상일 때). 끌고 있는 창이 보내는 값이다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<number | null>(DROP_MARK_EVENT, (e) =>
        setDropAt(typeof e.payload === "number" ? e.payload : null)
      )
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  /**
   * 탭 하나가 도착했다(떼어내기·합치기). 꾸러미는 IPC를 건너온 모르는 값이라
   * `thawTab`으로 걸러 읽는다 — 깨진 꾸러미로 창이 깨지지 않게.
   *
   * `expectArrivalRef`가 참이면 이 창은 **떼어낸 탭을 받으러 태어난 창**이므로 시작할 때
   * 만든 빈 탭을 버린다(원본 설계의 `suppressFirstTab`과 같은 자리).
   */
  const receiveTab = useCallback((payload: unknown) => {
    const got = thawTab(payload);
    if (got === null) return;
    const fresh = createTab(got.tab.tint, got.tab.name, got.tab.uid);
    const tab: Tab = {
      ...fresh,
      path: got.tab.path,
      format: got.tab.format,
      enc: got.tab.enc,
      eol: got.tab.eol,
      bigMd: got.tab.bigMd,
      hidden: got.tab.hidden,
      reminder: got.tab.reminder,
      dirty: got.tab.dirty,
    };
    replaceHost(tab.id, got.doc);

    const expecting = expectArrivalRef.current;
    expectArrivalRef.current = false;
    let before = tabsRef.current;
    if (expecting) {
      for (const old of before) dropHost(old.id);
      before = [];
    }
    // 들어갈 자리는 **보이는 탭** 기준이다. 숨은 탭(알림 단계의 자리)은 아직 없으므로
    // 지금은 전체 목록의 자리와 같다 — 숨은 탭이 생기면 여기도 보이는 자리로 환산한다.
    const at = Math.max(0, Math.min(got.at, before.length));
    const next = [...before.slice(0, at), tab, ...before.slice(at)];
    setTabs(next);
    tabsRef.current = next;
    setActiveId(tab.id);
    activeRef.current = tab.id;
  }, []);

  const receiveRef = useRef(receiveTab);
  receiveRef.current = receiveTab;

  // --- 찾기/바꾸기 (설계 문서 단계 10 · §8) --------------------------------

  const findQuery = useMemo<SearchQuery>(
    () => ({
      text: find.text,
      caseSensitive: find.caseSensitive,
      wholeWord: find.wholeWord,
      regex: find.regex,
    }),
    [find.caseSensitive, find.regex, find.text, find.wholeWord]
  );

  /**
   * 다시 세고 강조를 갱신한다. `step`이면 선택 자리에서 **다음 일치**로 가고
   * (끝에서 처음으로 돌아간다), 아니면 지금 선택과 같은 일치의 번호만 맞춘다.
   */
  const rescan = useCallback(
    (step: boolean) => {
      const list = host.search(findQuery, find.replace);
      setHits(list);
      if (list === null || list.length === 0) {
        setHitIndex(-1);
        host.setHits([], -1);
        return;
      }
      const sel = host.selectionRange();
      const i = step
        ? stepIndex(list, sel.from, sel.to, true)
        : hitAt(list, sel.from, sel.to);
      setHitIndex(i);
      if (step && i >= 0) host.selectHit(list[i]);
      host.setHits(list, i);
    },
    [find.replace, findQuery, host]
  );

  // 찾기 칸·옵션이 바뀌거나 **문서가 바뀌면** 다시 센다(원본과 같은 시점).
  useEffect(() => {
    if (!find.open) {
      host.setHits([], -1);
      setHits([]);
      setHitIndex(-1);
      return;
    }
    rescan(false);
  }, [docVersion, find.open, host, rescan]);

  const findStep = useCallback(
    (forward: boolean) => {
      // 고정(테이프·오버레이) 중에는 찾기가 없다 — F3도 아무 일도 하지 않는다(지시 2).
      if (tapeOn) return;
      setFindMessage("");
      if (hits === null || hits.length === 0) {
        setHitIndex(-1);
        return;
      }
      const sel = host.selectionRange();
      const i = stepIndex(hits, sel.from, sel.to, forward);
      setHitIndex(i);
      host.selectHit(hits[i]);
      host.setHits(hits, i);
    },
    [hits, host, tapeOn]
  );

  /** `Alt+R` — 선택된 일치를 바꾸고 **다음 일치로 간다**(원본 `ReplaceCurrent`). */
  const findReplace = useCallback(() => {
    if (!find.replaceOpen) return;
    setFindMessage("");
    if (hits === null || hits.length === 0) return;
    const sel = host.selectionRange();
    const idx = hitAt(hits, sel.from, sel.to);
    // 아직 아무것도 선택되지 않았으면 먼저 하나를 고른다(바로 뒤의 Alt+R이 그것을 바꾼다).
    if (idx < 0) {
      findStep(true);
      return;
    }
    if (!host.replaceHit(hits[idx], find.replace)) return;
    refresh("doc");
    rescan(true);
  }, [find.replace, find.replaceOpen, findStep, hits, host, refresh, rescan]);

  /** `Ctrl+Alt+Enter` — 모두 바꾸기. **한 트랜잭션**이라 `Ctrl+Z` 한 번에 되돌아간다. */
  const findReplaceAll = useCallback(() => {
    if (!find.replaceOpen) return;
    if (hits === null || hits.length === 0) return;
    const n = host.replaceAll(findQuery, find.replace);
    refresh("doc");
    rescan(false);
    if (n > 0) setFindMessage(tf("findReplacedFmt", n));
  }, [find.replace, find.replaceOpen, findQuery, hits, host, refresh, rescan]);

  const closeFind = useCallback(() => {
    setFind((old) => ({ ...old, open: false }));
    setFindMessage("");
    host.setHits([], -1);
    host.focus();
  }, [host]);

  /**
   * `Ctrl+F`(접힘) / `Ctrl+H`(펼침) — 둘 다 같은 카드를 열고 모드만 다르다(원본).
   * 선택이 **한 줄**이면 찾기 칸에 채운다: 줄바꿈이 섞인 선택은 검색어가 아니다(원본 규칙).
   *
   * **고정(테이프)·오버레이 중에는 아무 일도 하지 않는다**(지시 2). 그때는 테이프 말고
   * 모든 UI가 숨으므로(`uiHidden`) 카드를 열어 두면 **보이지 않는 채로 켜져 있다가**
   * 고정을 풀 때 튀어나온다. 메뉴·단축키·F3이 모두 이 한 자리를 지나므로 길이 하나다.
   */
  const openFind = useCallback(
    (replaceOpen: boolean) => {
      if (tapeOn) return;
      const picked = host.selectedText();
      const prefill =
        picked !== "" && picked.length < 512 && !picked.includes("\n") ? picked : null;
      setFindMessage("");
      setFind((old) => ({ ...old, open: true, replaceOpen, text: prefill ?? old.text }));
      setFindFocus((n) => n + 1);
    },
    [host, tapeOn]
  );

  /**
   * 고정(테이프·오버레이)을 **시작할 때** 찾기 카드를 닫는다(지시 2).
   *
   * 판단: 열려 있던 카드는 **닫는다**. 고정 중에는 카드가 그려지지 않으므로 열린 채로
   * 두면 사용자에게는 닫힌 것처럼 보이다가 고정을 풀 때 다시 나타난다 — "몰래 켜져
   * 있다가 나타나는 일이 없게"가 지시다. 일치 강조는 `find.open`이 거짓이 되면 바로
   * 아래 효과가 지운다(`host.setHits([], -1)`), 그래서 여기서는 상태만 내린다.
   * 초점은 건드리지 않는다 — 고정 중에 편집 영역으로 초점을 끌어오면 안 된다.
   */
  useEffect(() => {
    if (!tapeOn) return;
    setFind((old) => (old.open ? { ...old, open: false } : old));
    setFindMessage("");
  }, [tapeOn]);

  /** 줄 1의 글자 — 원본 `FindCountText`와 같은 우선순위. */
  const findStatus = useMemo(() => {
    if (hits === null) return { text: t("findRegexError"), error: true };
    if (findMessage !== "") return { text: findMessage, error: false };
    if (find.text === "") return { text: "", error: false };
    if (hits.length === 0) return { text: t("findNoResults"), error: false };
    if (hitIndex >= 0) return { text: `${hitIndex + 1} / ${hits.length}`, error: false };
    return { text: tf("findMatchesFmt", hits.length), error: false };
  }, [find.text, findMessage, hitIndex, hits]);

  // --- 알림 두 화면을 여는 길 ---
  //
  // 둘 다 `popup-scrim`을 깔고 뜨므로 **바깥을 누르면 닫히고**, 오버레이에서는
  // 불투명 칩이자 클릭을 잡는 영역이다(`data-hit` — `overlayHitRects.ts`가 모은다).
  // 열 때 다른 팝업을 먼저 치우는 것은 `openAt`·`openTableGrid`와 같은 규칙이다.

  /**
   * `알림 예약…`(우클릭 메뉴) · `Ctrl+Shift+R` — 예약 창을 **편집 영역 커서 근처**에
   * 띄운다. 선택한 글이 미리보기이고, 선택이 없으면 **열지 않는다**(메뉴 행도 그때
   * 회색이고 단축키도 같은 규칙이어야 셋이 어긋나지 않는다 — 원본 `MoreItemEnabled`).
   */
  const openRemindPick = useCallback(() => {
    const tab = findTab(tabsRef.current, activeRef.current);
    if (!tab) return;
    const h = peekHost(tab.id) ?? hostOf(tab.id, tab.format);
    const picked = h.selectedText();
    // 선택이 없으면 **말해 준다**(원본 `kStrRemindNoSelection`). 전에는 조용히 아무
    // 일도 하지 않아서 Ctrl+Shift+R이 고장난 것처럼 보였다. 메모장도 할 수 없는 일은
    // 한 줄짜리 확인 카드로 말한다 — 파일 오류 카드(`showFileError`)와 같은 모양이다.
    if (flattenText(picked) === "") {
      setDialog({
        message: noSelectionText(),
        buttons: [
          { label: t("dlgBtnOk"), primary: true, cancel: true, onClick: () => setDialog(null) },
        ],
      });
      return;
    }
    const range = h.selectionRange();
    setOpenMenu(null);
    setOpacityOpen(false);
    setTableAnchor(null);
    setRemindList(null);
    setRemindPick({
      anchor: caretAnchor(editorRef.current),
      // `due`는 창이 돌려주는 값으로 덮인다 — 여기서는 나머지를 굳혀 둔다.
      req: {
        due: 0,
        tabUid: tab.uid,
        docPath: tab.path,
        tint: tab.tint,
        selStart: range.from,
        selEnd: range.to,
        // 자르고 누르는 것은 Rust(`reminder_add`의 `flatten`)가 한 번만 한다.
        text: picked,
      },
    });
  }, []);

  /** `예약된 알림`(우클릭 메뉴 · ☰) — 목록을 **그 메뉴가 있던 자리**에 띄운다. */
  const openRemindList = useCallback(() => {
    const at = openMenuRef.current?.position ?? null;
    setOpenMenu(null);
    setOpacityOpen(false);
    setTableAnchor(null);
    setRemindPick(null);
    setRemindList({
      anchor: at
        ? { left: at.left, top: at.top, right: at.left, bottom: at.top }
        : caretAnchor(editorRef.current),
      placement: "at",
    });
  }, []);

  // --- 명령 표: 여기 있는 것만 동작한다 (commands.ts 주석 참고) ---
  const commands: CommandTable = useMemo(
    () => ({
      newTab,
      // `새 창`(Ctrl+Shift+N) — 빈 탭 하나인 새 창. 첫 탭은 **지금 탭의 색**을 물려받는다
      // (§5: 새 탭은 현재 탭 색을 물려받는다 — 새 창의 첫 탭도 새 탭이다).
      newWindow: () => void windowCreate({ role: "fresh", tint }),
      closeTab: () => closeTab(activeRef.current),
      closeWindow: () => void closeWindow(),
      // `끝내기` — **모든 창**이 자기 닫기 규칙(§5)을 돌린다. 이 창도 그중 하나라
      // 여기서 직접 닫지 않는다(길이 하나여야 규칙이 한 벌이다).
      exit: () => void closeAllWindows(),
      open: openCommand,
      save: () => saveCommand(false),
      saveAs: () => saveCommand(true),
      saveAll: saveAllCommand,
      find: () => openFind(false),
      replace: () => openFind(true),
      undo: () => runEditor(() => host.undo()),
      redo: () => runEditor(() => host.redo()),
      cut: () => copyCommand(true),
      copy: () => copyCommand(false),
      paste: pasteCommand,
      delete: () => runEditor(() => host.exec({ t: "delete" })),
      // 표 지우기 — 우클릭 메뉴의 `표 삭제`. 커서가 든 표를 통째로 지운다.
      deleteTable: () => runEditor(() => host.exec({ t: "deleteTable" })),
      selectAll: () => runEditor(() => host.exec({ t: "selectAll" })),
      // 확대/축소 — ☰ › 보기의 세 줄과 단축키(Ctrl+`=`·`-`·`0`)가 같은 이 길로 들어온다.
      zoomIn: () => applyZoom("in"),
      zoomOut: () => applyZoom("out"),
      zoomReset: () => applyZoom("reset"),
      bold: () => runEditor(() => host.exec({ t: "bold" })),
      // 취소선(Ctrl+Shift+X) — 도구 줄의 표 옆 버튼. 굵게와 같은 규칙이다.
      strike: () => runEditor(() => host.exec({ t: "strike" })),
      // 글머리 기호(Ctrl+Shift+8) — 도구 줄의 `•≡` 버튼(시안 L1)과 같은 이 한 줄로 들어온다.
      bullet: () => runEditor(() => host.exec({ t: "bullet" })),
      h1: () => runEditor(() => host.exec({ t: "heading", level: 1 })),
      h2: () => runEditor(() => host.exec({ t: "heading", level: 2 })),
      h3: () => runEditor(() => host.exec({ t: "heading", level: 3 })),
      highlight: () => highlightCommand(penColor),
      highlightOff: () => runEditor(() => host.exec({ t: "highlight", color: null })),
      // 알림 — 예약 창(휠 피커)과 예약 목록. 저장·스케줄·발생·토스트·트레이는
      // 전부 Rust다(`lib/reminders.ts` 주석).
      remind: openRemindPick,
      remindList: openRemindList,
      // 설정(시안 S) — 도구 줄의 ⚙와 ☰의 `설정`이 **같은 이 한 줄**로 들어온다.
      settings: () => setSettingsOpen(true),
      // 개발 빌드 전용 — 승인된 토스트(T2) 모양을 바로 띄워 본다. `rootMenu(DEV)`가
      // 이 두 줄을 붙이지 않으면 닿을 길이 없다.
      toastPreview: () => {
        if (import.meta.env.DEV) void previewToast(false);
      },
      toastPreviewMissed: () => {
        if (import.meta.env.DEV) void previewToast(true);
      },
    }),
    [
      applyZoom,
      closeTab,
      closeWindow,
      copyCommand,
      highlightCommand,
      host,
      newTab,
      openCommand,
      openFind,
      openRemindList,
      openRemindPick,
      pasteCommand,
      penColor,
      runEditor,
      saveAllCommand,
      saveCommand,
      tint,
    ]
  );

  // --- 메뉴 ---
  const editState: EditMenuState = {
    canUndo: query.canUndo,
    canRedo: query.canRedo,
    hasSelection: query.hasSelection,
    hasText: query.hasText,
    canFormat: query.canFormat,
    // `예약된 알림` 행은 예약이 하나라도 있을 때만 켜진다(원본 `MoreItemEnabled`).
    remindCount: reminders?.pending.length ?? 0,
  };

  const menuState: MenuState = {
    overlay,
    tapeOn,
    statusBar,
    textBacking,
    noteList,
    theme: themeChoice,
    tint,
    // ☰ › 보기의 `확대/축소` 한 줄이 지금 배율을 보여 준다(시안 C2).
    zoom,
    startup,
    highlight,
    fontFamily,
    fontSize,
    maximized,
    minimized,
    edit: editState,
  };

  const setTint = useCallback(
    (next: Tint) => {
      // 색만 바뀐다 — 테마는 그대로다(사용자 결정 2026-11-08).
      const result = applyTint({ choice: themeChoice, tint }, next);
      // 사용자가 **고른** 색만 설정에 남는다(새 탭·첫 실행이 물려받는 기본값).
      setDefaultTint(result.tint);
      setTabs((old) =>
        old.map((tab) => (tab.id === activeId ? { ...tab, tint: result.tint } : tab))
      );
    },
    [activeId, themeChoice, tint]
  );

  const pickTheme = useCallback(
    (choice: ThemeChoice) => {
      // 테마만 바뀐다 — 어느 탭의 메모지 색도 건드리지 않는다(사용자 결정 2026-11-08).
      setThemeChoice(chooseTheme({ choice: themeChoice, tint }, choice).choice);
    },
    [themeChoice, tint]
  );

  const runAction = useCallback(
    (act: Action) => {
      switch (act.t) {
        case "cmd":
          commands[act.id]?.();
          break;
        case "sys":
          void invoke("sys_command", { command: act.id });
          break;
        case "toggle":
          if (act.id === "overlay") setOverlay((on) => !on);
          else if (act.id === "statusBar") setStatusBar((on) => !on);
          else if (act.id === "textBacking") setTextBacking((on) => !on);
          else if (act.id === "tapeOn") {
            // 테이프를 누른 것과 **같은 길**이다(`Tape.onToggle`): 오버레이 중이면
            // 오버레이를 끄고(테이프는 오버레이 전 `pinned`로 돌아간다), 아니면 고정을
            // 켜고 끈다. 길이 둘이면 둘이 어긋난다.
            if (overlayRef.current) setOverlay(false);
            else setPinned((on) => !on);
          } else setNoteList((on) => !on);
          break;
        case "theme":
          pickTheme(act.value);
          break;
        case "tint":
          setTint(act.value);
          break;
        case "startup":
          // 시안 S의 `시작` 그룹. `새 세션`으로 바꾸면 **지금 들고 있는 세션을 바로
          // 버린다** — 설정이 "저장되지 않은 변경 내용 삭제"라고 말하는데 디스크에
          // 이전 세션이 남아 있으면 다음 실행에 그것이 돌아온다.
          setStartup(act.value);
          startupRef.current = act.value;
          if (act.value === "fresh") void clearSession();
          break;
        case "font":
          setFontFamily(act.value);
          break;
        case "fontSize":
          // 확대/축소와 같은 배려: 크기가 바뀌면 같은 스크롤 값이 다른 줄을 가리키므로
          // **맨 위에 보이던 줄을 그 자리에 되돌린다**(`applyZoom`과 같은 길).
          applyDocSize(act.value);
          break;
        case "highlight":
          // 색을 고르면 그 색이 저장되고 **바로 칠한다**(원본 색 팝업과 같다).
          setHighlight(act.value);
          highlightCommand(HIGHLIGHTS[act.value] ?? HIGHLIGHTS[0]);
          break;
        case "tab":
          // 「N ▾」 탭 목록에서 고른 탭(시안 T1). 알약을 누른 것과 **같은 길**이고,
          // 탭 줄이 그 알약까지 넘어가는 일은 `TitleBar`의 `scrollToPill` 효과가 한다.
          setActiveId(act.id);
          break;
        default:
          break;
      }
    },
    [applyDocSize, commands, highlightCommand, pickTheme, setTint]
  );

  /**
   * 버튼에 대고 팝업을 연다. 도구 줄은 창 아래에 있으니 기본이 `위로`이고, 설정
   * 화면의 `언어` 칩은 카드 가운데에 있어 `아래로` 연다.
   */
  const openAt = useCallback((menu: Menu, el: HTMLElement, placement: Placement = "above") => {
    setOpacityOpen(false);
    setMoreOpen(false);
    setTableAnchor(null);
    setOpenMenu({ menu, position: placeMenu(menu, anchorOf(el), placement) });
  }, []);

  const openSystemMenu = useCallback((x: number, y: number) => {
    setOpacityOpen(false);
    setMoreOpen(false);
    setTableAnchor(null);
    setOpenMenu({ menu: SYSTEM_MENU, position: placeMenu(SYSTEM_MENU, anchorAt(x, y), "at") });
  }, []);

  /**
   * 편집 영역 우클릭 — 메모장 구성의 편집 메뉴를 그 자리에 연다.
   *
   * **클립보드를 들여다보지 않는다**(사용자 보고 1): 예전에는 `붙여넣기` 행을 켤지
   * 정하려고 `navigator.clipboard.readText()`를 불렀고, 그 한 줄이 WebView2의 권한
   * 창을 띄웠다. `붙여넣기`는 **언제나 켜 둔다** — 될 수도 있는 명령을 미리 끄지
   * 않는다는 이 코드의 원칙 그대로다(비어 있으면 눌러도 아무 일도 없다).
   */
  const openEditMenu = useCallback(
    (x: number, y: number) => {
      setOpacityOpen(false);
      setMoreOpen(false);
      setTableAnchor(null);
      // 커서가 표 안이면 `표 삭제` 한 줄이 더 붙는다(`menus.editMenu`).
      const menu = editMenu(host.query().inTable);
      setOpenMenu({ menu, position: placeMenu(menu, anchorAt(x, y), "at") });
    },
    [host]
  );

  const openTableGrid = useCallback((anchor: Anchor) => {
    setOpenMenu(null);
    setOpacityOpen(false);
    setMoreOpen(false);
    setTableAnchor(anchor);
  }, []);

  // --- 펜 모드 ---
  // 켜 두면 새로 치는 글자에도 색이 남고(storedMarks), 드래그로 범위를 고를 때마다 칠한다.
  useEffect(() => {
    host.setPen(penOn ? penColor : null);
  }, [host, penColor, penOn]);

  useEffect(() => {
    if (!penOn) return undefined;
    // 원본과 같은 시점: 끌기를 **놓을 때** 칠한다(끌는 중에 칠하면 실행취소가 잘게 쪼개진다).
    const onUp = () => {
      if (host.exec({ t: "highlight", color: penColor, toggle: false })) refresh("doc");
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [host, penColor, penOn, refresh]);

  /**
   * Ctrl+휠 — 본문 글자 크기(원본 Win32 판은 RichEdit이 공짜로 해 주던 자리. 사용자 보고).
   *
   * 창에 한 번만 달고 **편집 영역 안에서 온 것만** 확대/축소한다: 도구 줄의 불투명도
   * 휠과 예약 창의 휠 피커는 자기 요소의 `onWheel`을 쓰므로 서로 닿지 않는다.
   *
   * `preventDefault`는 **편집 영역 밖에서도** 건다 — WebView2/Chromium의 페이지 확대가
   * 같이 걸리면 창 UI까지 커진다(Tauri의 `zoomHotkeysEnabled` 기본값이 꺼짐이라
   * 배포판에서는 애초에 오지 않지만, 브라우저로 여는 개발 중에는 온다).
   * `passive: false`여야 `preventDefault`가 듣는다.
   */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.altKey || e.deltaY === 0) return;
      e.preventDefault();
      if (settingsOpenRef.current || dialogOpenRef.current) return;
      const inEditor = e.target instanceof Node && editorRef.current?.contains(e.target) === true;
      if (!inEditor) return;
      applyZoom(e.deltaY < 0 ? "in" : "out");
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  // --- 단축키 ---
  // keydown은 창에 포커스가 있을 때만 오므로 "앱 안에서만"이 그대로 만족된다
  // (Alt+Space를 전역으로 등록하지 않는 이유 — 다른 앱의 창 메뉴를 가로채면 안 된다).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      /*
       * 편집기(ProseMirror/CodeMirror)가 이미 처리한 키는 두 번 처리하지 않는다.
       *
       * **예외는 편집 영역에서 올라온 `Esc` 하나다.** `prosemirror-view`의
       * `captureKeyDown`은 Esc(keyCode 27)에 대해 **아무 일도 하지 않고 `true`만**
       * 돌려주어 `preventDefault()`가 걸린다. 그래서 그냥 걸러 내면 마크다운 탭에서는
       * Esc로 찾기 카드가 닫히지 않고 펜 모드도 꺼지지 않았다(일반 텍스트 탭에서는
       * 되는 비대칭 버그). 팝업·대화상자·설정이 처리한 Esc는 그 자리에서 할 일을
       * 다 했으므로 **그대로 존중한다** — 그래서 예외를 편집 영역으로 한정한다.
       */
      const escFromEditor =
        e.key === "Escape" &&
        e.target instanceof Node &&
        editorRef.current?.contains(e.target) === true;
      /*
       * 확대/축소(Ctrl+`=`·`-`·`0`)는 **맨 앞에서** 본다 — `defaultPrevented` 검사보다
       * 먼저다. 두 가지 이유가 같은 방향을 가리킨다:
       *   · 브라우저의 페이지 확대가 이 조합에 걸려 있다. 넘겨 보내면 창 UI까지 커진다.
       *   · 편집기(ProseMirror/CodeMirror)가 이 조합을 먹고 `preventDefault`를 걸면
       *     Ctrl+Z 때와 같은 비대칭 버그가 난다(마크다운 탭에서만 안 되는 식).
       * 찾기 칸에 있어도 동작한다 — 글자 크기는 문서 서식이 아니라 보기 설정이고,
       * 메모장도 어디에 초점이 있든 확대/축소한다.
       */
      /*
       * F5 — **시간/날짜 넣기**(메모장의 `편집 › 시간/날짜`). 그리고 F5·Ctrl+R 계열은
       * 어떤 경우에도 **페이지를 새로 고치지 못하게** 막는다: WebView2가 새로 고치면
       * 열려 있던 탭·커서·실행취소가 통째로 날아간다.
       *
       * 확대/축소와 같은 이유로 `defaultPrevented` 검사보다 **먼저** 본다 — 편집기가
       * 먼저 먹어서 `preventDefault`를 걸어 버리면 Ctrl+Z 때와 같은 비대칭 버그가 난다.
       */
      const modalOpen = settingsOpenRef.current || dialogOpenRef.current;
      if (isReloadKey(e)) {
        e.preventDefault();
        // Ctrl+Shift+R — 알림 예약. 새로 고침 키와 겹쳐서 **여기서** 받아야 한다(전에는
        // 아래 단축키 표까지 내려가지 못하고 이 자리에서 삼켜져 아무 일도 없었다).
        // 선택한 글이 있을 때만 연다 — 없으면 조용히 넘어간다(사용자 결정 2026-11-11,
        // 우클릭 메뉴 행이 그때 회색인 것과 같은 규칙).
        if (e.ctrlKey && e.shiftKey && e.code === "KeyR") {
          const inFindNow =
            document.activeElement instanceof Element &&
            document.activeElement.closest(".find-card") !== null;
          if (!modalOpen && !inFindNow && flattenText(host.selectedText()) !== "") {
            commands.remind?.();
          }
          return;
        }
        if (!modalOpen && isTimeDateKey(e)) {
          void timeDateStamp().then((text) => {
            runEditor(() => host.exec({ t: "insertText", text }));
          });
        }
        return;
      }
      const zoomKey = modalOpen ? null : matchZoomKey(e);
      if (zoomKey !== null) {
        e.preventDefault();
        applyZoom(zoomKey);
        return;
      }
      if (e.defaultPrevented && !escFromEditor) return;
      // 설정 화면과 대화상자는 **모달**이다 — 떠 있는 동안 앱 단축키는 쉰다(Ctrl+W로
      // 뒤에 있는 탭이 닫히면 설정만 떠 있는 상태가 되고, 저장 확인 카드에서는 묻던
      // 질문이 영원히 풀리지 않는다). Enter·Esc·Tab·화살표는 그 카드들이 받는다.
      if (modalOpen) return;
      // Alt+Space: 시스템 메뉴. 위 줄 바로 아래, 창 왼쪽에서 (Windows와 같은 자리).
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "Space") {
        e.preventDefault();
        openSystemMenu(8, 36);
        return;
      }
      /*
       * F10 — ☰ 메뉴를 연다(사용자 보고 4). Windows의 관례다: 메모장도 F10·Alt로
       * 메뉴 바를 띄운다. R5에는 메뉴 바가 없고 ☰ 하나뿐이라 그 버튼에 대고 연다.
       * **Alt 한 번 누르기는 넣지 않았다** — Alt+Space·Alt+F4·IME와 같은 키라
       * "다른 키 없이 뗐는가"를 추적해야 하고, 틀리면 창이 닫히거나 한글 입력이
       * 끊긴다. 고정(테이프)·오버레이에서는 UI가 전부 숨으므로 열지 않는다.
       */
      if (isDockMenuKey(e)) {
        if (uiHiddenRef.current) return;
        const el = dockMenuRef.current;
        if (!el) return;
        e.preventDefault();
        openAt(rootMenu(import.meta.env.DEV), el);
        return;
      }
      // Esc: 찾기 바가 열려 있으면 닫고 편집 영역으로 돌아간다(원본 순서: 찾기 먼저),
      // 아니면 펜 모드를 끈다.
      if (e.key === "Escape") {
        if (find.open) {
          e.preventDefault();
          closeFind();
        } else if (penOn) {
          e.preventDefault();
          setPenOn(false);
        }
        return;
      }
      // F3 / Shift+F3 — 찾기 바가 열려 있을 때만(원본과 같다).
      if (e.code === "F3" && !e.ctrlKey && !e.altKey) {
        if (!find.open) return;
        e.preventDefault();
        findStep(!e.shiftKey);
        return;
      }
      // Alt+R 바꾸기 / Ctrl+Alt+Enter 모두 바꾸기.
      if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyR") {
        if (!find.open || !find.replaceOpen) return;
        e.preventDefault();
        findReplace();
        return;
      }
      if (e.ctrlKey && e.altKey && (e.code === "Enter" || e.code === "NumpadEnter")) {
        if (!find.open || !find.replaceOpen) return;
        e.preventDefault();
        findReplaceAll();
        return;
      }
      // Ctrl+Alt+S 모두 저장 — 메모장 11의 파일 메뉴에 있는 단축키.
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        commands.saveAll?.();
        return;
      }
      if (!e.ctrlKey || e.altKey) return;
      // Ctrl+Tab / Ctrl+Shift+Tab — **줄 순서대로** 다음/이전 탭(메모장과 같다).
      // Ctrl+1~9로 탭을 고르는 단축키는 **넣지 않는다**(지시): Ctrl+1~3은 제목 1~3이다.
      if (e.code === "Tab") {
        e.preventDefault();
        setActiveId(stepTab(tabsRef.current, activeRef.current, !e.shiftKey));
        return;
      }
      // 찾기 칸에 초점이 있는 동안에는 **서식·편집 단축키가 꺼진다**(원본 규칙):
      // 검색창에서 Ctrl+B를 누른 것이 문서를 굵게 하라는 뜻일 수는 없다.
      // 파일 명령과 보기 토글은 그대로 동작한다.
      const inFind =
        document.activeElement instanceof Element &&
        document.activeElement.closest(".find-card") !== null;
      if (e.shiftKey) {
        if (e.code === "KeyT") {
          e.preventDefault();
          setOverlay((on) => !on);
        } else if (e.code === "KeyM") {
          e.preventDefault();
          // 메뉴의 행과 같은 경로 — 어둡게 → 밝게 → 시스템만 돈다(색은 그대로).
          setThemeChoice(cycleTheme({ choice: themeChoice, tint }).choice);
        } else if (e.code === "KeyN") {
          // Ctrl+Shift+N — 새 창(메모장 11의 파일 메뉴에 있는 그 단축키).
          e.preventDefault();
          commands.newWindow?.();
        } else if (e.code === "KeyS") {
          e.preventDefault();
          commands.saveAs?.();
        } else if (e.code === "KeyW") {
          e.preventDefault();
          commands.closeWindow?.();
        } else if (e.code === "KeyH") {
          if (inFind) return;
          e.preventDefault();
          commands.highlight?.();
        } else if (e.code === "KeyX") {
          // Ctrl+Shift+X — 취소선. 편집기에 초점이 있으면 ProseMirror의 keymap이
          // 먼저 받아 `defaultPrevented`로 걸러지고, 그 밖(도구 줄 등)에서는 이 길이다.
          if (inFind) return;
          e.preventDefault();
          commands.strike?.();
        } else if (e.code === "Digit8") {
          // Ctrl+Shift+8 — 글머리 기호. 취소선과 같은 길이다(편집기에 초점이 있으면
          // ProseMirror의 keymap이 먼저 받는다).
          if (inFind) return;
          e.preventDefault();
          commands.bullet?.();
        } else if (e.code === "KeyL") {
          if (inFind) return;
          e.preventDefault();
          if (query.canFormat) {
            // 도구 줄의 표 버튼 자리 위로 연다(버튼이 숨어 있을 수도 있으므로 좌표로).
            const x = window.innerWidth / 2;
            const y = window.innerHeight - 52;
            openTableGrid({ left: x, right: x, top: y, bottom: y });
          }
        }
        return;
      }
      //
      // Ctrl+N과 Ctrl+T는 **둘 다 새 탭**이다: 메모장 11의 Ctrl+N이 새 탭이고,
      // 원본 Inkwell이 Ctrl+T에 새 탭을 붙여 두었다(USAGE.ko.md). 메뉴에는
      // `새 탭 Ctrl+N` 한 줄만 보인다(지시).
      if (e.code === "KeyT" || e.code === "KeyN") {
        e.preventDefault();
        newTab();
      } else if (e.code === "KeyW") {
        e.preventDefault();
        closeTab(activeRef.current);
      } else if (e.code === "KeyO") {
        e.preventDefault();
        commands.open?.();
      } else if (e.code === "KeyS") {
        e.preventDefault();
        commands.save?.();
      } else if (e.code === "KeyF") {
        e.preventDefault();
        commands.find?.();
      } else if (e.code === "KeyH") {
        e.preventDefault();
        commands.replace?.();
      } else if (e.code === "KeyZ") {
        if (inFind) return;
        e.preventDefault();
        commands.undo?.();
      } else if (e.code === "KeyY") {
        // 다시 실행은 **Ctrl+Y 하나**다(사용자 지시 — Windows 11 메모장과 같다).
        // `Ctrl+Shift+Z`는 어디에도 묶여 있지 않으므로 아무 일도 하지 않는다.
        if (inFind) return;
        e.preventDefault();
        commands.redo?.();
      } else if (e.code === "KeyB") {
        if (inFind) return;
        e.preventDefault();
        commands.bold?.();
      } else if (e.code === "Digit1") {
        if (inFind) return;
        e.preventDefault();
        commands.h1?.();
      } else if (e.code === "Digit2") {
        if (inFind) return;
        e.preventDefault();
        commands.h2?.();
      } else if (e.code === "Digit3") {
        if (inFind) return;
        e.preventDefault();
        commands.h3?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    applyZoom,
    closeFind,
    closeTab,
    commands,
    find.open,
    find.replaceOpen,
    findReplace,
    findReplaceAll,
    findStep,
    host,
    newTab,
    openAt,
    openSystemMenu,
    openTableGrid,
    penOn,
    query.canFormat,
    runEditor,
    themeChoice,
    tint,
  ]);

  // --- 세션 복원 (§5) ----------------------------------------------------

  /**
   * **기록 하나**를 이 창에 되살린다. 어느 기록이 내 것이고 어느 것이 새 창이 되는지는
   * 부르는 쪽이 정한다(`splitSession`) — 첫 창은 첫 기록을 자기 것으로 삼고 나머지를
   * `window_create`로 창으로 만들며, 그렇게 만들어진 창은 `window_boot`이 준 기록을
   * 여기로 가져온다.
   *
   * 탭 하나하나는 원본 `SessionRestore`와 같은 규칙이다:
   *   * 미저장 탭 → `buf_<탭ID>`의 글을 그대로 되살리고 **여전히 미저장**으로 둔다.
   *     실행 취소 스택도 함께 돌아온다(원본에는 없던 것 — 우리 스택은 직렬화된다).
   *   * 깨끗한 탭 → **파일을 다시 읽는다**(파일이 진실이다). 파일이 지워졌거나 열 수
   *     없으면 이름만 남은 빈 탭으로 돌아온다(사라지지 않는다).
   */
  const applySession = useCallback(async (rec: SessionWindow): Promise<boolean> => {
    if (rec.id !== "") windowIdRef.current = rec.id;

    const made: Tab[] = [];
    for (const st of rec.tabs) {
      const fresh = createTab(st.tint, st.name, st.id);
      const tab: Tab = {
        ...fresh,
        path: st.path,
        format: st.format,
        enc: st.enc,
        eol: st.eol,
        bigMd: st.bigMd,
        hidden: st.hidden,
        reminder: st.reminder,
        dirty: st.dirty,
      };
      let doc: TabDoc | null = null;
      if (st.buf !== null) {
        const text = await loadBuffer(st.buf);
        if (text !== null) {
          const histText = st.hist === null ? null : await loadBuffer(st.hist);
          const history = histText === null ? null : parseHistory(histText);
          doc = {
            format: st.format,
            // 보존 기준이 방금 되살린 글이다 — 다음 저장이 이 바이트와 같아진다(§4-3).
            fileSrc: text,
            text,
            selection: st.selection,
            scrollTop: st.scrollTop,
            history: history ?? EMPTY_HISTORY(),
          };
        }
      }
      if (doc === null && st.path !== null) {
        try {
          const got = await readTextFile(st.path);
          const name = leafOf(st.path);
          const format = formatOfFile(name, got.bytes);
          tab.name = name;
          tab.format = format;
          tab.bigMd = format === "plain" && formatOfName(name) === "markdown";
          tab.enc = got.enc;
          tab.eol = got.eol;
          tab.dirty = false;
          doc = {
            format,
            fileSrc: got.text,
            text: got.text,
            selection: st.selection,
            scrollTop: st.scrollTop,
            // 디스크의 글이 저장했을 때와 다를 수 있으므로 옛 스텝을 얹지 않는다
            // (원본도 복원 때 스택을 비웠다).
            history: EMPTY_HISTORY(),
          };
        } catch {
          tab.path = null;
          tab.dirty = false;
        }
      }
      if (doc === null) {
        doc = {
          format: tab.format,
          fileSrc: null,
          text: "",
          selection: null,
          scrollTop: 0,
          history: EMPTY_HISTORY(),
        };
      }
      replaceHost(tab.id, doc);
      made.push(tab);
    }
    if (made.length === 0) return false;

    // 시작할 때 만들어 둔 빈 탭은 세션이 탭을 다 가져왔으므로 버린다(원본 R6와 같은 자리).
    for (const old of tabsRef.current) {
      if (!made.some((tab) => tab.id === old.id)) dropHost(old.id);
    }
    const active = made.find((tab) => tab.uid === rec.activeTab) ?? shownTabs(made)[0] ?? made[0];
    setTabs(made);
    tabsRef.current = made;
    setActiveId(active.id);
    activeRef.current = active.id;
    setOpacity(rec.opacity);
    setZoom(clampZoom(rec.zoom));
    setOverlay(rec.overlay);
    setPinned(rec.pinned);
    pinnedRef.current = rec.pinned;

    // 창 위치·크기. 저장된 모니터가 사라졌으면 화면 안으로 보정한다(지시 6).
    const win = getCurrentWindow();
    if (rec.rect) {
      try {
        const monitors = await availableMonitors();
        const boxes = monitors.map((m) => ({
          x: m.position.x,
          y: m.position.y,
          w: m.size.width,
          h: m.size.height,
        }));
        const rect = clampRect(rec.rect, boxes);
        await win.setSize(new PhysicalSize(rect.w, rect.h));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
      } catch {
        // 위치를 못 옮겨도 내용은 다 돌아왔다.
      }
    }
    if (rec.maximized) {
      try {
        await win.maximize();
      } catch {
        // 같은 이유로 무시한다.
      }
    }
    return true;
  }, []);

  // --- 이 창은 무엇인가 (§5의 다중 창) ----------------------------------
  //
  // 창 N개가 모두 같은 `index.html`을 띄우므로 창 스스로는 자기 정체를 모른다. **탭 도착
  // 리스너를 붙인 뒤에** Rust에 묻는다 — 묻기 전에 온 꾸러미는 `arrivals`로 함께 돌아오므로
  // 사이로 빠지는 틈이 없다(`winmgr.rs`의 주석).
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current) return undefined;
    askedRef.current = true;
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void (async () => {
      unlisten = await win.listen<unknown>(TAB_ARRIVE_EVENT, (e) => receiveRef.current(e.payload));
      const info = await windowBoot();
      labelRef.current = info.label;
      setBoot(info);
    })();
    return () => unlisten?.();
  }, []);

  // 설정과 `window_boot`을 **둘 다** 받은 다음에 한 번. 설정의 `시작` 값이 세션을 열지
  // 버릴지를 정하고, `boot.role`이 이 창이 세션을 읽는 창인지를 정한다.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (!loaded || boot === null || bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      // 1) 세션 기록을 받아 태어난 창 — 그 기록만 되살린다.
      if (boot.role === "restore" && boot.record !== null) {
        await applySession(boot.record);
        setSessionReady(true);
        return;
      }
      // 2) 새 창(Ctrl+Shift+N) 또는 떼어낸 탭을 받으러 태어난 창.
      if (boot.role === "fresh") {
        expectArrivalRef.current = boot.empty;
        const seed = boot.tint;
        if (seed !== null) {
          setTabs((old) => old.map((tab, i) => (i === 0 ? { ...tab, tint: seed } : tab)));
        }
        // 떼어낸 탭이 `boot` 전에 도착했으면 여기서 받는다.
        for (const payload of boot.arrivals) receiveRef.current(payload);
        setSessionReady(true);
        return;
      }
      // 3) 첫 창 — 세션 파일을 읽는 **유일한** 창이다.
      //
      // 명령줄 파일을 먼저 꺼낸다(두 번 읽히지 않게). 여는 것은 세션 복원 뒤다 —
      // 그래야 그 파일의 탭이 맨 끝에 오고 활성이 된다.
      const files = await takeCliFiles();
      if (startupRef.current === "fresh") {
        await clearSession();
      } else {
        const file = await loadSession();
        if (file !== null) {
          const { mine, others, focusMine } = splitSession(file);
          // 아직 창이 아닌 기록은 Rust가 들고 있는다 — 그러지 않으면 내가 세션을 쓰는
          // 순간 그 창들이 인덱스에서 사라진다(§5: 다음 실행에 모든 창이 돌아온다).
          await adoptWindows(others);
          if (mine !== null) await applySession(mine);
          let boxes: MonitorBox[] = [];
          try {
            boxes = (await availableMonitors()).map((m) => ({
              x: m.position.x,
              y: m.position.y,
              w: m.size.width,
              h: m.size.height,
            }));
          } catch {
            // 모니터를 못 읽으면 저장된 자리를 그대로 쓴다.
          }
          // 만드는 순서는 "활성 창이 맨 나중"이다 — `window_create`가 만든 창에 포커스를
          // 주므로 마지막에 만든 창이 앞에 선다(`splitSession`이 그 순서로 준다).
          for (const rec of others) {
            await windowCreate({
              role: "restore",
              record: rec,
              rect: rec.rect === null ? null : clampRect(rec.rect, boxes),
              maximized: rec.maximized,
            });
          }
          if (focusMine && others.length > 0) {
            try {
              await getCurrentWindow().setFocus();
            } catch {
              // 포커스를 못 가져와도 창은 다 떴다.
            }
          }
        }
      }
      setSessionReady(true);
      for (const path of files) await openPathRef.current(path);
    })();
  }, [applySession, boot, loaded]);

  // 다른 창이 설정을 바꿨다 — **앱 전체 값만** 즉시 따라간다(지시 1의 규칙):
  // 테마·언어·상태 표시줄·글자 뒤 배경·시작 동작.
  //
  // **창별 값은 받지 않는다**(`settings.ts`의 `WINDOW_KEYS`): 메모지 색은 탭의 성질이고
  // (§5), 형광펜 색과 메모 목록은 창 하나의 성질이다. 이것을 심으면 창 A에서 색을 고르거나
  // 목록을 열었을 때 창 B도 같이 바뀐다(사용자가 보고한 버그). `adopt`가 창별 칸에 내
  // 현재 값을 넣어 돌려주므로 심어도 무해하지만, 아예 심지 않아 규칙을 눈에 보이게 둔다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<unknown>(SETTINGS_EVENT, (e) => {
        const next = store.adopt(e.payload);
        setThemeChoice(next.theme);
        setStatusBar(next.statusBar);
        setTextBacking(next.textBacking);
        setTrayNoticeShown(next.trayNoticeShown);
        setStartup(next.startup);
        startupRef.current = next.startup;
        setFontFamily(next.fontFamily);
        setFontSize(next.fontSize);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // --- 모든 창 공통의 메모 목록 ------------------------------------------
  //
  // 창마다 **자기 요약만** 올리고(`window_put_tabs`), Rust가 창 목록 순서대로 모아 모든
  // 창에 보낸다. 세션 기록을 재활용하지 않은 이유는 `src-tauri/src/winmgr.rs`의
  // `Inner.notes` 주석에 있다(세션은 1.5초 디바운스에 `새 세션` 모드에서는 아예 쓰지
  // 않으므로 그 모드에서 목록이 영원히 빈다).
  //
  /**
   * 같은 내용을 두 번 올리지 않는 자리 — `shown`은 렌더마다 새 배열이라 `mySummary`도
   * 렌더마다 새 객체다(글자를 칠 때마다 모든 창에 알리게 된다).
   */
  const summaryKey = JSON.stringify(mySummary);
  const summaryRef = useRef(mySummary);
  summaryRef.current = mySummary;

  useEffect(() => {
    // `boot`이 돌아오기 전에는 내 라벨을 모른다 — 그 전에 올리면 내 메모가 한순간
    // `다른 창`에 뜬다(Rust가 라벨을 덮으므로 `activateTab`은 어긋나지 않는다).
    if (!boot) return undefined;
    // 탭 이름을 한 글자씩 고치는 동안 창마다 다시 그리지 않게 디바운스한다.
    const timer = window.setTimeout(() => void putTabs(summaryRef.current), 200);
    return () => window.clearTimeout(timer);
  }, [boot, summaryKey]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten: UnlistenFn[] = [];
    void win
      .listen<WindowNotes[]>(NOTES_EVENT, (e) =>
        setAllNotes(Array.isArray(e.payload) ? e.payload : [])
      )
      .then((fn) => unlisten.push(fn));
    // 다른 창의 메모를 누른 쪽이 보낸 요청 — 그 탭(숨은 탭이면 되살려)을 활성으로.
    void win
      .listen<string>(ACTIVATE_TAB_EVENT, (e) => {
        const uid = e.payload;
        const mine = tabsRef.current.find((tb) => tb.uid === uid);
        if (!mine) return;
        if (mine.hidden) setTabs((old) => old.map((tb) => (tb.id === mine.id ? { ...tb, hidden: false } : tb)));
        setActiveId(mine.id);
        activeRef.current = mine.id;
      })
      .then((fn) => unlisten.push(fn));
    return () => unlisten.forEach((fn) => fn());
  }, []);

  // --- 최근 연 파일 (앱 전체 하나) ---------------------------------------
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void (async () => {
      unlisten = await win.listen<string[]>(RECENT_EVENT, (e) =>
        setRecent(Array.isArray(e.payload) ? e.payload : [])
      );
      setRecent(await recentList());
    })();
    return () => unlisten?.();
  }, []);

  /**
   * 최근 파일 줄을 눌렀다. 기존 열기 규칙 그대로다: **이미 어디 열려 있으면 그 창·탭으로**
   * (목록은 안 열린 파일만 보여 주지만, 보이는 사이에 다른 창이 열었을 수 있다).
   * 파일이 없어졌으면 오류 카드가 뜨고 **목록에서 저절로 빠진다**(판단: 지워진 파일 줄을
   * 남겨 두면 다음에도 같은 오류를 보게 되고, "뺄까요?"를 한 번 더 묻는 것은 메모장답지
   * 않다 — 목록에서 빠지는 것은 파일에 아무 일도 하지 않는다).
   */
  const openRecent = useCallback(
    (path: string) => {
      void (async () => {
        const holder = allNotes.find(
          (win) =>
            win.label !== myLabel && win.tabs.some((tb) => tb.path !== null && samePath(tb.path, path))
        );
        if (holder) {
          const tab = holder.tabs.find((tb) => tb.path !== null && samePath(tb.path, path));
          if (tab) {
            await activateTab(holder.label, tab.uid);
            return;
          }
        }
        if (!(await openPathRef.current(path))) await recentRemove(path);
      })();
    },
    [allNotes, myLabel]
  );

  // --- 세션 쓰기 ---------------------------------------------------------
  //
  // 창을 닫을 때 쓰는 것이 §5의 규칙이고 그쪽은 `closeWindow`가 한다. 여기 디바운스된
  // 쓰기를 **더 둔 것은 원본에 없는 판단**이다: 원본은 `WM_QUERYENDSESSION`으로
  // Windows 종료를 직접 받아 그때 세션을 썼는데 Tauri에는 그 자리가 없다. 로그오프·
  // 종료·강제 종료·개발 중 재시작에서 글을 잃지 않게 하려면 변경 뒤 한 번씩 써 두는
  // 길밖에 없다. 쓰기는 임시 파일 → rename이라 중간에 죽어도 이전 세션이 멀쩡하다.
  useEffect(() => {
    if (!sessionReady || startup !== "restore") return undefined;
    const timer = window.setTimeout(() => {
      void writeSession(tabsRef.current);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [sessionReady, startup, docVersion, tabs, activeId, maximized, writeSession]);

  // --- 알림 (§4 · §5의 예외) --------------------------------------------
  //
  // 저장·스케줄·발생·토스트·트레이는 전부 Rust다(`src-tauri/src/reminders.rs`,
  // `toast.rs`): 창이 여럿이어도 **한 번만** 울려야 하고, 창이 하나도 없을 때도 울려야
  // 한다(§7). 이 창이 하는 일은 셋이다.
  //   1) 상태를 받아 메뉴(`예약된 알림`)·상태 글자·숨은 탭을 맞춘다.
  //   2) 토스트를 누른 요청을 받아 그 탭을 되살리고 알림 범위를 선택한다.
  //   3) 예약을 넣는다(예약 창) · 취소한다(예약 목록). **예약 목록의 줄 클릭은
  //      2)와 같은 `reveal`을 부른다** — 되살리기 길이 둘이면 둘이 어긋난다.

  /** 알림 범위를 그 탭에서 선택한다 — 원본 `ReminderReveal`의 세 조건 그대로. */
  const revealIn = useCallback((tab: Tab, req: RevealRequest) => {
    const h = peekHost(tab.id) ?? hostOf(tab.id, tab.format);
    const text = h.plainText();
    const a = req.selStart;
    const b = req.selEnd;
    // 기억해 둔 범위가 아직 문서 안에 있고, 그 범위의 글이 **그대로 읽히면** 그 범위다
    // (글이 수정돼 사라졌는데 엉뚱한 자리를 선택해 주는 것이 가장 나쁜 답이다).
    if (a >= 0 && b > a && b <= text.length && flattenText(text.slice(a, b)) === req.text) {
      h.selectHit({ from: a, to: b });
      h.focus();
      return;
    }
    // 글이 **움직였을** 뿐인 흔한 경우(위에 몇 줄이 끼어들었다) — 앞부분으로 찾는다.
    // 저장된 글은 **한 줄로 눌린** 것이라 원문에서 그대로 찾을 수 없다(여러 줄 선택이면
    // 절대 못 찾는다) — 그 규칙을 아는 `findFlattened`가 찾는다.
    // 못 찾으면 창만 앞으로 온 것으로 끝낸다(원본과 같다 — 아무 데나 선택하지 않는다).
    const hit = findFlattened(text, req.text);
    if (hit === null) return;
    h.selectHit(hit);
    h.focus();
  }, []);

  /**
   * 되살릴 범위를 **다음 커밋까지** 들고 있는 자리.
   *
   * `setTimeout(0)`으로 하면 편집기가 아직 mount되지 않았거나 스크롤 복원이 그 뒤에 와서
   * 선택·스크롤이 유실된다(점검 2026-11-12). 아래 효과는 `[tabs, activeId]`가 커밋된
   * **뒤**에 돌고, React는 효과를 자식부터 돌리므로 그때 `Editor`는 이미 붙어 있다.
   */
  const pendingRevealRef = useRef<{
    uid: string | null;
    path: string | null;
    req: RevealRequest;
  } | null>(null);

  /** 들고 있던 요청을 지금 상태에 대고 적용해 본다 — 아직 때가 아니면 그대로 둔다. */
  const flushReveal = useCallback(() => {
    const pend = pendingRevealRef.current;
    if (pend === null) return;
    const list = tabsRef.current;
    const want = pend.path;
    const tab =
      (pend.uid === null ? undefined : list.find((tb) => tb.uid === pend.uid)) ??
      (want === null ? undefined : list.find((tb) => tb.path !== null && samePath(tb.path, want)));
    // 아직 활성이 아니거나 숨은 채라면 편집기가 없다 — 다음 커밋에서 다시 본다.
    if (tab === undefined || tab.hidden || tab.id !== activeRef.current) return;
    pendingRevealRef.current = null;
    revealIn(tab, pend.req);
  }, [revealIn]);

  /** 토스트를 눌렀다 — 그 탭(숨은 탭이면 되살려)을 활성으로 하고 범위를 선택한다. */
  const reveal = useCallback(
    async (req: RevealRequest) => {
      const mine = tabsRef.current.find((tb) => tb.uid === req.tabUid);
      if (mine) {
        // 아무것도 안 바뀌면 렌더도 없다 → 효과도 안 돈다. 그때는 여기서 바로 적용한다.
        const willRender = mine.hidden || activeRef.current !== mine.id;
        pendingRevealRef.current = { uid: mine.uid, path: mine.path, req };
        if (mine.hidden) {
          const next = tabsRef.current.map((tb) =>
            tb.id === mine.id ? { ...tb, hidden: false } : tb
          );
          setTabs(next);
          tabsRef.current = next;
        }
        setActiveId(mine.id);
        activeRef.current = mine.id;
        // 그 탭의 편집기가 화면에 붙는 것은 다음 커밋이다 — 선택은 그 뒤 효과에서 한다.
        if (!willRender) flushReveal();
        return;
      }
      // 그 탭이 이 창에 없다. 파일 탭이면 그 파일을 열어 그 글로 데려간다 — 원본의
      // "같은 문서가 열려 있어야 한다"는 조건을 지키지 못하는 경우의 가장 가까운 동작이다.
      const path = req.docPath;
      if (path === null) return;
      // 요청을 **열기 전에** 걸어 둔다: `openPath`가 커밋을 일으키므로 뒤에 걸면 효과가
      // 이미 지나가 버린다. 못 열었으면 걷어낸다.
      pendingRevealRef.current = { uid: null, path, req };
      const wasTabs = tabsRef.current;
      const wasActive = activeRef.current;
      if (!(await openPathRef.current(path))) {
        pendingRevealRef.current = null;
        return;
      }
      // 이미 열려 있고 이미 활성인 파일이면 바뀐 것이 없다 → 커밋도 효과도 없다.
      // 그때만 여기서 적용한다(그 탭의 편집기는 이미 붙어 있다).
      if (tabsRef.current === wasTabs && activeRef.current === wasActive) flushReveal();
    },
    [flushReveal]
  );

  /** 리스너가 늘 **지금의** `reveal`을 부르게 하는 자리. */
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  // 상태 — 한 번 묻고(리스너를 붙이기 전에 바뀐 값), 그 뒤로는 이벤트로 따라간다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void (async () => {
      unlisten = await win.listen<ReminderState>(REMINDERS_EVENT, (e) =>
        setReminders({ pending: e.payload?.pending ?? [], held: e.payload?.held ?? [] })
      );
      setReminders(await fetchReminderState());
    })();
    return () => unlisten?.();
  }, []);

  // 토스트 클릭. 살아 있는 창에는 이벤트로 오고, **방금 만들어진 창**(트레이에 상주하던
  // 중에 토스트를 눌렀을 때)은 리스너가 붙기 전이라 Rust가 남겨 둔 요청을 꺼내 간다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<RevealRequest>(REMINDER_REVEAL_EVENT, (e) => void revealRef.current(e.payload))
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // 커밋이 끝난 뒤 되살릴 범위를 적용한다. React는 효과를 **자식부터** 돌리므로 이때
  // `Editor`의 mount·스크롤 복원은 이미 끝났다 — `setTimeout(0)`이 못 지키던 순서다.
  useEffect(() => {
    flushReveal();
  }, [tabs, activeId, flushReveal]);

  useEffect(() => {
    if (!sessionReady) return;
    void (async () => {
      const req = await takeReveal();
      if (req !== null) await revealRef.current(req);
      // 이제 "이 숨은 탭을 되살려야 하는가"를 안다 — 그전까지 reconcile은 아무도 안 치웠다.
      setRevealChecked(true);
    })();
  }, [sessionReady]);

  // 알림 상태 → 탭 목록. `Tab.reminder`를 맞추고 **알림이 끝난 숨은 탭을 치운다**(§5).
  useEffect(() => {
    if (reminders === null) return;
    // `revealChecked`가 아직 거짓이면 **숨은 탭을 치우지 않는다**: 카드 클릭으로 복원된
    // 창은 `reminder_take_reveal`의 답을 받기 전이고, 그 사이에 온 `held=[]`를 믿으면
    // 되살릴 탭을 치워 버린다(그리고 뒤이은 세션 쓰기의 `gc_buffers`가 버퍼까지 지운다).
    const result = reconcileReminderTabs(tabsRef.current, reminders, revealChecked);
    const changed =
      result.dropped.length > 0 ||
      result.tabs.length !== tabsRef.current.length ||
      result.tabs.some((tab, i) => tab !== tabsRef.current[i]);
    // 숨은 탭만 남은 창은 **바뀐 것이 없어도** 세워 줘야 한다: 알림이 아직 붙들려
    // 있으면 `reconcile`은 아무것도 고치지 않는데, 그 창의 탭 줄은 비어 있다.
    // `revealChecked`도 본다: 되살릴 탭을 알기 전에 빈 탭을 세우면 되살린 탭 옆에
    // 군더더기 탭이 하나 남는다(`sessionReady`를 보는 이유와 같은 이유다).
    const empty =
      sessionReady &&
      revealChecked &&
      (result.tabs.length === 0 || onlyHiddenLeft(result.tabs));
    if (!changed && !empty) return;
    for (const id of result.dropped) dropHost(id);
    /*
     * 치우고 나니 **보일 탭이 하나도 없다** → 빈 탭 하나를 세운다.
     *
     * 그러지 않으면 **탭 줄이 빈 창**이 남는다(점검에서 잡은 버그): 알림이 끝난 뒤
     * 트레이에서 창을 열면 탭은 0개인데 편집 영역에는 직전 문서가 그려지고, 거기에
     * 치는 글은 어느 탭에도 속하지 않아 세션에도 들어가지 않는다 — 조용히 잃는다.
     *
     * 빈 탭을 고른 이유: **메모장은 창이 열려 있는 동안 탭이 늘 하나 이상이다.**
     * (`onlyHiddenLeft`는 "창을 닫는다"는 쪽으로 쓰려고 적어 둔 판정이지만, 사용자가
     * 트레이에서 방금 열라고 한 창을 즉시 닫으면 "열리지 않는다"처럼 보인다. 어느
     * 쪽을 할지는 사용자 결정이라 보고에 적었다 — 지금은 글을 잃지 않는 쪽이다.)
     *
     * `sessionReady`를 보는 이유: 복원이 끝나기 전에는 탭 목록이 한순간 비어 있을 수
     * 있고, 그때 빈 탭을 세우면 되살릴 탭 옆에 군더더기 탭이 하나 남는다.
     */
    const blank = empty ? createTab(defaultTint) : null;
    const next = blank === null ? result.tabs : [...result.tabs, blank];
    tabsRef.current = next;
    setTabs(next);
    if (blank !== null) {
      setActiveId(blank.id);
      activeRef.current = blank.id;
    }
  }, [defaultTint, reminders, revealChecked, sessionReady]);

  // 창 닫기 요청(✕ · Alt+F4 · Windows 종료 요청)을 가로채 닫기 규칙을 태운다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .onCloseRequested((event) => {
        // 규칙이 끝난 뒤 `destroy()`로 실제로 닫는다 — 여기서 막지 않으면 묻는 사이에
        // 창이 먼저 사라진다.
        event.preventDefault();
        void closeWindow();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [closeWindow]);

  // `끝내기`가 모든 창에 보낸 요청 — 창마다 자기 닫기 규칙(§5)을 돌린다.
  // **앱 전체 종료**이므로 `trigger: "app"`이다: 창이 여럿일 때 창마다 저장 확인이
  // 줄줄이 뜨면 종료가 끝나지 않는다(메모장도 종료에서는 묻지 않는다).
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen(CLOSE_REQUEST_EVENT, () => {
        void closeWindow(undefined, "app");
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [closeWindow]);

  /*
   * Windows **종료·로그오프·재시작**(§5의 예외).
   *
   * Rust가 `WM_QUERYENDSESSION`에서 알려 준다(`src-tauri/src/shutdown.rs` — tao는 그
   * 메시지를 처리하지 않으므로 창에는 `WM_CLOSE`도, `onCloseRequested`도 오지 않는다).
   * 그래서 **여기가 종료 때 세션을 쓰는 유일한 자리**다: 묻지 않고(물을 수 없다 —
   * Windows는 답을 기다려 주지 않는다) 디바운스를 기다리지 않고 바로 쓴 뒤 Rust에
   * 끝났다고 알린다. Rust는 `WM_ENDSESSION`에서 그 알림을 기다린 뒤 종료로 넘어간다.
   *
   * `새 세션`(fresh) 설정이면 **쓰지 않는다** — 그 설정은 "미저장 변경을 버린다"는
   * 뜻이고, 평소에도 이 모드는 세션을 쓰지 않고 시작할 때 세션을 지운다. 종료 때만
   * 보관하면 설정과 반대가 된다.
   *
   * 깃발을 `endingRef`에도 둔다 — 종료 중에 닫기 요청이 들어오면 `closeWindow`가
   * 묻지 않고 지나가야 한다(`windowCloseMode`의 `ending`).
   */
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<boolean>(SESSION_ENDING_EVENT, (e) => {
        const ending = e.payload !== false;
        endingRef.current = ending;
        if (!ending) return;
        void (async () => {
          if (startupRef.current === "restore") await writeSession(tabsRef.current);
          await sessionEndingFlushed();
        })();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [writeSession]);

  /*
   * 종료 때 **물어야 하는가**를 Rust에 보고해 둔다(사용자 결정 2026-11-12).
   *
   * `WM_QUERYENDSESSION`은 동기적으로 답해야 해서 그 순간 프론트에 물어볼 틈이 없다
   * (`src-tauri/src/shutdown.rs`). 그래서 판정이 바뀔 때마다 — 미저장 변화 · 탭 추가·닫기 ·
   * 시작 설정 변경 · 이 창이 생길 때 — 미리 보고한다. 창이 사라질 때는 Rust의
   * `Destroyed`가 치운다(창이 부서진 뒤에는 커맨드가 닿지 못한다).
   */
  useEffect(() => {
    void setShutdownPrompt(needsShutdownPrompt({ startup, tabs }));
  }, [startup, tabs]);

  /*
   * Windows 종료를 **보류하고 묻는다** — `새 세션` 설정 + 보이는 미저장 탭(사용자 결정).
   *
   * Rust가 `WM_QUERYENDSESSION`에 `FALSE`로 답하고 종료 보류 이유를 등록한 뒤 이 이벤트를
   * 보낸다. 여기서는 **평소 `새 세션` 닫기를 그대로** 돌린다(`closeWindow` → `askThenDiscard`:
   * 탭마다 저장/저장 안 함/취소, 알림이 걸린 탭은 두 번째 확인). 다 답하면 창이 닫히고,
   * `취소`면 창은 그대로 남는다 — 어느 쪽이든 보류 이유를 지운다(종료를 계속할지는
   * Windows가 사용자에게 묻는다). 묻는 중에 같은 이벤트가 또 와도 다시 띄우지 않는다.
   */
  const askingEndRef = useRef(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen(SESSION_ENDING_ASK_EVENT, () => {
        if (askingEndRef.current) return;
        askingEndRef.current = true;
        void (async () => {
          try {
            await closeWindowRef.current(undefined, "window");
          } finally {
            askingEndRef.current = false;
            await sessionEndingAnswered();
          }
        })();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // 이미 실행 중일 때 들어온 파일 — 이 창에 **새 탭**으로 열린다(단일 인스턴스, §5).
  // 창을 앞으로 올리는 것은 Rust 쪽(`cli::on_second_instance`)이 한다.
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win
      .listen<string[]>(OPEN_FILES_EVENT, (e) => {
        void (async () => {
          for (const path of e.payload) await openPathRef.current(path);
        })();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // --- 오버레이 · 테이프(항상 위) ---
  //
  // 한 효과로 묶는 이유: `overlay.rs`의 `set_overlay(false)`가 **항상 위를 내린다**.
  // 그래서 오버레이를 끈 **다음에** 테이프 상태를 다시 얹어야 한다(순서가 뒤집히면
  // 고정 중에 오버레이를 껐을 때 창이 뒤로 내려간다).
  useEffect(() => {
    void (async () => {
      await setOverlayNative(overlay);
      try {
        await getCurrentWindow().setAlwaysOnTop(overlay || pinned);
      } catch {
        // 창이 닫히는 중이면 무시한다.
      }
    })();
  }, [overlay, pinned]);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: UnlistenFn | undefined;
    void win.listen<boolean>("overlay-hover", (e) => setOverlayHover(e.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // 오버레이일 때만 "클릭을 잡아야 하는 영역"을 계속 보낸다. 메뉴·팝오버·목록 패널이
  // 열리고 닫히는 것도 영역을 바꾸므로 문서 전체를 지켜본다(rAF로 묶여 한 프레임 1회).
  useEffect(() => {
    if (!overlay) return undefined;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        void sendHitRects(editorRef.current);
      });
    };
    schedule();

    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-hit", "style", "class", "data-dock"],
    });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(document.body);
    window.addEventListener("resize", schedule);
    // 편집 영역 스크롤은 버블링하지 않으므로 캡처 단계에서 받는다.
    window.addEventListener("scroll", schedule, true);
    // DPI 변경이나 놓친 레이아웃 변화를 위한 안전망 (1초).
    const safety = window.setInterval(schedule, 1000);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(safety);
    };
  }, [overlay]);

  return (
    <div
      className="win"
      data-maximized={maximized ? "1" : "0"}
      data-overlay={overlay ? "1" : "0"}
      data-pinned={tapeOn ? "1" : "0"}
      data-overlay-hover={overlayHover ? "1" : "0"}
      data-hover={hover ? "1" : "0"}
      data-dock={dockVisible ? "1" : "0"}
      data-backing={backing ? "1" : "0"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {!uiHidden && showNoteList && (
        <NoteList
          tabs={shown}
          activeId={activeId}
          rail={listKind === "rail"}
          others={others}
          recent={recentShown}
          onSelectTab={setActiveId}
          onCloseTab={closeTab}
          onNewTab={newTab}
          // 다른 창의 메모: 그 창을 앞으로 + 그 탭을 활성(메모는 원래 창에 남는다).
          onPickOther={(note: OtherNote) => void activateTab(note.label, note.uid)}
          onPickRecent={openRecent}
          onDropRecent={(path) => void recentRemove(path)}
          onReorder={reorderTab}
          // 머리 버튼은 제 폭 목록이든 막대든 **목록을 끈다**(사용자 보고 4) —
          // 위 줄 목록 버튼·☰ 메뉴와 같은 토글이다.
          onClose={() => setNoteList(false)}
          zoneRef={zoneRef}
          onTear={beginTear}
          tearing={tearing}
          dropAt={dropAt}
        />
      )}

      <div className="main">
        {!uiHidden && (
          <TitleBar
            tabs={shown}
            activeId={activeId}
            listMode={listKind}
            onSelectTab={setActiveId}
            onCloseTab={closeTab}
            onNewTab={newTab}
            onReorder={reorderTab}
            onToggleNoteList={() => setNoteList((on) => !on)}
            onSystemMenu={openSystemMenu}
            onOpenMenu={openAt}
            zoneRef={zoneRef}
            onTear={beginTear}
            tearing={tearing}
            dropAt={dropAt}
          />
        )}

        <div className="content">
          <Editor
            editorRef={editorRef}
            host={host}
            onChange={refresh}
            onContextMenu={openEditMenu}
          />
          {!uiHidden && (
            <ToolDock
              opacity={opacity}
              onOpacity={setOpacity}
              highlight={highlight}
              overlay={overlay}
              commands={commands}
              onOpenMenu={openAt}
              opacityOpen={opacityOpen}
              onOpacityOpen={setOpacityOpen}
              moreOpen={moreOpen}
              onMoreOpen={setMoreOpen}
              menuBtnRef={dockMenuRef}
              canFormat={query.canFormat}
              bold={query.bold}
              strike={query.strike}
              heading={query.heading}
              bullet={query.bullet ?? false}
              penOn={penOn}
              onTable={(el) => openTableGrid(anchorOf(el))}
              onOverlay={(on: boolean) => setOverlay(on)}
            />
          )}
          {!uiHidden && find.open && (
            <FindBar
              state={find}
              status={findStatus}
              focusKey={findFocus}
              onChange={(patch) => {
                setFindMessage("");
                setFind((old) => ({ ...old, ...patch }));
              }}
              onStep={findStep}
              onReplace={findReplace}
              onReplaceAll={findReplaceAll}
              onClose={closeFind}
            />
          )}
          {!uiHidden && (
            <StatusText
              stats={{
                ...stats,
                enc: current?.enc ?? "utf8",
                eol: current?.eol ?? "lf",
                bigMd: current?.bigMd ?? false,
              }}
              overlay={overlay}
              shown={statusBar}
              reminder={reminders === null ? "" : reminderStatusText(reminders.pending)}
              zoom={zoom}
              collide={statusCollide}
            />
          )}
        </div>
      </div>

      {/* 테이프 — 시안 Pin. 고정 중에는 **이것만** 남는다.
          클릭: 오버레이 중이면 오버레이를 끄고(그때 테이프는 오버레이 전 `pinned`로
          돌아간다), 아니면 고정을 켜고 끈다. */}
      <Tape
        on={tapeOn}
        onToggle={() => {
          if (overlayRef.current) setOverlay(false);
          else setPinned((on) => !on);
        }}
        onSystemMenu={openSystemMenu}
      />

      {openMenu && (
        <Popup
          menu={openMenu.menu}
          state={menuState}
          position={openMenu.position}
          onAction={runAction}
          onClose={() => setOpenMenu(null)}
        />
      )}

      {tableAnchor && (
        <TableGrid
          anchor={tableAnchor}
          onPick={(rows, cols) => {
            setTableAnchor(null);
            runEditor(() => host.exec({ t: "table", rows, cols }));
          }}
          onClose={() => setTableAnchor(null)}
        />
      )}

      {/* 알림 예약 창 — 고른 시각만 받아 `addReminder`로 넘긴다(§4의 유일한 입구). */}
      {remindPick && (
        <RemindPick
          anchor={remindPick.anchor}
          text={flattenText(remindPick.req.text)}
          onSet={(due) => {
            const req = remindPick.req;
            setRemindPick(null);
            // 예약 확인은 **상태 글자**(`알림 예약됨 — 시각`)가 한다 — 원본과 같이
            // 메시지 박스를 띄우지 않는다. 상태는 Rust가 모든 창에 알린다.
            void addReminder({ ...req, due });
          }}
          onClose={() => setRemindPick(null)}
        />
      )}

      {/* 예약 목록 — **예약이 하나라도 있을 때만** 그려진다: 마지막 하나가 취소되거나
          울려서 목록에서 빠지면 그 자리에서 닫힌다(시안 글 · 원본과 같다). */}
      {remindList && reminders !== null && reminders.pending.length > 0 && (
        <RemindList
          anchor={remindList.anchor}
          placement={remindList.placement}
          items={reminders.pending}
          onOpen={(r: Reminder) => {
            setRemindList(null);
            // 토스트를 누른 것과 **같은 길**이다 — 숨은 탭을 되살리고 범위를 다시 고른다.
            void reveal({
              tabUid: r.tabUid,
              docPath: r.docPath,
              selStart: r.selStart,
              selEnd: r.selEnd,
              text: r.text,
            });
          }}
          onCancel={(r: Reminder) => void cancelReminder(r.id)}
          onClose={() => setRemindList(null)}
        />
      )}

      {settingsOpen && (
        <Settings
          state={menuState}
          onAction={runAction}
          onClose={() => setSettingsOpen(false)}
          onOpenMenu={openAt}
        />
      )}

      {dialog && <Dialog spec={dialog} />}

      <ResizeEdges />
      <div className="overlay-outline" />
    </div>
  );
}
