/**
 * 두 편집기 엔진(마크다운 = ProseMirror / 일반 텍스트 = CodeMirror 6)을 가리는 얇은 층
 * (설계 문서 §3-3).
 *
 * 위층(상태 글자·탭·메뉴·도구 줄·나중의 찾기 바와 파일 계층)은 **이 인터페이스만** 본다.
 * 그래서 모드가 둘인데 위층 코드는 한 벌이다.
 */

import type { HistoryJSON } from "./history";
import type { SearchHit, SearchQuery } from "./search";

export type { SearchHit, SearchQuery } from "./search";

export type DocFormat = "markdown" | "plain";

/** 제목 레벨. 0은 "제목 아님"(본문 단락). */
export type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 편집 명령 — 하나가 **실행 취소 한 번**이다. */
export type EditorCmd =
  | { t: "bold" }
  /** 취소선. 파일에는 `~~글자~~`. 굵게와 같은 규칙이고 일반 텍스트 모드에서는 꺼진다. */
  | { t: "strike" }
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  /**
   * 글머리 기호 목록 토글(Ctrl+Shift+8 · 승인된 시안 L1). 선택이 걸친 **줄마다** 항목이
   * 되고, 걸린 줄이 모두 항목이면 해제된다. 일반 텍스트 모드에는 목록이 없다.
   */
  | { t: "bullet" }
  /**
   * 형광펜. `color === null`이면 지우기.
   * `toggle: false`는 **펜 모드가 칠할 때** 쓴다 — 이미 그 색이면 아무 일도 하지 않는다
   * (토글이면 드래그할 때마다 칠했다 지웠다 한다).
   */
  | { t: "highlight"; color: string | null; toggle?: boolean }
  | { t: "table"; rows: number; cols: number }
  /** 커서가 든 표를 통째로 지운다(일반 텍스트 모드에는 표가 없으므로 `false`). */
  | { t: "deleteTable" }
  | { t: "insertText"; text: string }
  | { t: "delete" }
  | { t: "selectAll" };

/** 도구 줄 칩의 눌린 모양과 메뉴의 활성 여부를 정하는 값. */
export interface EditorQuery {
  bold: boolean;
  strike: boolean;
  heading: HeadingLevel;
  /**
   * 커서 줄이 글머리 기호 항목인가 — 도구 줄 `•≡`의 눌린 모양.
   *
   * **선택 속성**이다: 일반 텍스트 모드(`PlainHost`)에는 목록이 없어 늘 거짓이고,
   * 그쪽 파일을 건드리지 않아도 되게 비워 둘 수 있다.
   */
  bullet?: boolean;
  highlight: string | null;
  inTable: boolean;
  hasSelection: boolean;
  hasText: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 서식 명령을 쓸 수 있는가 — 일반 텍스트 모드에서는 false(사용자 결정 3). */
  canFormat: boolean;
}

/** 상태 글자(§9)에 필요한 값. 줄/칸은 **편집 중 논리 줄** 기준이다(§12-6). */
export interface DocStatsFull {
  lines: number;
  line: number;
  col: number;
  chars: number;
  selChars: number;
}

/** 무엇이 바뀌어서 알리는가. 사각형을 다시 보낼 시점 판단에 쓴다(§9-1). */
export type ChangeReason = "doc" | "selection" | "viewport";

/**
 * 탭 하나의 전체 상태. **문서 JSON을 쓰지 않는다** — 5MB 문서의 `doc.toJSON()`이
 * 44.7MB이고 텍스트는 5MB다. 파서가 결정적이라 같은 텍스트를 다시 파싱하면 노드 위치까지
 * 같은 문서가 나오므로 저장해 둔 스텝(위치 기반)이 그대로 유효하다(§10).
 */
export interface TabDoc {
  format: DocFormat;
  /** 읽은 원문(바이트 보존 기준). 새 문서는 `null`. */
  fileSrc: string | null;
  /** 지금 내용을 저장했을 때의 문자열 = `DocHost.save()`. */
  text: string;
  selection: unknown;
  scrollTop: number;
  history: HistoryJSON;
}

/**
 * 확대/축소에서 "읽던 자리"를 붙잡아 두는 표 — **맨 위에 보이던 줄** 하나다.
 *
 * Windows 11 메모장이 Ctrl+휠에서 하는 것이 이것이다: 글자 크기만 바뀌고 읽던 줄은
 * 그 자리에 남는다(커서로 뛰지 않는다 — 커서는 화면 밖에 있을 수도 있다).
 *
 * `ref`의 속은 엔진마다 다르다(마크다운: 블록 DOM 요소 / 일반 텍스트: 문서 위치).
 * 밖에서는 열지 않고 그대로 돌려주기만 한다.
 */
export interface TopAnchor {
  /** 맨 위까지 올라가 있었는가. 그러면 되돌릴 때도 그냥 맨 위다(1~2px 어긋나지 않게). */
  atTop: boolean;
  /** 엔진이 알아보는 그 줄의 신원. */
  ref: unknown;
  /** 그 줄의 윗변이 스크롤 영역 윗변에서 몇 px 아래였나(위로 걸쳐 있으면 음수). */
  delta: number;
}

export interface DocHost {
  readonly kind: DocFormat;

  // --- 화면에 붙이기 ---
  /**
   * 호스트의 DOM을 `el` 안에 넣는다. 탭마다 호스트가 하나이고 뷰는 살아 있으므로
   * 탭을 오갈 때 스크롤 위치·선택·실행취소가 그대로 남는다.
   */
  mount(el: HTMLElement): void;
  /** DOM만 떼어 낸다(뷰는 살아 있다). 탭을 떠날 때. */
  unmount(): void;
  /** 뷰를 완전히 버린다. 탭을 닫을 때. */
  destroy(): void;
  focus(): void;
  /** 스크롤 위치를 기억한다. 마크다운 모드는 겉 컨테이너가 스크롤하므로 밖에서 알려 준다. */
  noteScroll(top: number): void;
  /**
   * 확대/축소 **직전**에 "맨 위에 보이던 줄"을 적어 둔다(§확대/축소 — `lib/zoom.ts`).
   * 문서도 선택도 스크롤도 건드리지 않는 **읽기뿐인** 동작이다.
   */
  captureTopAnchor(): TopAnchor | null;
  /**
   * 적어 둔 줄을 다시 **같은 자리**로 되돌린다. `scale`은 바뀐 배율의 비율
   * (새 배율 ÷ 옛 배율)이고, 줄이 위로 걸쳐 있던 만큼을 같은 비율로 늘린다.
   */
  restoreTopAnchor(anchor: TopAnchor | null, scale: number): void;

  // --- 파일 계층과의 경계 — 늘 LF, BOM 없음, 문자열만 주고받는다 ---
  /** 원문을 base로 기억하고(§4-3) 스택을 비우고 커서를 맨 앞으로(원본 규칙). */
  load(text: string): void;
  /** 저장할 바이트(문자열). 손대지 않은 문서는 읽은 바이트 그대로 돌아온다. */
  save(): string;
  /**
   * **보이는 글자**만(마커 없이). 소프트 줄바꿈·블록 경계·표 칸 경계는 줄바꿈 하나다.
   * 마크다운 탭을 `.txt`로 저장할 때 쓰는 글자이고(원본 `PlainDocText`와 같은 자리),
   * 찾기의 건초더미도 이것이다(§8). 일반 텍스트 모드에서는 `save()`와 같다.
   */
  plainText(): string;
  /** 지금을 저장된 상태로 삼는다(파일 계층이 실제로 쓴 다음에 부른다). */
  markSaved(): void;
  isDirty(): boolean;

  // --- 편집 ---
  exec(cmd: EditorCmd): boolean;
  query(): EditorQuery;
  /**
   * 선택 범위를 직접 옮긴다(문서 위치 기준, `to`를 빼면 커서 하나).
   * 찾기/바꾸기의 `selectHit`(§8)과 알림 토스트가 "그 범위를 선택해 열기"를 할 때
   * 쓰는 자리이고, 단위 시험에서 범위를 만들 때도 쓴다. 트랜잭션이 아니므로
   * 수정 표시에 영향이 없다.
   */
  select(from: number, to?: number): void;
  /**
   * 선택된 글자(평문). 우클릭 메뉴의 복사·잘라내기가 쓴다 — 그 메뉴가 열리면 키보드
   * 초점이 팝업으로 가므로 `document.execCommand`가 듣지 않고, 클립보드에 직접 써야 한다.
   * (`Ctrl+C`/`Ctrl+X`는 우리가 가로채지 않으므로 브라우저가 서식까지 그대로 처리한다.)
   */
  selectedText(): string;
  /** 펜 모드의 색. `null`이면 꺼짐. 문서가 아니라 **UI 상태**다(§7). */
  setPen(color: string | null): void;

  undo(): boolean;
  redo(): boolean;

  // --- 찾기/바꾸기 (§8) ---
  /**
   * 문서 순서로 모든 일치. **정규식이 틀리면 `null`**(UI가 빨간 테두리를 그린다).
   * `repl`은 정규식 모드에서 `$1`·`$&`를 미리 채우는 데만 쓰인다.
   *
   * 모든 일치를 문서에 칠하지 않는다(원본의 의도적 선택 — 문서를 더럽히지 않는다).
   * 선택 변경은 `docChanged`가 아니므로 **검색만 한 뒤 저장하면 바이트가 같다**.
   */
  search(q: SearchQuery, repl?: string): SearchHit[] | null;
  /** 그 일치를 선택하고 화면 안으로 스크롤한다. */
  selectHit(hit: SearchHit): void;
  /** 하나를 바꾼다. 바뀐 글자는 일치가 시작하던 자리의 서식을 물려받는다(원본 규칙). */
  replaceHit(hit: SearchHit, text: string): boolean;
  /** 전부 바꾼다 — **한 트랜잭션**이라 `Ctrl+Z` 한 번에 되돌아간다. 반환은 바꾼 개수. */
  replaceAll(q: SearchQuery, text: string): number;
  /** 지금 선택을 평문 글자 번호로. 다음/이전 일치를 고를 때 쓴다. */
  selectionRange(): { from: number; to: number };
  /**
   * 일치 강조 — 시안 F2의 모양(일치 = hover 채움 r6, 현재 = accent 1px 테두리).
   * **데코레이션/CSS만** 쓰므로 문서 모델에 들어가지 않는다: 저장 바이트와 수정 표시에
   * 영향이 0이다(§9-2). `hits`가 비면 강조를 지운다.
   */
  setHits(hits: readonly SearchHit[], current: number): void;

  // --- 상태 글자 ---
  stats(): DocStatsFull;

  // --- 탭/창 (§10) ---
  serialize(): TabDoc;
  restore(doc: TabDoc): void;

  onChange(cb: (why: ChangeReason) => void): () => void;
}

/*
 * 다음 단계가 붙을 자리: 탭/창 이전(§10 — `serialize`/`restore`는 이미 있다)과
 * 세션 복원. 알림이 "그 문서·범위를 선택해 열기"를 할 때는 `select(from, to)`를 쓴다.
 */
