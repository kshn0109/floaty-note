/**
 * 찾기/바꾸기의 **엔진에 없는 부분** (설계 문서 §8).
 *
 * 두 호스트는 "문서를 한 줄짜리 평문으로 본 문자열"과 "그 글자 하나하나가 문서의 어느
 * 자리인지"만 다르다. 그래서 글자 찾기 자체는 여기 순수 함수 하나이고(그래서 Node로
 * 단위 시험 가능), 호스트는 평문과 위치표만 넘긴다.
 *
 * 원본 `main.cpp` `RebuildMatches`와 같은 규칙:
 *   * 일치는 **겹치지 않는다**(찾은 다음 글자부터 다시 센다).
 *   * 단어 단위는 일치의 **양 끝 바로 밖**에 단어 글자가 붙어 있으면 버린다.
 *   * 정규식은 폭 0 일치를 버린다(선택할 것도 바꿀 것도 없다).
 *   * 정규식이 틀리면 **목록이 아니라 오류**다 — UI가 빨간 테두리를 그린다.
 */

import { mkPred } from "../md/types";

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/**
 * 일치 하나. `from`/`to`는 **평문 문자열의 글자 번호**다(문서 위치로 바꾸는 일은
 * 호스트가 한다). `expanded`는 정규식 모드에서 `$1`·`$&`를 이미 채운 바꿀 글자다 —
 * 일치 객체가 살아 있는 동안에만 만들 수 있으므로 여기서 만들어 들고 다닌다(원본과 같다).
 */
export interface SearchHit {
  from: number;
  to: number;
  expanded?: string;
}

/** 단어 글자 판정은 마크다운 쪽과 **같은 것**을 쓴다(사용자 결정 2: 한글도 단어 글자). */
const pred = mkPred({ strictBackslash: false, unicodeWords: true });

export const isWordChar = (c: string): boolean => pred.isWordCh(c);

/** 원본 `FindWordEdgesOk`. 양 끝 바로 밖에 단어 글자가 **이어지면** 아니다. */
export function wordEdgesOk(hay: string, a: number, b: number): boolean {
  if (b <= a) return false;
  if (a > 0 && isWordChar(hay[a - 1]) && isWordChar(hay[a])) return false;
  if (b < hay.length && isWordChar(hay[b - 1]) && isWordChar(hay[b])) return false;
  return true;
}

/**
 * 바꿀 글자의 `$` 자리를 채운다(원본 `std::regex`의 `format`과 같은 다섯 가지).
 * `$$` → `$`, `$&` → 일치 전체, `` $` `` → 앞쪽, `$'` → 뒤쪽, `$1`~`$99` → 그룹.
 * 없는 그룹은 빈 글자다.
 */
export function expandReplacement(repl: string, match: RegExpExecArray): string {
  let out = "";
  for (let i = 0; i < repl.length; i += 1) {
    const c = repl[i];
    if (c !== "$" || i + 1 >= repl.length) {
      out += c;
      continue;
    }
    const n = repl[i + 1];
    if (n === "$") {
      out += "$";
      i += 1;
    } else if (n === "&") {
      out += match[0];
      i += 1;
    } else if (n === "`") {
      out += match.input.slice(0, match.index);
      i += 1;
    } else if (n === "'") {
      out += match.input.slice(match.index + match[0].length);
      i += 1;
    } else if (n >= "0" && n <= "9") {
      // 두 자리 그룹이 실제로 있으면 두 자리로 읽는다(ECMAScript 규칙).
      const two = repl.slice(i + 1, i + 3);
      const useTwo = two.length === 2 && /^\d\d$/.test(two) && Number(two) < match.length;
      const digits = useTwo ? two : n;
      out += match[Number(digits)] ?? "";
      i += digits.length;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * 평문 전체에서 일치를 찾는다. **정규식이 틀리면 `null`**(UI가 오류 상태를 그린다).
 *
 * `repl`은 정규식 모드에서만 쓰인다(그룹 참조를 미리 채우려고). 빈 찾을 글자는
 * 일치 0개다 — 원본도 찾기 칸이 비면 아무것도 세지 않는다.
 */
export function runSearch(hay: string, q: SearchQuery, repl = ""): SearchHit[] | null {
  if (q.text === "" || hay === "") return [];
  const hits: SearchHit[] = [];

  if (q.regex) {
    let re: RegExp;
    try {
      re = new RegExp(q.text, q.caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
    let guard = 0;
    for (let m = re.exec(hay); m !== null; m = re.exec(hay)) {
      // 폭 0 일치는 버리지만 `lastIndex`는 손으로 밀어야 무한 반복이 안 된다.
      if (m[0].length === 0) {
        re.lastIndex += 1;
        if (re.lastIndex > hay.length) break;
        continue;
      }
      const a = m.index;
      const b = a + m[0].length;
      if (!q.wholeWord || wordEdgesOk(hay, a, b)) {
        hits.push({ from: a, to: b, expanded: expandReplacement(repl, m) });
      }
      guard += 1;
      if (guard > 1_000_000) break; // 병적인 패턴에서도 앱이 멈추지 않게.
    }
    return hits;
  }

  const needle = q.caseSensitive ? q.text : q.text.toLowerCase();
  const text = q.caseSensitive ? hay : hay.toLowerCase();
  if (needle.length > text.length) return hits;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
    if (!q.wholeWord || wordEdgesOk(hay, i, i + needle.length)) {
      hits.push({ from: i, to: i + needle.length });
    }
  }
  return hits;
}

/**
 * 선택 위치에서 다음/이전 일치. **끝에서 처음으로 돌아간다**(원본 `FindStep`).
 * `selFrom`/`selTo`는 평문 글자 번호이고, 이미 일치가 선택되어 있으면 그것을 건너뛴다.
 */
export function stepIndex(
  hits: readonly SearchHit[],
  selFrom: number,
  selTo: number,
  forward: boolean
): number {
  if (hits.length === 0) return -1;
  if (forward) {
    // 일치가 선택된 상태면 그 다음부터, 커서 하나면 그 자리에서 시작하는 일치도 센다.
    const anchor = selTo > selFrom ? selFrom + 1 : selFrom;
    for (let i = 0; i < hits.length; i += 1) if (hits[i].from >= anchor) return i;
    return 0;
  }
  for (let i = hits.length - 1; i >= 0; i -= 1) if (hits[i].from < selFrom) return i;
  return hits.length - 1;
}

/** 지금 선택과 정확히 같은 일치의 번호(없으면 -1). `Alt+R`이 무엇을 바꿀지 정한다. */
export function hitAt(hits: readonly SearchHit[], from: number, to: number): number {
  if (to <= from) return -1;
  return hits.findIndex((h) => h.from === from && h.to === to);
}
