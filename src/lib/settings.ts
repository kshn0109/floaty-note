/**
 * 설정 — `%APPDATA%\Inkwell-Tauri\settings.json` (Rust `src/settings.rs`가 쓴다).
 *
 * 원본은 `HKCU\Software\Inkwell`에 REG_DWORD로 넣었다. Tauri 버전은 레지스트리를
 * **읽지도 쓰지도 않는다** — 원본 앱이 아직 사용자 PC에서 돌아가므로 둘이 서로
 * 덮어쓰면 사용자의 실제 설정이 날아간다(MIGRATION_HANDOFF §7).
 *
 * 항목은 원본의 레지스트리 항목 표와 1:1이다. 빠진 것은 AI 두 개(`AiMode`,
 * `AiPanel`)뿐 — AI는 아직 손대지 않는다.
 *
 *   Theme            → theme             어둡게 / 밝게 / 시스템
 *   MemoTint         → tint              메모지 색
 *   StatusBar        → statusBar         상태 글자 표시 (기본 켜짐)
 *   TextBacking      → textBacking       반투명일 때 글자 뒤 배경 (기본 켜짐)
 *   HighlightColor   → highlight         형광펜 색 인덱스 0~4
 *   TrayNoticeShown  → trayNoticeShown   "트레이에 남아 있습니다" 안내를 띄웠는지
 *
 * 원본에 없던 것 둘: `fontFamily`·`fontSize` — 설정 › 모양의 `글꼴` 카드(시안 G1,
 * 사용자 결정 2026-11-09). 원본에는 글꼴 설정이 없었다.
 *
 * 원본에 없던 것 하나: `noteList` — 시안 R5의 왼쪽 메모 목록을 켜 두었는지
 * (원본에는 그 패널이 없었다). 지시대로 상태를 기억한다.
 *
 * **불투명도는 일부러 저장하지 않는다.** 원본이 저장하지 않기 때문이다 —
 * "창을 닫으면 값은 저장되지 않고 다음 실행에서 다시 100%로 시작합니다"
 * (USAGE.ko.md §일반 모드 배경 투명도). 저장하길 원하면 `DEFAULTS`에 한 줄,
 * `sanitize`에 한 줄이면 된다.
 *
 * 모르는 키는 **그대로 보존**한다(`load`가 받은 원본 객체 위에 덮어쓴다). 다음
 * 단계에서 탭·세션 값이 붙어도 구버전이 지우지 않는다.
 *
 * `language`(원본 `UiLanguage`)는 **없어졌다**(사용자 결정 2026-11-09): UI 언어는
 * 항상 자동 — Windows 표시 언어를 따른다. 이전 버전이 저장한 `"ko"`/`"en"`이 파일에
 * 남아 있어도 **읽지 않는다**(모르는 키라 그대로 보존되고 아무 일도 하지 않는다).
 */

import { invoke } from "@tauri-apps/api/core";

import { FONT_DEFAULT, pickFontSize } from "./fonts";
import { THEME_CHOICES, TINTS, type ThemeChoice, type Tint } from "./theme";

/**
 * 시작할 때 무엇을 여는가 — 시안 S의 `Inkwell이 시작될 때`(§5).
 *
 *   restore  이전 세션의 콘텐츠 열기 (**기본값**). 창을 닫을 때 묻지 않고 전부 세션에
 *            저장하고 다음 실행에 그대로 복원한다.
 *   fresh    새 세션 시작 및 저장되지 않은 변경 내용 삭제. 창을 닫을 때 미저장 탭마다
 *            D1로 묻고, 시작할 때는 빈 탭 하나다.
 *
 * 메모장 11의 설정에 있는 그 항목이고 이름도 메모장의 것을 쓴다.
 */
export const STARTUP_MODES = ["restore", "fresh"] as const;
export type StartupMode = (typeof STARTUP_MODES)[number];

export interface Settings {
  theme: ThemeChoice;
  /**
   * 메모지 색. 원본에서는 **탭마다 갖는 값**이고(§5) 지금은 탭이 하나라 여기 있다.
   * 탭 목록이 생기면 이 자리는 "새 탭이 물려받을 기본값"이 된다.
   */
  tint: Tint;
  /**
   * 본문 글꼴 가족 이름. `""` = `기본`(지금 모습: 마크다운 탭 Segoe UI 계열 · 텍스트 탭
   * 고정폭). 시안 G1 · 사용자 결정 2026-11-09 — **전역 값**이라 모든 창·모든 탭이 같다.
   */
  fontFamily: string;
  /** 본문 글자 크기(pt). 기본 11 = 지금과 똑같은 15px (`lib/fonts.ts`의 `docSizePx`). */
  fontSize: number;
  statusBar: boolean;
  textBacking: boolean;
  highlight: number;
  /** 왼쪽 메모 목록 패널(시안 R5List)을 켜 두었는지. 기본은 꺼짐 = R5 그대로. */
  noteList: boolean;
  trayNoticeShown: boolean;
  startup: StartupMode;
}

export const DEFAULTS: Settings = {
  theme: "dark",
  tint: "none",
  fontFamily: FONT_DEFAULT,
  fontSize: 11,
  statusBar: true,
  textBacking: true,
  highlight: 0,
  noteList: false,
  trayNoticeShown: false,
  startup: "restore",
};

/** 저장 파일에서 읽은, 우리가 모르는 키까지 들고 있는 객체. */
let raw: Record<string, unknown> = {};
/**
 * 마지막으로 **쓴 값**(또는 다른 창에서 받아 그대로 믿기로 한 값).
 *
 * 다중 창의 되울림을 끊는 자리다: 창 A가 테마를 바꾸면 Rust가 창 B에 알리고, B의 상태가
 * 바뀌면 B의 저장 효과가 돌아 또 쓴다. 쓴 값이 받은 값과 같으면 **쓰지 않으면** 그
 * 고리가 한 바퀴에서 멈춘다(값이 같으니 파일도 이미 맞다).
 */
let lastWritten: Settings | null = null;

/**
 * **앱 전체 값** — 어느 창에서 바꾸든 모든 창이 즉시 따라간다(지시 1의 규칙).
 * 테마·상태 표시줄·글자 뒤 배경·시작 동작. `trayNoticeShown`은 보이는 값이 아니지만
 * "한 번만, 영원히"라 앱 전체 하나다.
 */
export const SHARED_KEYS = [
  "theme",
  // 글꼴·크기는 **전역**이다(사용자 결정 2026-11-09): 테마와 같은 부류라 어느 창에서
  // 바꾸든 모든 창이 따라간다. 창마다 따로인 것은 확대/축소(`--zoom`)뿐이다.
  "fontFamily",
  "fontSize",
  "statusBar",
  "textBacking",
  "trayNoticeShown",
  "startup",
] as const;

/**
 * **창마다 따로인 값** — 파일에는 남지만(마지막으로 고른 값 = 다음 창이 물려받는 기본값)
 * **다른 창이 받아 쓰지는 않는다**. 이것을 번지게 두면 창 A에서 형광펜 색을 고르거나
 * 메모 목록을 열었을 때 창 B도 같이 바뀐다(사용자가 보고한 버그).
 *
 *   tint       메모지 색 — **탭의 성질**이다(§5). 여기 있는 값은 새 탭·새 창의 기본값.
 *   highlight  형광펜 색 — 원본 레지스트리 `HighlightColor`처럼 앱 전체로 **기억**하되,
 *              열려 있는 다른 창의 펜 색을 바꾸지는 않는다(칠하거나 펜 모드를 켜는 일은
 *              애초에 이 길로 일어날 수 없다 — 칠하기는 명령이고 설정이 아니다).
 *   noteList   왼쪽 메모 목록이 열려 있는지 — 창 하나의 배치다(오버레이·불투명도·테이프와
 *              같은 부류). 원본에는 없던 패널이라 따를 전례가 없어 이렇게 판단했다.
 */
export const WINDOW_KEYS = ["tint", "highlight", "noteList"] as const;

const KEYS = [...SHARED_KEYS, ...WINDOW_KEYS] as const;

function same(a: Settings, b: Settings): boolean {
  return KEYS.every((k) => a[k] === b[k]);
}

/**
 * 다른 창이 보낸 설정에서 **앱 전체 값만** 골라 내 값에 얹는다. 창별 값은 내 것이 남는다.
 *
 * 순수 함수다 — 회귀 시험(`scripts/settings-sync.test.ts`)이 보는 자리가 여기다.
 */
export function mergeShared(mine: Settings, incoming: unknown): Settings {
  if (!incoming || typeof incoming !== "object") return mine;
  const from = sanitize({ ...toRecord(mine), ...(incoming as Record<string, unknown>) });
  const next = { ...mine };
  for (const key of SHARED_KEYS) {
    // 키마다 타입이 다르므로 한 줄로는 못 쓴다(TS가 공용체를 좁히지 못한다).
    assign(next, key, from[key]);
  }
  return next;
}

function toRecord(settings: Settings): Record<string, unknown> {
  return { ...settings };
}

function assign<K extends keyof Settings>(target: Settings, key: K, value: Settings[K]): void {
  target[key] = value;
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 값이 없거나 범위를 벗어나면 기본값 — 원본의 `LoadRegDword(name, fallback)`과 같다. */
function sanitize(input: Record<string, unknown>): Settings {
  const highlight = input.highlight;
  return {
    theme: pick(input.theme, THEME_CHOICES, DEFAULTS.theme),
    tint: pick(input.tint, TINTS, DEFAULTS.tint),
    // 글꼴 이름은 자유 문자열이다(PC마다 설치된 글꼴이 다르므로 목록으로 가둘 수 없다).
    // 없는 글꼴 이름이 남아 있어도 CSS가 폴백으로 떨어지므로 글자가 사라지지 않는다.
    fontFamily: typeof input.fontFamily === "string" ? input.fontFamily : DEFAULTS.fontFamily,
    fontSize: pickFontSize(input.fontSize),
    statusBar: bool(input.statusBar, DEFAULTS.statusBar),
    textBacking: bool(input.textBacking, DEFAULTS.textBacking),
    highlight:
      typeof highlight === "number" && Number.isInteger(highlight) && highlight >= 0 && highlight <= 4
        ? highlight
        : DEFAULTS.highlight,
    noteList: bool(input.noteList, DEFAULTS.noteList),
    trayNoticeShown: bool(input.trayNoticeShown, DEFAULTS.trayNoticeShown),
    startup: pick(input.startup, STARTUP_MODES, DEFAULTS.startup),
  };
}

/** 파일을 읽는다. 없거나 깨졌으면 기본값 — 첫 실행과 똑같이 동작한다. */
export async function load(): Promise<Settings> {
  try {
    const value = await invoke<unknown>("load_settings");
    raw = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
  } catch {
    raw = {};
  }
  const settings = sanitize(raw);
  lastWritten = settings;
  return settings;
}

/**
 * **다른 창이 바꾼 설정**을 받아들인다(`winmgr::SETTINGS_EVENT`). 파일은 그 창이 이미
 * 썼으므로 여기서 다시 쓰지 않는다 — `lastWritten`을 결과로 맞춰 두면 이 창의 저장
 * 효과가 한 바퀴 더 돌지 않는다.
 *
 * **받는 것은 앱 전체 값뿐이다**(`SHARED_KEYS`). 창별 값(`WINDOW_KEYS` — 메모지 색·
 * 형광펜 색·메모 목록)은 **내 것이 그대로 남는다**: 그렇지 않으면 창 A의 메뉴·형광펜이
 * 창 B에도 적용된다(사용자가 보고한 버그).
 *
 * 돌려주는 값의 창별 칸에는 **이 창의 현재 값**이 들어 있으므로 부르는 쪽이 그대로
 * 심어도 아무 일이 일어나지 않는다. 그래도 `App`은 앱 전체 값만 심는다 — 규칙이 두
 * 군데 다 적혀 있어야 한쪽이 흔들려도 번지지 않는다.
 */
export function adopt(value: unknown): Settings {
  const incoming = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  // 모르는 키는 보존한다(다음 쓰기가 지우지 않게). 창별 키는 **받지 않는다**.
  for (const [key, v] of Object.entries(incoming)) {
    if (!(WINDOW_KEYS as readonly string[]).includes(key)) raw[key] = v;
  }
  // 아직 디스크에 닿지 않은 내 변경(디바운스 중)이 있으면 그것이 내 현재 값이다.
  const next = mergeShared(pending ?? sanitize(raw), incoming);
  lastWritten = next;
  // 쓸 것이 남아 있었으면 공유 값까지 맞춰 둔 뒤 그대로 쓴다(내 창별 값을 잃지 않는다).
  if (pending) pending = next;
  return next;
}

let timer: number | undefined;
let pending: Settings | undefined;

async function flush(): Promise<void> {
  timer = undefined;
  if (!pending) return;
  lastWritten = pending;
  const settings = { ...raw, ...pending };
  pending = undefined;
  raw = settings;
  try {
    await invoke("save_settings", { settings });
  } catch (err) {
    // 설정은 못 써도 앱은 돌아가야 한다. 다음 변경에서 다시 시도한다.
    console.error("[Inkwell] 설정 저장 실패:", err);
  }
}

/**
 * 저장. 슬라이더나 메뉴를 빠르게 여러 번 눌러도 파일 쓰기는 한 번으로 묶인다
 * (원본은 레지스트리 한 값씩 바로 썼지만 여기는 파일 하나라 묶는 쪽이 맞다).
 */
export function save(settings: Settings): void {
  // 값이 안 바뀌었으면 쓰지 않는다 — 다중 창의 되울림을 여기서 끊는다(`lastWritten`).
  if (lastWritten !== null && same(lastWritten, settings)) return;
  pending = settings;
  if (timer !== undefined) return;
  timer = window.setTimeout(() => void flush(), 250);
}
