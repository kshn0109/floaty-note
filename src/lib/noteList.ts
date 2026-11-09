/**
 * 메모 목록 — **모든 창 공통**(사용자 결정). 패널에 세 묶음이 차례로 들어간다.
 *
 *   ① 이 창의 메모(탭)        기존 그대로 — 끌기·✕·가운데 클릭 닫기가 다 된다.
 *   ② 다른 창에 열려 있는 메모  클릭 = 그 창을 앞으로 + 그 탭을 활성(메모는 원래 창에 남는다).
 *   ③ 최근 연 파일            지금 **어느 창에도** 열려 있지 않은 것만. 클릭 = 새 탭으로 열기.
 *
 * ## 채널 (Rust `winmgr.rs`)
 *
 * 창마다 자기 요약(`summaryOf`)을 `window_put_tabs`로 올리고, Rust가 **창 목록
 * 순서대로** 모아 모든 창에 `NOTES_EVENT`로 보낸다. 세션 기록을 재활용하지 않은 이유는
 * `winmgr.rs`의 `Inner.notes` 주석에 있다(세션 쓰기는 디바운스 1.5초이고 `새 세션`
 * 모드에서는 아예 쓰지 않는다 — 그러면 목록이 영원히 빈다).
 *
 * 이 파일은 **순수한 변환만** 들고 있다(시험이 보는 자리):
 * 숨긴 탭 빼기 · 내 창 빼기 · 이미 열린 파일을 최근 목록에서 빼기.
 */

import { invoke } from "@tauri-apps/api/core";

import { leafOf } from "./file";
import { shownTabs, type Tab } from "./tabs";
import type { Tint } from "./theme";

/** 다른 창에 알릴 메모 한 줄 — 그릴 때 필요한 것만. 글 내용은 보내지 않는다. */
export interface NoteSummary {
  uid: string;
  name: string | null;
  path: string | null;
  tint: Tint;
  dirty: boolean;
}

/** 창 하나의 요약. Rust는 이것을 창 목록 순서대로 늘어놓기만 한다. */
export interface WindowNotes {
  label: string;
  activeUid: string | null;
  tabs: NoteSummary[];
}

/** `다른 창` 묶음의 줄 하나 — 어느 창의 어느 탭인지 들고 있다. */
export interface OtherNote extends NoteSummary {
  label: string;
}

/** 모든 창의 메모 목록이 바뀌었다 — Rust `winmgr::NOTES_EVENT`와 같은 이름. */
export const NOTES_EVENT = "inkwell://notes";
/** 그 탭을 활성으로 만들어라 — Rust `winmgr::ACTIVATE_TAB_EVENT`와 같은 이름. */
export const ACTIVATE_TAB_EVENT = "inkwell://activate-tab";

/**
 * 이 창의 요약. **숨긴 탭(알림이 걸린 채 닫힌 탭)은 빠진다**(§5: 어느 탭 줄에도 보이지
 * 않는다 — 다른 창의 목록도 탭 줄이다).
 */
export function summaryOf(
  label: string,
  tabs: readonly Tab[],
  activeUid: string | null
): WindowNotes {
  return {
    label,
    activeUid,
    tabs: shownTabs(tabs).map((tab) => ({
      uid: tab.uid,
      name: tab.name,
      path: tab.path,
      tint: tab.tint,
      dirty: tab.dirty,
    })),
  };
}

/**
 * `다른 창` 묶음 — **내 창을 뺀** 모든 창의 메모를 창 순서대로 납작하게 늘어놓는다.
 *
 * 창마다 묶어 보여 주지 않는 이유(판단): 폭 168 패널에 창 머리를 더 넣으면 줄이 반으로
 * 줄고, 창에는 이름이 없어 `창 2` 같은 번호를 지어내야 한다 — 메모장에는 전례가 없다.
 * 창 순서대로 늘어놓으면 같은 창의 메모가 저절로 붙어 나오므로 묶음과 같은 순서다.
 */
export function otherNotes(all: readonly WindowNotes[], myLabel: string): OtherNote[] {
  const out: OtherNote[] = [];
  for (const win of all) {
    if (!win || win.label === myLabel) continue;
    for (const tab of win.tabs ?? []) out.push({ ...tab, label: win.label });
  }
  return out;
}

/**
 * `최근 파일` 묶음 — **지금 어느 창에도 열려 있지 않은** 파일만(사용자 결정).
 * 이미 열려 있으면 위의 ①·②에 그 메모가 이미 있으므로 같은 파일이 두 줄이 된다.
 */
export function recentRows(
  recent: readonly string[],
  all: readonly WindowNotes[],
  max = 10
): string[] {
  const open = new Set<string>();
  for (const win of all) {
    for (const tab of win?.tabs ?? []) {
      if (tab.path) open.add(normPath(tab.path));
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of recent) {
    if (typeof path !== "string" || path === "") continue;
    const key = normPath(path);
    if (open.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

/** 줄에 보일 이름 — 파일 이름만(전체 경로는 툴팁이다). */
export function recentLabel(path: string): string {
  return leafOf(path);
}

/** Windows의 파일 이름은 대소문자를 구별하지 않고 구분자가 둘이다(`App`의 `samePath`와 같다). */
function normPath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

// ---------------------------------------------------------------------------
// Rust 커맨드 — 얇은 층
// ---------------------------------------------------------------------------

/** 이 창의 요약을 올린다. 올리지 못해도 이 창의 목록은 제 것을 그대로 보여 준다. */
export async function putTabs(summary: WindowNotes): Promise<void> {
  try {
    await invoke("window_put_tabs", { summary });
  } catch {
    // 다른 창의 목록에 내가 안 보일 뿐이다.
  }
}

/** 다른 창의 메모를 눌렀다 — 그 창을 앞으로 가져오고 그 탭을 활성으로. */
export async function activateTab(label: string, uid: string): Promise<void> {
  try {
    await invoke("window_activate_tab", { label, uid });
  } catch {
    // 그 창이 막 닫혔을 수 있다 — 다음 목록 갱신에서 줄이 사라진다.
  }
}

// ---------------------------------------------------------------------------
// 최근 파일 — `%APPDATA%\Inkwell-Tauri\recent.json` (Rust `recent.rs`가 쓴다)
// ---------------------------------------------------------------------------

/** 최근 파일 목록이 바뀌었다 — Rust `recent::RECENT_EVENT`와 같은 이름. */
export const RECENT_EVENT = "inkwell://recent";

export async function recentList(): Promise<string[]> {
  try {
    const list = await invoke<string[]>("recent_list");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** 파일을 열거나 저장했다 — 맨 앞으로. 중복 제거·상한은 Rust가 한다(쓰는 곳이 하나다). */
export async function recentAdd(path: string): Promise<void> {
  try {
    await invoke("recent_add", { path });
  } catch {
    // 기록하지 못해도 파일은 열렸다/저장됐다.
  }
}

export async function recentRemove(path: string): Promise<void> {
  try {
    await invoke("recent_remove", { path });
  } catch {
    // 못 지워도 다음에 다시 누를 수 있다.
  }
}
