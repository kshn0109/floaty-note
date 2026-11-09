/**
 * 시간/날짜 넣기 — **Windows 11 메모장의 `편집 › 시간/날짜`(F5)**.
 *
 * 메모장이 하는 것: 커서 자리에 **사용자 로캘의 짧은 시간(초 없음) + 공백 + 짧은 날짜**를
 * 한 번에 넣는다(한국어 기준 `오후 11:30 2026-11-09`). 선택이 있으면 그 자리를 덮는다.
 * 실행 취소 한 번으로 되돌아가고, 문서는 수정 상태가 된다 — 그냥 글자를 친 것과 같다.
 *
 * 글자를 **Windows에 물어보는** 이유: 브라우저의 `Intl`은 같은 로캘에서도 다른 글자를
 * 준다(`2026. 11. 9.`). 메모장과 똑같아야 하므로 `GetTimeFormatEx`/`GetDateFormatEx`를
 * 쓰는 Rust 명령(`syscmd::time_date_stamp`)을 부르고, 그게 실패할 때만 `Intl`로 흉내 낸다.
 */

import { invoke } from "@tauri-apps/api/core";

/** 이 모듈이 키보드 이벤트에서 보는 것만(시험이 가짜 이벤트를 만들 수 있게). */
export interface KeyChord {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 시간/날짜를 넣는 키인가 — **맨 F5 하나**다(메모장과 같다).
 * 조합키가 붙은 F5는 메모장에 없는 조합이고, 브라우저에서는 "캐시 무시 새로 고침"이다.
 */
export function isTimeDateKey(e: KeyChord): boolean {
  return e.code === "F5" && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

/**
 * WebView2가 **페이지를 새로 고치는** 키인가 — F5 계열과 Ctrl+R 계열.
 *
 * 전부 막아야 한다: 새로 고침이 걸리면 열려 있던 탭·커서·실행취소가 통째로 날아간다
 * (개발 중에는 Vite가 다시 띄워 줘서 티가 덜 나지만 배포판에서는 그대로 잃는다).
 * Alt가 끼면 브라우저 단축키가 아니므로 건드리지 않는다.
 */
export function isReloadKey(e: KeyChord): boolean {
  if (e.altKey) return false;
  if (e.code === "F5") return true;
  return e.ctrlKey && e.code === "KeyR";
}

/**
 * Windows가 못 알려 줄 때의 대체 글자. 메모장과 완전히 같지는 않지만 같은 짜임
 * (짧은 시간 + 공백 + 짧은 날짜)이다.
 */
export function fallbackStamp(now: Date): string {
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString();
  return `${time} ${date}`;
}

/** 넣을 글자 한 줄. Rust가 실패하면 `fallbackStamp`. */
export async function timeDateStamp(): Promise<string> {
  try {
    const s = await invoke<string>("time_date_stamp");
    if (typeof s === "string" && s.trim() !== "") return s;
  } catch {
    // 아래 대체 글자로 간다.
  }
  return fallbackStamp(new Date());
}

/**
 * 고스트 탭·토스트처럼 **편집기가 없는 작은 페이지**에서도 새로 고침만은 막는다.
 * 그 창들이 다시 뜨면 끌고 있던 탭이나 알림 카드가 사라진다.
 */
export function blockReloadKeys(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isReloadKey(e)) e.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
