/**
 * 명령 id — **기능을 끼우는 자리를 한곳에 모아 둔 표**.
 *
 * 메뉴·단축키·도구 줄 버튼·우클릭 메뉴는 모두 여기 있는 id 하나를 가리킨다. 다음 단계에서
 * 파일·찾기를 구현할 때는 `App`이 넘기는 `CommandTable`에 같은 이름의 함수를 한 줄 더하면
 * 끝이고, 메뉴 정의(`menus.ts`)는 손대지 않는다.
 *
 * **표에 함수가 없는 id는 아무 일도 하지 않는다**(메뉴만 닫힌다). 지금 그런 것:
 * AI 패널 하나뿐이다(AI는 미완성이라 손대지 않는다).
 */

export const COMMAND_IDS = [
  // 파일 — Windows 11 메모장의 파일 메뉴 구성
  // (새 탭 Ctrl+N · 새 창 Ctrl+Shift+N · 열기 · 저장 · 다른 이름으로 · 모두 저장 ·
  //  탭 닫기 · 창 닫기 · 끝내기. 인쇄는 넣지 않는다.)
  //
  // 원본의 `새 문서`(지금 문서를 비우기)는 **없다**: 메모장 11에는 그 명령이 없고
  // 모든 문서가 탭이라 `Ctrl+N`이 새 탭이다. 원본에서 `새 문서`와 `새 탭`이 둘 다
  // 있었던 것은 탭이 나중에 붙은 구조 때문이다(지시: 이 구성으로 정리).
  "open",
  "save",
  "saveAs",
  "saveAll",
  "newWindow",
  // 탭/창
  "newTab",
  "closeTab",
  "closeWindow",
  "exit",
  // 찾기
  "find",
  "replace",
  // 기본 편집 (우클릭 메뉴 = 메모장 구성)
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "delete",
  "selectAll",
  // 확대/축소 — 본문 글자 크기(`lib/zoom.ts`). 메모장의 `보기 › 확대/축소` 세 줄과 같다.
  "zoomIn",
  "zoomOut",
  "zoomReset",
  // 서식
  "bold",
  // 취소선(Ctrl+Shift+X) — 도구 줄 버튼과 단축키가 들어오는 자리다. 우클릭 메뉴에는
  // 넣지 않는다(메모장 구성 유지).
  "strike",
  // 글머리 기호(Ctrl+Shift+8) — 도구 줄 `•≡` 버튼과 단축키가 들어오는 자리다
  // (승인된 시안 L1). 우클릭 메뉴에는 넣지 않는다(메모장 구성 유지).
  "bullet",
  "h1",
  "h2",
  "h3",
  "table",
  // 표 지우기 — 커서가 표 안일 때만 우클릭 메뉴에 나온다(사용자 보고: "표 삭제가 안 돼").
  "deleteTable",
  "highlight",
  "highlightOff",
  // 알림 — `remind`는 예약 창(년/월/일/시/분 휠 피커, `components/RemindPick.tsx`),
  // `remindList`는 예약 목록(`components/RemindList.tsx`)을 연다. 저장·스케줄·발생·
  // 토스트·트레이는 전부 Rust다(`src-tauri/src/reminders.rs`).
  "remind",
  "remindList",
  // 개발 빌드 전용 — 승인된 토스트(T2) 모양을 바로 띄워 본다(`import.meta.env.DEV`).
  // `devRemindSoon`은 **지웠다**(단계 10): 예약 창이 생겨 우회로가 필요 없다.
  "toastPreview",
  "toastPreviewMissed",
  // 그 밖
  "aiPanel",
  "settings",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/** `App`이 만들어 넘기는 표. 없는 id는 아직 기능이 없다는 뜻. */
export type CommandTable = Partial<Record<CommandId, () => void>>;

export function runCommand(table: CommandTable, id: CommandId): void {
  table[id]?.();
}
