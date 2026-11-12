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
 *   askLoneTab      `이전 세션 복원`인데 **창을 직접 닫고**(✕ · Alt+F4 · Ctrl+Shift+W)
 *                   보이는 탭이 **하나뿐이며 미저장**이다. 사용자 결정(메모장과 다름):
 *                   그 탭 하나를 닫을 때와 똑같이 D1로 묻는다 — 탭이 하나인 창은
 *                   사용자에게 "글 하나"이고, 복원을 켜 뒀어도 닫기 전에 한 번
 *                   물어 주는 쪽이 낫다는 판단이다. 답에 따라 그 탭을 저장하거나
 *                   **버리고**(세션에서도 빠진다) 나머지는 평소처럼 보관한다.
 *   clearSession    남은 탭이 없다(마지막 탭을 닫았다) — 또는 `새 세션` 설정으로 쓰다
 *                   Windows가 종료되는 중이다(묻지 않고 버린다). 세션을 **지운다** — 그대로
 *                   두면 방금 닫은 탭이 다음 실행에 돌아오고, 그것은 §5의
 *                   `저장 안 함 = 버림`과 반대다. **다른 창이나 얼린 창이 하나라도
 *                   있으면 지울 수 없다** — 그쪽 탭까지 버리는 셈이 된다.
 *   saveSession     기본값. **묻지 않고** 전부 세션에 저장하고 닫는다. 저장이
 *                   실패했을 때만 탭마다 묻는 길로 떨어진다(`saveFailed` 참고).
 */
export type WindowCloseMode = "askThenDiscard" | "askLoneTab" | "clearSession" | "saveSession";

/**
 * 누가 창을 닫으라고 했는가.
 *
 *   window  **창 하나**를 닫는 길 — ✕ · Alt+F4 · Ctrl+Shift+W.
 *   app     **앱 전체 종료** — 트레이 `종료` · ☰ `끝내기`(모든 창에 한꺼번에 간다).
 *           메모장과 같이 **묻지 않는다**: 창마다 대화상자가 줄줄이 뜨면 종료가
 *           끝나지 않는다. `askLoneTab`은 이 길에서 켜지지 않는다.
 */
export type WindowCloseTrigger = "window" | "app";

export interface WindowCloseInput {
  startup: StartupMode;
  /** 이 창에 남아 있는 탭의 수(**숨은 탭도 센다** — 세션에 남아야 하므로). */
  totalTabs: number;
  /**
   * **이 창 말고** 세션에 남는 창의 수 = 살아 있는 다른 창 + 이 실행에서 먼저 닫혀
   * 얼려 둔 창. 하나라도 있으면 세션을 지울 수 없다(그쪽 탭까지 버린다).
   */
  others: number;
  /** 기본값은 `window` — 창 하나를 닫는 길. */
  trigger?: WindowCloseTrigger;
  /** 보이는 탭이 하나뿐이고 그 탭이 미저장인가(`loneDirtyTab`이 센다). */
  loneDirty?: boolean;
  /**
   * **Windows가 세션을 끝내는 중**인가(종료·로그오프·재시작 — Rust가
   * `WM_QUERYENDSESSION`에서 세우는 깃발, `sessionEnding()`).
   *
   * 참이면 `trigger`가 무엇이든 **묻지 않는다**: Windows는 답을 기다려 주지 않고,
   * 대화상자를 띄우면 종료가 막히거나 그대로 죽는다(메모장도 종료에서는 묻지 않는다).
   *
   * `새 세션` + 미저장 탭의 경우 묻는 길은 이 깃발이 **서기 전에** 따로 지난다:
   * Rust가 `WM_QUERYENDSESSION`에 `FALSE`로 답해 종료를 **보류**하고
   * `needsShutdownPrompt`·`SESSION_ENDING_ASK_EVENT`로 평소 `askThenDiscard`를 돌린다.
   * 이 깃발이 선 상태(= 종료가 실제로 진행된다)에서는 그때도 묻지 않고 버린다.
   */
  ending?: boolean;
}

export function windowCloseMode(input: WindowCloseInput): WindowCloseMode {
  const ending = input.ending === true;
  if (input.startup === "fresh") {
    // `새 세션` 설정은 "미저장 변경을 버린다"는 뜻이고, 평소에는 탭마다 묻고 버린다.
    // Windows 종료 때는 물을 수 없으므로 **묻지 않고 버린다** — 그 설정의 뜻 그대로다
    // (이 모드는 애초에 세션을 쓰지 않고, 시작할 때도 세션을 지운다).
    return ending ? "clearSession" : "askThenDiscard";
  }
  // 앱 전체 종료와 Windows 세션 종료는 묻지 않는다 — 창 하나를 닫는 길에만 D1이 붙는다.
  if (!ending && input.trigger !== "app" && input.loneDirty === true) return "askLoneTab";
  if (input.totalTabs === 0 && input.others === 0) return "clearSession";
  return "saveSession";
}

/**
 * 보이는 탭이 **하나뿐이고 미저장**이면 그 탭(아니면 `null`).
 *
 * 숨은 탭(알림만 걸려 있는 탭)은 세지 않는다 — 사용자 눈에는 없는 탭이고, 그 탭을
 * 두고 묻는 대화상자는 답할 수 없다(`tabsToPrompt`의 판단과 같다).
 */
export function loneDirtyTab(tabs: readonly Tab[]): Tab | null {
  const shown = shownTabs(tabs);
  return shown.length === 1 && shown[0].dirty ? shown[0] : null;
}

/**
 * 탭마다 묻는 길에서 **묻게 될 탭**을 줄 순서대로. 깨끗한 탭은 묻지 않고, 숨은 탭도
 * 묻지 않는다(사용자가 볼 수 없는 탭을 두고 묻는 대화상자는 답할 수 없는 대화상자다 —
 * 원본 `ConfirmDiscardAllTabs`가 묻기 전에 그 탭을 앞으로 가져오는 것과 같은 이유다).
 */
export function tabsToPrompt(tabs: readonly Tab[]): Tab[] {
  return shownTabs(tabs).filter((tab) => tab.dirty);
}

/**
 * **Windows 종료·로그오프·재시작을 보류하고 물어야 하는가**(사용자 결정 2026-11-12).
 *
 * `새 세션 시작 및 저장되지 않은 변경 내용 삭제`로 쓰는데 **보이는 미저장 탭이 하나라도**
 * 있으면 참이다 — 그 설정에서는 종료가 곧 "버림"이라 묻지 않고 지나가면 글이 사라진다.
 * `이전 세션 복원`은 거짓이다(묻지 않고 보관한다 — 전과 같다).
 *
 * 숨은 탭(알림만 걸려 있는 탭)은 세지 않는다 — `tabsToPrompt`가 묻지 않는 탭이고,
 * 물을 탭이 없는데 종료를 막으면 아무도 답할 수 없는 보류가 된다.
 *
 * 이 값은 상태가 바뀔 때마다 Rust로 보고한다(`setShutdownPrompt`): `WM_QUERYENDSESSION`은
 * **동기적으로** 답해야 해서 그때 프론트에 물어볼 틈이 없다(`src-tauri/src/shutdown.rs`).
 */
export function needsShutdownPrompt(input: {
  startup: StartupMode;
  tabs: readonly Tab[];
}): boolean {
  return input.startup === "fresh" && tabsToPrompt(input.tabs).length > 0;
}

/** 탭 하나를 닫을 때 물어야 하는가 — 원본 `ConfirmDiscard`의 첫 줄과 같다. */
export function tabCloseNeedsPrompt(tab: Pick<Tab, "dirty">): boolean {
  return tab.dirty;
}

/**
 * D1에서 `저장 안 함`을 골랐을 때 **두 번째 확인이 필요한 알림의 id**(없으면 `null`).
 *
 * 승인된 시안(`DiscardReminder.dc.html`)의 ②다: 알림이 걸린 탭을 저장하지 않고 버리면
 * 예약한 알림도 사라지므로 한 번 더 묻는다. `저장`은 파일이 진실이 되므로 묻지 않고,
 * `취소`는 이미 닫기를 그만둔 답이다. 알림이 없는 탭은 지금처럼 바로 닫힌다.
 *
 * 돌려주는 값이 **id**인 이유: 확인을 받은 뒤 취소할 알림을 부르는 쪽이 그대로 쓴다
 * (`cancelReminder`). 참/거짓만 주면 부르는 쪽이 `tab.reminder`를 다시 들여다봐야 한다.
 */
export function discardReminderToConfirm(
  tab: Pick<Tab, "reminder">,
  answer: "save" | "discard" | "cancel"
): string | null {
  return answer === "discard" ? tab.reminder : null;
}
