/**
 * 다중 창 — Rust(`src-tauri/src/winmgr.rs`, `drag.rs`)로 가는 얇은 층.
 *
 * 창 N개는 **같은 프로세스**의 WebviewWindow이고 전부 `index.html`(= 같은 `App`)을
 * 띄운다(§7: 프로세스는 하나). 그래서 "나는 어떤 창인가"를 창 스스로 알 수 없고,
 * 뜰 때 Rust에 묻는다(`windowBoot`).
 *
 * 창마다 자기 탭·오버레이·불투명도를 갖고, 테마·언어·설정은 한곳에 저장된 뒤
 * `SETTINGS_EVENT`로 모든 창에 번져 나간다.
 */

import { invoke } from "@tauri-apps/api/core";

import type { SessionWindow, WinRect } from "./session";
import type { DropZone } from "./tearoff";
import type { Tint } from "./theme";
import type { TabTransfer } from "./transfer";

/** 탭 하나가 이 창에 도착했다(떼어내기·합치기). 꾸러미는 `thawTab`으로 걸러 읽는다. */
export const TAB_ARRIVE_EVENT = "inkwell://tab-arrive";
/** 끌고 있는 탭이 들어갈 자리를 내 탭 줄에 표시하라(`null`이면 지워라). */
export const DROP_MARK_EVENT = "inkwell://drop-mark";
/** 다른 창이 설정을 바꿨다. */
export const SETTINGS_EVENT = "inkwell://settings";
/** `끝내기` — 자기 닫기 규칙(§5)을 돌려라. */
export const CLOSE_REQUEST_EVENT = "inkwell://close-request";
/** 끌고 있는 동안 Rust가 보내는 커서 위치(화면 물리 픽셀, `[x, y]`). */
export const DRAG_MOVE_EVENT = "inkwell://drag-move";

export type WindowRole = "primary" | "restore" | "fresh";

export interface BootInfo {
  /** 이 창의 Tauri 라벨. 탭을 넘길 때 주소로 쓴다. */
  label: string;
  role: WindowRole;
  /** `restore`일 때 되살릴 세션 기록. */
  record: SessionWindow | null;
  /** `fresh`일 때 첫 탭이 물려받을 메모지 색. */
  tint: Tint | null;
  /** 참이면 **빈 탭을 만들지 않는다** — 떼어낸 탭이 곧 도착한다. */
  empty: boolean;
  /** 리스너를 붙이기 전에 도착한 꾸러미들(순서 그대로). */
  arrivals: unknown[];
}

/**
 * 이 창이 무엇인지 묻는다. **`App`의 첫 커맨드**이고, 탭 도착 리스너를 붙인 **뒤에**
 * 부른다 — 그 전에 온 꾸러미는 `arrivals`로 함께 돌아오므로 사이로 빠지는 틈이 없다.
 *
 * Rust가 대답하지 못하면(개발 중 커맨드 이름이 어긋났을 때 등) 첫 창처럼 동작한다 —
 * 창이 빈 화면으로 뜨는 것보다 낫다.
 */
export async function windowBoot(): Promise<BootInfo> {
  try {
    const info = await invoke<BootInfo>("window_boot");
    if (info && typeof info.label === "string") return info;
  } catch (err) {
    console.error("[Inkwell] window_boot 실패:", err);
  }
  return { label: "main", role: "primary", record: null, tint: null, empty: false, arrivals: [] };
}

export interface WindowSpec {
  role: WindowRole;
  record?: SessionWindow | null;
  tint?: Tint | null;
  empty?: boolean;
  rect?: WinRect | null;
  maximized?: boolean;
}

/** 창 하나를 만든다. 라벨을 돌려주고, 실패하면 `null`. */
export async function windowCreate(spec: WindowSpec): Promise<string | null> {
  try {
    return await invoke<string>("window_create", { spec });
  } catch (err) {
    console.error("[Inkwell] 창을 만들 수 없습니다:", err);
    return null;
  }
}

/** 그 창을 앞으로 올린다(탭을 합친 뒤). */
export async function windowFocus(label: string): Promise<void> {
  try {
    await invoke("window_focus", { label });
  } catch {
    // 못 올려도 탭은 그 창에 들어갔다.
  }
}

/** 탭 하나를 그 창으로 넘긴다. 받는 창이 아직 뜨지 않았으면 Rust가 담아 둔다. */
export async function tabTransfer(target: string, payload: TabTransfer): Promise<boolean> {
  try {
    await invoke("tab_transfer", { target, payload });
    return true;
  } catch (err) {
    console.error("[Inkwell] 탭을 넘길 수 없습니다:", err);
    return false;
  }
}

/** 내 탭 줄(놓을 자리)을 올린다. 창이 움직이거나 탭이 바뀔 때마다 다시 부른다. */
export async function publishDropZone(zone: DropZone): Promise<void> {
  try {
    await invoke("window_set_drop_zone", { zone });
  } catch {
    // 올리지 못하면 이 창은 드롭 대상이 되지 않을 뿐이다.
  }
}

/** 모든 창의 탭 줄. **이기는 순서**(마지막 활성 창이 앞)로 온다. */
export async function dropZones(): Promise<DropZone[]> {
  try {
    const list = await invoke<DropZone[]>("window_drop_zones");
    return Array.isArray(list) ? list.filter((z) => z && typeof z.label === "string") : [];
  } catch {
    return [];
  }
}

/** 끌고 있는 탭이 들어갈 자리를 대상 창의 탭 줄에 표시한다(`null`이면 모든 표시를 지운다). */
export async function markDrop(target: string | null, index: number | null): Promise<void> {
  try {
    await invoke("window_mark_drop", { target, index });
  } catch {
    // 표시가 안 보일 뿐 끌기는 계속된다.
  }
}

/** `끝내기` — 모든 창이 자기 닫기 규칙을 돌린다. */
export async function closeAllWindows(): Promise<void> {
  try {
    await invoke("app_close_all");
  } catch {
    // 못 보내도 이 창은 자기 길로 닫힌다.
  }
}

// --- 고스트 탭 -------------------------------------------------------------

/** 고스트 페이지가 그릴 값. 팔레트 색을 **끌고 있는 창이 계산해서** 넘긴다. */
export interface GhostPaint {
  name: string;
  dirty: boolean;
  /** 색 점. `null`이면 빈 동그라미. */
  dot: string | null;
  bar: string;
  hair: string;
  text: string;
  accent: string;
  dim: string;
}

export interface GhostSpec {
  /** 고스트 창 크기(물리 픽셀) — 끌고 있는 알약 그대로. */
  w: number;
  h: number;
  /** 누른 자리의 알약 안 상대 좌표(물리 픽셀). */
  grabX: number;
  grabY: number;
  paint: GhostPaint;
}

/** 끌기 시작 — 고스트를 커서 아래에 세우고 Rust가 커서를 따라 옮긴다. */
export async function dragBegin(spec: GhostSpec): Promise<boolean> {
  try {
    await invoke("drag_begin", { spec });
    return true;
  } catch (err) {
    console.error("[Inkwell] 고스트 탭을 띄울 수 없습니다:", err);
    return false;
  }
}

/** 끌기 끝(놓았거나 Esc). 고스트를 치운다. */
export async function dragEnd(): Promise<void> {
  try {
    await invoke("drag_end");
  } catch {
    // 고스트가 남아도 다음 끌기가 제자리에 다시 세운다.
  }
}
