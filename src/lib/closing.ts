/**
 * 닫기 규칙의 **판정**만 모아 둔 곳 (§5).
 *
 * 창을 닫는 길은 여섯 군데(✕ · Alt+F4 · Ctrl+Shift+W · 끝내기 · 마지막 탭 닫기 ·
 * Windows 종료)이고 전부 같은 판정을 거쳐야 한다. 그 판정을 `App`의 비동기 흐름 안에
 * 섞어 두면 "묻는가"와 "세션을 쓰는가"를 눈으로만 확인할 수 있게 되므로 여기 떼어 뒀다
 * — 이 파일은 React도 Tauri도 모르는 순수 함수뿐이라 단위 시험으로 지킨다.
 */

import type { StartupMode } from "./settings";
import { shownTabs, type Tab } from "./tabs";

/**
 * 창을 닫을 때 무엇을 하는가.
 *
 *   askThenDiscard  설정이 `새 세션 시작 및 저장되지 않은 변경 내용 삭제`다.
 *                   미저장 탭마다 D1로 묻고(취소하면 닫기도 취소) 세션을 버린다.
 *   clearSession    남은 탭이 없다(마지막 탭을 닫았다). 세션을 **지운다** — 그대로
 *                   두면 방금 닫은 탭이 다음 실행에 돌아오고, 그것은 §5의
 *                   `저장 안 함 = 버림`과 반대다. **다른 창이나 얼린 창이 하나라도
 *                   있으면 지울 수 없다** — 그쪽 탭까지 버리는 셈이 된다.
 *   saveSession     기본값. **묻지 않고** 전부 세션에 저장하고 닫는다. 저장이
 *                   실패했을 때만 탭마다 묻는 길로 떨어진다(`saveFailed` 참고).
 */
export type WindowCloseMode = "askThenDiscard" | "clearSession" | "saveSession";

export interface WindowCloseInput {
  startup: StartupMode;
  /** 이 창에 남아 있는 탭의 수(**숨은 탭도 센다** — 세션에 남아야 하므로). */
  totalTabs: number;
  /**
   * **이 창 말고** 세션에 남는 창의 수 = 살아 있는 다른 창 + 이 실행에서 먼저 닫혀
   * 얼려 둔 창. 하나라도 있으면 세션을 지울 수 없다(그쪽 탭까지 버린다).
   */
  others: number;
}

export function windowCloseMode(input: WindowCloseInput): WindowCloseMode {
  if (input.startup === "fresh") return "askThenDiscard";
  if (input.totalTabs === 0 && input.others === 0) return "clearSession";
  return "saveSession";
}

/**
 * 탭마다 묻는 길에서 **묻게 될 탭**을 줄 순서대로. 깨끗한 탭은 묻지 않고, 숨은 탭도
 * 묻지 않는다(사용자가 볼 수 없는 탭을 두고 묻는 대화상자는 답할 수 없는 대화상자다 —
 * 원본 `ConfirmDiscardAllTabs`가 묻기 전에 그 탭을 앞으로 가져오는 것과 같은 이유다).
 */
export function tabsToPrompt(tabs: readonly Tab[]): Tab[] {
  return shownTabs(tabs).filter((tab) => tab.dirty);
}

/** 탭 하나를 닫을 때 물어야 하는가 — 원본 `ConfirmDiscard`의 첫 줄과 같다. */
export function tabCloseNeedsPrompt(tab: Pick<Tab, "dirty">): boolean {
  return tab.dirty;
}
