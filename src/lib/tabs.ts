/**
 * 탭 — 알약 탭(위 줄)과 메모 목록(왼쪽 패널)이 **같은 목록**을 다른 모양으로 보여 준다.
 *
 * 끌어서 순서 변경과 창 밖으로 떼어 내기는 탭 단계에서 함께 한다(지시).
 *
 * **문서 내용·커서·스크롤·실행 취소는 탭마다 따로**다. 그 상태는 살아 있는 객체라
 * React 상태가 아니라 `lib/editor/registry.ts`의 `Map`이 들고 있고, 여기 `Tab`은
 * 그것을 가리키는 열쇠(`id`)와 화면에 보이는 값(이름·색·수정 표시·형식)만 갖는다.
 *
 * 메모지 색은 **탭마다 갖는 값**이다(§5). 그래서 `Tab.tint`가 있고, 창 전체 팔레트는
 * "활성 탭의 색"으로 정해진다. 새 탭은 현재 탭 색을 물려받는다(§5).
 */

import type { DocFormat } from "./editor/DocHost";
import { formatOfName } from "./editor/mode";
import type { Encoding, Eol } from "./file";
import { leafOf } from "./file";
import { t } from "./i18n";
import type { Tint } from "./theme";

export interface Tab {
  id: number;
  /**
   * 세션에서 이 탭을 가리키는 **실행 사이에도 안 바뀌는 이름**. 미저장 버퍼 파일 이름이
   * `buf_<탭ID>`라서 필요하다(§7): 인덱스 번호로 이름을 붙이면 창이 여럿일 때 한 창의
   * 정리가 다른 창의 글을 지운다(원본 R15). `id`는 이 실행 안에서만 뜻이 있는 번호이고,
   * 편집기 레지스트리(`editor/registry.ts`)의 열쇠다 — 세션에는 `uid`가 들어간다.
   */
  uid: string;
  /** 파일 이름. 저장되지 않은 탭은 `null`이고 "제목 없음"으로 보인다. */
  name: string | null;
  /** 파일의 전체 경로. 아직 저장한 적이 없으면 `null`(그때 `저장`은 대화상자를 연다). */
  path: string | null;
  tint: Tint;
  /** 미저장 표시(accent 점 6px). 편집기의 `isDirty()`가 참값이다. */
  dirty: boolean;
  /** 마크다운/일반 텍스트. 확장자로 정한다(§5) — 제목 없음은 마크다운. */
  format: DocFormat;
  /**
   * 상태 글자에 보일 인코딩·줄바꿈. **디스크에 있던 것**이고, 저장하면 우리 저장 형식
   * (UTF-8 BOM 없음 + LF)으로 바뀐다 — 추측이 아니라 사실의 기술이다(원본 주석).
   */
  enc: Encoding;
  eol: Eol;
  /** 임계값(1MB)을 넘어 `.md`를 일반 텍스트로 열었는가 — 상태 글자에 안내가 붙는다(§11). */
  bigMd: boolean;
  /**
   * 알림이 걸린 탭을 `저장 안 함`으로 닫았을 때 **숨겨서 보관**하는 자리(§5의 예외).
   * 숨은 탭은 어느 탭 줄에도 보이지 않고 세션에는 그대로 남는다. 알림 단계가 이 값을
   * 켜고(토스트를 누르면 다시 끄고) 지금은 늘 `false`다 — 자리만.
   */
  hidden: boolean;
  /** 이 탭을 참조하는 알림의 id. 알림 단계의 자리이고 지금은 늘 `null`. */
  reminder: string | null;
}

let nextId = 1;
let uidCounter = 0;

/**
 * 세션용 탭 이름. 원본 `NewTabId()`와 같은 꼴(시각 + 세는 수)이라 **재부팅이나 다른
 * 실행과 겹칠 수 없고 눈으로 읽을 수 있다** — 세션 파일을 눈으로 디버깅할 수 있다는
 * 것이 원본이 GUID를 쓰지 않은 이유다. 파일 이름에 쓰이므로 글자는 `[0-9a-z]`뿐이다.
 */
export function newTabUid(): string {
  uidCounter += 1;
  const now = Date.now().toString(16).padStart(12, "0");
  const rand = Math.floor(Math.random() * 0x1000000)
    .toString(16)
    .padStart(6, "0");
  return `${now}-${rand}-${uidCounter.toString(16).padStart(4, "0")}`;
}

export function createTab(tint: Tint, name: string | null = null, uid = newTabUid()): Tab {
  const tab: Tab = {
    id: nextId,
    uid,
    name,
    path: null,
    tint,
    dirty: false,
    format: formatOfName(name),
    // 한 번도 저장하지 않은 빈 문서를 저장하면 그렇게 될 값(원본 `DoNew`와 같다).
    enc: "utf8",
    eol: "lf",
    bigMd: false,
    hidden: false,
    reminder: null,
  };
  nextId += 1;
  return tab;
}

/**
 * 저장 대화상자에 넣을 기본 이름. 제목 없음이면 편집 모드를 따른다 — 마크다운 탭(새 메모의
 * 기본)은 `제목 없음.md`, 일반 텍스트 탭은 `제목 없음.txt`. 서식을 넣은 글이 `.txt`로
 * 저장돼 다시 열 때 서식이 사라지는 일을 막는다(사용자 결정 2026-11-12, 11-09의 `.txt`
 * 기본을 바꿈).
 */
export function suggestedSaveName(tab: Tab): string {
  if (tab.path !== null) return leafOf(tab.path);
  return `${t("tabUntitled")}.${tab.format === "markdown" ? "md" : "txt"}`;
}

/** 화면에 보일 이름. "제목 없음"은 문자열 표에 있는 하나뿐이라 탭과 창 제목이 어긋나지 않는다. */
export function tabLabel(tab: Tab): string {
  return tab.name ?? t("tabUntitled");
}

export function activeTab(tabs: readonly Tab[], activeId: number): Tab | undefined {
  return tabs.find((tab) => tab.id === activeId);
}

/** 탭 줄에 보이는 탭만(숨은 탭 = 알림이 붙은 채 닫힌 탭은 어디에도 안 보인다). */
export function shownTabs(tabs: readonly Tab[]): Tab[] {
  return tabs.filter((tab) => !tab.hidden);
}

/**
 * `Ctrl+Tab` / `Ctrl+Shift+Tab`. **메모장과 같이 순서대로** 돌고 끝에서 처음으로
 * 돌아간다(가장 최근에 쓴 탭 순서가 아니다 — 메모장 11도 줄 순서로 돈다).
 * 탭이 하나면 지금 탭을 그대로 돌려준다.
 */
export function stepTab(tabs: readonly Tab[], activeId: number, forward: boolean): number {
  const list = shownTabs(tabs);
  if (list.length === 0) return activeId;
  const at = list.findIndex((tab) => tab.id === activeId);
  if (at < 0) return list[0].id;
  const n = list.length;
  const next = (at + (forward ? 1 : n - 1)) % n;
  return list[next].id;
}

/**
 * 탭 하나를 `to` 자리로 옮긴 새 목록(끌어서 순서 바꾸기). 자리 번호는 **보이는 탭**
 * 기준이고 범위를 벗어나면 끝으로 당긴다. 알약 탭과 메모 목록이 같은 데이터를 보므로
 * 어느 쪽에서 끌어도 이 함수 하나를 지난다.
 */
export function moveTab(tabs: readonly Tab[], id: number, to: number): Tab[] {
  const list = shownTabs(tabs);
  const from = list.findIndex((tab) => tab.id === id);
  if (from < 0) return tabs as Tab[];
  const target = Math.max(0, Math.min(to, list.length - 1));
  if (target === from) return tabs as Tab[];
  const moved = list.slice();
  const [tab] = moved.splice(from, 1);
  moved.splice(target, 0, tab);
  // 숨은 탭은 순서에 끼지 않으므로 보이는 자리에 새 순서를 끼워 넣는다.
  let k = 0;
  return tabs.map((tab2) => (tab2.hidden ? tab2 : moved[k++]));
}

/**
 * 탭 하나를 닫은 뒤 어느 탭이 활성인가. 메모장과 같다: **닫은 자리의 탭**, 마지막
 * 탭이었으면 그 왼쪽. 활성이 아닌 탭을 닫으면 활성 탭은 그대로다.
 * 보이는 탭이 하나도 남지 않으면 `null` — 그때는 창이 닫힌다(§5).
 */
export function activeAfterClose(
  tabs: readonly Tab[],
  closedId: number,
  activeId: number
): number | null {
  const list = shownTabs(tabs);
  const at = list.findIndex((tab) => tab.id === closedId);
  if (at < 0) return activeId;
  const rest = list.filter((tab) => tab.id !== closedId);
  if (rest.length === 0) return null;
  if (closedId !== activeId) return activeId;
  return rest[Math.min(at, rest.length - 1)].id;
}

/**
 * 포인터가 어느 자리 위에 있는가 — 끌어서 순서 바꾸기의 유일한 계산.
 * `spans`는 보이는 탭의 상자 범위(알약 탭은 좌/우, 메모 목록은 위/아래)이고 순서대로다.
 * 범위 밖이면 양 끝으로 당긴다. 원본과 같은 규칙(이웃을 지나는 순간 자리를 바꾼다)이라
 * 별도의 드롭 표시가 필요 없다.
 */
export function dropIndex(spans: readonly { start: number; end: number }[], pos: number): number {
  if (spans.length === 0) return 0;
  if (pos <= spans[0].start) return 0;
  const last = spans.length - 1;
  if (pos >= spans[last].end) return last;
  for (let i = 0; i < spans.length; i += 1) {
    const { start, end } = spans[i];
    if (pos >= start && pos <= end) {
      // 상자 안이면 그 자리. 가운데를 넘었는지는 보지 않는다 — 끌고 있는 탭이 이미
      // 그 자리에 있으면 아무 일도 일어나지 않고, 다른 탭이면 바로 자리가 바뀐다.
      return i;
    }
  }
  return last;
}
