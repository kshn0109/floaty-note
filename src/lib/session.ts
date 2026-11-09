/**
 * 세션 — 창 목록 → 탭 목록. 저장 위치는 `%APPDATA%\Inkwell-Tauri\session\`
 * (Rust `src-tauri/src/session.rs`가 쓴다. **원본 앱의 `%APPDATA%\Inkwell\`은 건드리지
 * 않는다** — MIGRATION_HANDOFF §7).
 *
 * 원본(`main.cpp`의 `session.tsv` v2)과 같은 뜻을 담지만 **모양은 JSON**이다: 원본은
 * 탭마다 칸 9개짜리 TSV라 칸을 더할 때마다 v1/v2 분기가 늘었고(실제로 그랬다), 우리는
 * 알림 참조·숨김·실행 취소처럼 더할 것이 남아 있다. JSON이면 모르는 키를 무시하고
 * 없는 키에 기본값을 주는 것으로 끝난다.
 *
 * **처음부터 창이 여럿인 형식**이다(지시).
 *
 *   session.json          { v, activeWindow, windows: [ { 창 기하 + tabs: [...] } ] }
 *   buf_<탭ID>.txt        미저장 탭의 글 = 그 탭을 저장했다면 나왔을 바이트
 *   buf_<탭ID>.hist.json  그 탭의 실행 취소 스택
 *
 * ## 다중 창 — **쓰는 곳은 Rust 하나다**
 *
 * 창마다 인덱스를 통째로 쓰면 마지막에 쓴 창만 남는다(먼저 쓴 창의 탭이 사라진다).
 * 그래서 창은 **자기 기록 하나만** 보내고(`putWindow`), Rust가 창별 스냅샷을 모아
 * 하나의 인덱스로 쓴다(`src-tauri/src/session.rs`). "먼저 닫은 창도 그 실행 동안
 * 보관해 다음 실행에 모든 창이 돌아온다"(§5)의 **얼린 창 목록도 Rust가 들고 있다** —
 * 그 목록이 프론트에 있으면 창마다 한 벌이 되어 창이 닫힐 때 그 벌이 사라진다.
 *
 * 그래서 이 파일에 남은 것은 **순수한 변환**(탭 상태 → 기록 + 버퍼, 글 → 기록,
 * 사라진 모니터 보정)과 Rust 커맨드를 부르는 얇은 함수뿐이다.
 *
 * 쓰기는 전부 임시 파일 → rename이고, 인덱스를 성공적으로 쓴 뒤에만 쓸모없어진
 * `buf_*`를 지운다(Rust 쪽). 인덱스가 이름을 대지 않는 `buf_*`는 전부 쓰레기이고,
 * 그 판정은 **모든 창의 모든 탭**을 모아 한다.
 */

import { invoke } from "@tauri-apps/api/core";

import type { DocFormat, TabDoc } from "./editor/DocHost";
import type { HistoryJSON } from "./editor/history";
import type { Encoding, Eol } from "./file";
import { TINTS, type Tint } from "./theme";
import { clampZoom, ZOOM_DEFAULT } from "./zoom";

/** 이 모듈이 쓰는 형식의 번호. 읽을 때 모르는 번호면 세션을 버린다(첫 실행처럼 뜬다). */
export const SESSION_VERSION = 1;

export interface SessionTab {
  /** `Tab.uid`. 버퍼 파일 이름의 재료이고 실행 사이에 안 바뀐다. */
  id: string;
  name: string | null;
  path: string | null;
  tint: Tint;
  dirty: boolean;
  format: DocFormat;
  enc: Encoding;
  eol: Eol;
  bigMd: boolean;
  /** §5의 예외(알림이 걸린 채 닫힌 탭) — 자리만. */
  hidden: boolean;
  reminder: string | null;
  /** 미저장 글이 들어 있는 파일 이름. 깨끗한 탭은 `null`(파일을 다시 읽는다). */
  buf: string | null;
  /** 실행 취소 스택이 들어 있는 파일 이름. 없으면 `null`. */
  hist: string | null;
  /** 커서/선택 — 편집기 엔진이 준 JSON 그대로(모양은 엔진의 것이다). */
  selection: unknown;
  scrollTop: number;
}

export interface SessionWindow {
  /** 창 하나를 가리키는 이름. 다중 창 단계가 쓴다. */
  id: string;
  /** **최대화되지 않은** 바깥 사각형(물리 픽셀) — 원본도 복원 사각형만 저장했다. */
  rect: WinRect | null;
  maximized: boolean;
  overlay: boolean;
  opacity: number;
  /** 테이프(항상 위) — 창마다의 성질이라 창마다 저장·복원한다(시안 Pin). */
  pinned: boolean;
  /**
   * 글자 크기(%) — 창 하나의 성질이다(`lib/zoom.ts`). 옛 세션에는 이 칸이 없으므로
   * 없으면 100%로 읽는다(모르는 키를 무시하고 없는 키에 기본값을 주는 이 형식의 규칙).
   */
  zoom: number;
  /** 활성 탭의 `uid`. */
  activeTab: string | null;
  tabs: SessionTab[];
}

export interface SessionFile {
  v: number;
  /** 앞으로 올릴 창의 번호(원본 `app` 줄). */
  activeWindow: number;
  windows: SessionWindow[];
}

export interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rust로 넘길 버퍼 하나. */
export interface SessionBuffer {
  name: string;
  text: string;
}

export function bufName(uid: string): string {
  return `buf_${uid}.txt`;
}

export function histName(uid: string): string {
  return `buf_${uid}.hist.json`;
}

// ---------------------------------------------------------------------------
// 쓰기 — 순수한 쪽: 탭 상태 → 기록 + 버퍼
// ---------------------------------------------------------------------------

/** 한 탭을 세션에 적기 위해 필요한 것 전부. `App`이 탭 하나당 하나를 만든다. */
export interface TabSnapshot {
  uid: string;
  name: string | null;
  path: string | null;
  tint: Tint;
  dirty: boolean;
  format: DocFormat;
  enc: Encoding;
  eol: Eol;
  bigMd: boolean;
  hidden: boolean;
  reminder: string | null;
  /** 그 탭 편집기의 `serialize()`. 없으면(한 번도 붙지 않은 탭) 빈 문서로 본다. */
  doc: TabDoc | null;
}

export interface WindowSnapshot {
  id: string;
  rect: WinRect | null;
  maximized: boolean;
  overlay: boolean;
  opacity: number;
  pinned: boolean;
  /** 글자 크기(%) — `lib/zoom.ts`. */
  zoom: number;
  activeUid: string | null;
  tabs: TabSnapshot[];
}

/**
 * 창 하나의 기록과 그 창이 써야 할 버퍼들.
 *
 * **미저장 탭만** 글을 쓴다(원본과 같다): 깨끗한 탭은 다음 실행에 파일을 다시 읽으므로
 * 파일이 진실이고, 세션에 사본을 둘 이유가 없다. 실행 취소 스택도 미저장 탭만 담는다 —
 * 깨끗한 탭은 디스크에서 다시 읽은 글에 옛 스텝을 얹는 셈이 되어 위험하다(원본은 복원
 * 때 스택을 아예 비웠다).
 */
export function windowRecord(win: WindowSnapshot): {
  record: SessionWindow;
  buffers: SessionBuffer[];
} {
  const buffers: SessionBuffer[] = [];
  const tabs: SessionTab[] = win.tabs.map((tab) => {
    const doc = tab.doc;
    let buf: string | null = null;
    let hist: string | null = null;
    if (tab.dirty) {
      buf = bufName(tab.uid);
      buffers.push({ name: buf, text: doc?.text ?? "" });
      const h = doc?.history;
      if (h && (h.done.length > 0 || h.undone.length > 0)) {
        hist = histName(tab.uid);
        buffers.push({ name: hist, text: JSON.stringify(h) });
      }
    }
    return {
      id: tab.uid,
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
      buf,
      hist,
      selection: doc?.selection ?? null,
      scrollTop: doc?.scrollTop ?? 0,
    };
  });
  return {
    record: {
      id: win.id,
      rect: win.rect,
      maximized: win.maximized,
      overlay: win.overlay,
      opacity: win.opacity,
      pinned: win.pinned,
      zoom: clampZoom(win.zoom),
      activeTab: win.activeUid,
      tabs,
    },
    buffers,
  };
}

/** 인덱스가 이름을 대는 버퍼 전부 — Rust의 정리 규칙이 남겨 둘 목록. */
export function referencedBuffers(file: SessionFile): string[] {
  const names: string[] = [];
  for (const win of file.windows) {
    for (const tab of win.tabs) {
      if (tab.buf) names.push(tab.buf);
      if (tab.hist) names.push(tab.hist);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// 읽기 — 순수한 쪽: 글 → 기록
// ---------------------------------------------------------------------------

function str(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rectOf(value: unknown): WinRect | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const w = num(r.w, 0);
  const h = num(r.h, 0);
  if (w <= 0 || h <= 0) return null;
  return { x: num(r.x, 0), y: num(r.y, 0), w, h };
}

function tabOf(value: unknown): SessionTab | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  const id = str(t.id, null);
  if (id === null || id === "") return null;
  const tint = TINTS.includes(t.tint as Tint) ? (t.tint as Tint) : "none";
  return {
    id,
    name: str(t.name, null),
    path: str(t.path, null),
    tint,
    dirty: bool(t.dirty),
    format: t.format === "plain" ? "plain" : "markdown",
    enc: (["utf8", "utf8Bom", "utf16le", "ansi"] as const).includes(t.enc as Encoding)
      ? (t.enc as Encoding)
      : "utf8",
    eol: (["lf", "crlf", "cr", "mixed"] as const).includes(t.eol as Eol) ? (t.eol as Eol) : "lf",
    bigMd: bool(t.bigMd),
    hidden: bool(t.hidden),
    reminder: str(t.reminder, null),
    buf: str(t.buf, null),
    hist: str(t.hist, null),
    selection: t.selection ?? null,
    scrollTop: num(t.scrollTop, 0),
  };
}

/**
 * 세션 파일을 읽는다. 모르는 형식이거나 깨졌으면 `null` — 첫 실행처럼 뜬다
 * (세션이 깨졌다고 앱이 뜨지 않으면 사용자가 할 수 있는 일이 없다).
 * **탭이 하나도 없는 창은 버린다**(원본과 같다).
 */
export function parseSession(text: string): SessionFile | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (num(file.v, 0) !== SESSION_VERSION) return null;
  const list = Array.isArray(file.windows) ? file.windows : [];
  const windows: SessionWindow[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const w = raw as Record<string, unknown>;
    const tabs = (Array.isArray(w.tabs) ? w.tabs : [])
      .map(tabOf)
      .filter((t): t is SessionTab => t !== null);
    if (tabs.length === 0) continue;
    windows.push({
      id: str(w.id, "") ?? "",
      rect: rectOf(w.rect),
      maximized: bool(w.maximized),
      overlay: bool(w.overlay),
      opacity: Math.max(10, Math.min(100, Math.round(num(w.opacity, 100)))),
      pinned: bool(w.pinned),
      // 옛 세션(이 칸이 없던 때)은 `undefined` → 100%.
      zoom: clampZoom(w.zoom === undefined ? ZOOM_DEFAULT : w.zoom),
      activeTab: str(w.activeTab, null),
      tabs,
    });
  }
  if (windows.length === 0) return null;
  const active = Math.round(num(file.activeWindow, 0));
  return {
    v: SESSION_VERSION,
    activeWindow: active >= 0 && active < windows.length ? active : 0,
    windows,
  };
}

// ---------------------------------------------------------------------------
// 창 위치 — 사라진 모니터 보정 (지시 6)
// ---------------------------------------------------------------------------

export interface MonitorBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 저장된 창 사각형을 **화면 안으로** 당긴다. 모니터를 뽑고 다시 켠 뒤 창이 보이지
 * 않는 자리에 복원되면 사용자가 손댈 방법이 없다.
 *
 * 규칙은 원본 `SessionRestore`의 네 줄 그대로다: 겹치는 면적이 가장 큰 모니터(없으면
 * 중심이 가장 가까운 모니터)를 고르고, 창의 왼쪽/위가 그 모니터 밖으로 거의 다 나갔으면
 * 모니터의 왼쪽 위로 붙인다. 크기는 바꾸지 않는다.
 */
export function clampRect(rect: WinRect, monitors: readonly MonitorBox[]): WinRect {
  if (monitors.length === 0) return rect;
  const area = (m: MonitorBox) => {
    const dx = Math.min(rect.x + rect.w, m.x + m.w) - Math.max(rect.x, m.x);
    const dy = Math.min(rect.y + rect.h, m.y + m.h) - Math.max(rect.y, m.y);
    return dx > 0 && dy > 0 ? dx * dy : 0;
  };
  let best = monitors[0];
  let bestArea = area(monitors[0]);
  for (const m of monitors.slice(1)) {
    const a = area(m);
    if (a > bestArea) {
      best = m;
      bestArea = a;
    }
  }
  if (bestArea === 0) {
    // 어느 모니터와도 겹치지 않는다 — 중심이 가장 가까운 모니터로 옮긴다.
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const m of monitors) {
      const dx = m.x + m.w / 2 - cx;
      const dy = m.y + m.h / 2 - cy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
  }
  let { x, y } = rect;
  const EDGE_X = 80;
  const EDGE_Y = 60;
  if (x > best.x + best.w - EDGE_X) x = best.x;
  if (y > best.y + best.h - EDGE_Y) y = best.y;
  if (x + rect.w < best.x + EDGE_X) x = best.x;
  if (y < best.y) y = best.y;
  return { x, y, w: rect.w, h: rect.h };
}

// ---------------------------------------------------------------------------
// 복원 — 읽은 세션을 "내 것"과 "창으로 만들 것"으로 가른다 (§5)
// ---------------------------------------------------------------------------

/**
 * 첫 창(`primary`)이 세션을 열 때의 나눔. 첫 기록은 **그 창이 직접** 되살리고(창을 하나
 * 더 만들어 첫 기록을 넣으면 빈 창이 하나 남는다), 나머지는 창으로 만들어야 한다.
 *
 * `activeWindow`가 가리키는 창이 **맨 나중에 포커스를 받아야** 하므로, 만들 순서는
 * "활성 창을 뺀 나머지 → 활성 창"이다. 활성 창이 첫 기록(= 내 것)이면 만들 것 중에
 * 활성이 없으므로 마지막에 내가 포커스를 되찾아야 한다(`focusMine`).
 */
export function splitSession(file: SessionFile): {
  mine: SessionWindow | null;
  others: SessionWindow[];
  focusMine: boolean;
} {
  const live = file.windows.filter((w) => w.tabs.length > 0);
  const mine = live[0] ?? null;
  const rest = live.slice(1);
  const activeIdx = file.activeWindow;
  const active = file.windows[activeIdx];
  const focusMine = mine !== null && active !== undefined && active.id === mine.id;
  if (!focusMine && active) {
    const at = rest.findIndex((w) => w.id === active.id);
    if (at >= 0) {
      const [one] = rest.splice(at, 1);
      rest.push(one);
    }
  }
  return { mine, others: rest, focusMine };
}

// ---------------------------------------------------------------------------
// 파일 — Rust 커맨드 (쓰기는 전부 Rust가 조립한다)
// ---------------------------------------------------------------------------

/** 저장된 세션. 없거나 깨졌으면 `null`. */
export async function loadSession(): Promise<SessionFile | null> {
  let text: string | null;
  try {
    text = await invoke<string | null>("session_load");
  } catch {
    return null;
  }
  if (typeof text !== "string" || text === "") return null;
  return parseSession(text);
}

export async function loadBuffer(name: string): Promise<string | null> {
  try {
    return await invoke<string>("session_load_buffer", { name });
  } catch {
    return null;
  }
}

/**
 * **이 창의** 기록과 버퍼를 보낸다. Rust가 다른 창의 기록과 모아 인덱스를 쓴다.
 *
 * **성공했을 때만 `ok`** — `false`면 부르는 쪽이 탭마다 D1로 묻는 길로 떨어진다
 * (§5: 조용히 닫는 길은 저장이 실제로 됐을 때만 간다).
 *
 * 탭이 하나도 없으면 아무것도 보내지 않고 성공한다(원본 R7: 빈 창은 "쓸 것이 없음 =
 * 성공"이어야 한다 — 그러지 않으면 탭을 전부 옮겨 빈 창이 닫힐 때 저장 프롬프트가 뜬다).
 */
export async function putWindow(win: WindowSnapshot): Promise<boolean> {
  if (win.tabs.length === 0) return true;
  const { record, buffers } = windowRecord(win);
  try {
    await invoke("session_put_window", { record: JSON.stringify(record), buffers });
    return true;
  } catch (err) {
    console.error("[Inkwell] 세션 저장 실패:", err);
    return false;
  }
}

/**
 * 이 창을 **얼린다**(§5: 먼저 닫은 창도 다음 실행에 돌아온다). 기록을 보낸 뒤,
 * 창을 닫기 직전에 부른다 — 저장이 성공했을 때만 부르는 것은 부르는 쪽의 책임이다
 * (실패해서 사용자가 `저장 안 함`을 골랐으면 그 답은 "버려라"는 뜻이다).
 */
export async function freezeWindow(): Promise<void> {
  try {
    await invoke("session_freeze_window");
  } catch (err) {
    console.error("[Inkwell] 창을 얼리지 못했습니다:", err);
  }
}

/**
 * 이 창을 세션에서 **지운다**(얼리지 않는다). 마지막 탭을 다른 창으로 합쳐 창이
 * 사라질 때의 길이다 — 그 탭은 다른 창에 살아 있으므로 여기서 되살아나면 복제된다.
 */
export async function forgetWindow(): Promise<void> {
  try {
    await invoke("session_forget_window");
  } catch {
    // 못 지워도 그 창은 탭이 0개라 `assemble`이 버린다.
  }
}

/** 읽어 온 세션 중 **아직 창이 아닌 기록들**을 Rust가 들고 있게 한다. */
export async function adoptWindows(records: readonly SessionWindow[]): Promise<void> {
  try {
    await invoke("session_adopt", { records: records.map((r) => JSON.stringify(r)) });
  } catch (err) {
    console.error("[Inkwell] 세션 창을 넘기지 못했습니다:", err);
  }
}

/** 닫기 규칙(§5)이 보는 수치 — 살아 있는 창(나 포함)과 얼린 창. */
export async function sessionCounts(): Promise<{ live: number; frozen: number }> {
  try {
    const counts = await invoke<{ live: number; frozen: number }>("session_counts");
    return { live: Math.max(1, counts?.live ?? 1), frozen: counts?.frozen ?? 0 };
  } catch {
    // 모르면 "나 말고도 있다"고 보는 쪽이 안전하다 — 세션을 지우지 않는다.
    return { live: 1, frozen: 1 };
  }
}

export async function clearSession(): Promise<void> {
  try {
    await invoke("session_clear");
  } catch {
    // 지우지 못해도 시작할 때 세션을 읽지 않으므로 동작에는 영향이 없다.
  }
}

/** 첫 실행의 명령줄 파일. 두 번 읽히지 않게 Rust 쪽에서 꺼내 온다. */
export async function takeCliFiles(): Promise<string[]> {
  try {
    const files = await invoke<string[]>("take_cli_files");
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
}

/** 두 번째 실행이 넘겨준 파일 — Rust `cli::OPEN_FILES_EVENT`와 같은 이름. */
export const OPEN_FILES_EVENT = "inkwell://open-files";

/** 미저장 탭의 실행 취소 스택. 없거나 깨졌으면 `null`. */
export function parseHistory(text: string): HistoryJSON | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object") return null;
    const h = value as Record<string, unknown>;
    if (!Array.isArray(h.done) || !Array.isArray(h.undone)) return null;
    return value as HistoryJSON;
  } catch {
    return null;
  }
}
