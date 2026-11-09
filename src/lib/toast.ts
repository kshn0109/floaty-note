/**
 * 토스트 카드의 **수명 계산**만. 그리는 쪽은 `src/toast.ts`(경량 페이지)이고,
 * 창을 만들고 쌓고 치우는 쪽은 Rust(`src-tauri/src/toast.rs`)다.
 *
 * 왜 수명을 페이지가 세는가: "마우스를 올리면 정지"는 포인터가 카드 **안에** 있는지를
 * 아는 쪽만 할 수 있고, 그것을 아는 것은 그 창의 webview다. Rust가 커서를 폴링해
 * 판정하면 다른 창이 토스트 위에 겹칠 때 틀린다.
 */

import type { Tint } from "./theme";

/** 8초 후 닫힘(원본 `kToastLifeMs`). */
export const TOAST_LIFE_MS = 8000;
/** 되는지 보는 주기(원본 `kToastTickMs`). */
export const TOAST_TICK_MS = 250;

/** 카드 하나의 수명 상태. */
export interface ToastLife {
  /** 이 시각이 지나면 닫힌다(`Date.now()` 기준). */
  dueAt: number;
  /** 포인터가 카드 안에 있는가. */
  hot: boolean;
}

/**
 * 한 번의 tick. 원본 `ToastProc`의 `WM_TIMER`와 **같은 두 줄**이다:
 *
 *   * 포인터가 안에 있으면 카운트다운을 계속 밀어 둔다(= 멈춘다).
 *   * 아니면 시각이 지났는지 본다.
 *
 * 포인터가 빠질 때는 **처음부터 다시** 센다(원본 `WM_MOUSELEAVE`: 카드를 읽고 있었으므로
 * 남은 1초를 이어 세는 것은 읽던 사람에게 가혹하다). 그 자리는 `leave()`다.
 */
export function toastTick(life: ToastLife, now: number): { dueAt: number; close: boolean } {
  if (life.hot) return { dueAt: now + TOAST_LIFE_MS, close: false };
  return { dueAt: life.dueAt, close: now >= life.dueAt };
}

/** 포인터가 빠졌다 — 카운트다운을 처음부터 다시 센다. */
export function leave(now: number): ToastLife {
  return { dueAt: now + TOAST_LIFE_MS, hot: false };
}

/** 토스트 페이지가 Rust에게 받는 것(`toast_payload`). Rust의 `ToastPayload`와 1:1. */
export interface ToastPayload {
  /**
   * 무엇에 대한 카드인가.
   *   reminder  알림 하나. 본문을 누르면 그 문서·범위로 간다.
   *   notice    "트레이에서 계속 실행됩니다" 안내(원본 `kStrTrayNoticeBody`). 알림이
   *             아니라 앱에 대한 말이므로 누르면 창만 돌아온다(원본과 같다).
   */
  kind: "reminder" | "notice";
  /** 알림이 말할 글. `notice`면 빈 문자열이고 페이지가 문자열 표에서 가져온다. */
  body: string;
  /** 놓친 알림이면 그 시각(epoch 밀리초), 아니면 `null`. */
  missedAt: number | null;
  /** 그 알림이 걸린 탭의 메모지 색 — 카드가 그 탭의 종이색으로 뜬다(지시 3). */
  tint: Tint;
}
