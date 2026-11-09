/**
 * GFM 파이프 표의 줄 판정 — 원본 `main.cpp`의 `HasUnescapedPipe` / `SplitRowCells` /
 * `DelimiterAligns`를 그대로 옮긴 것.
 */

import { trimMd, type Align } from "./types";

/** 이스케이프되지 않은 `|`가 있는가. 없으면 표 줄이 아니다. */
export function hasUnescapedPipe(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\") {
      i += 1;
      continue;
    }
    if (s[i] === "|") return true;
  }
  return false;
}

/** 한 줄 → 칸 문자열들. 양 끝의 `|` 하나는 테두리로 보고 떼고, 칸마다 공백을 다듬는다. */
export function splitRowCells(line: string): string[] {
  const s = trimMd(line);
  let a = 0;
  let b = s.length;
  if (a < b && s[a] === "|") a += 1;
  if (b > a && s[b - 1] === "|" && !(b >= 2 && s[b - 2] === "\\")) b -= 1;
  const cells: string[] = [];
  let cur = "";
  for (let i = a; i < b; i += 1) {
    if (s[i] === "\\" && i + 1 < b) {
      cur += s[i] + s[i + 1];
      i += 1;
      continue;
    }
    if (s[i] === "|") {
      cells.push(trimMd(cur));
      cur = "";
      continue;
    }
    cur += s[i];
  }
  cells.push(trimMd(cur));
  return cells;
}

/**
 * 구분 행(`| --- | :---: |`)이면 열 정렬 목록, 아니면 `null`.
 * 이 함수가 `null`이 아닌 것이 "앞 줄이 표 머리 행"이라는 유일한 신호다.
 */
export function delimiterAligns(line: string): Align[] | null {
  if (!hasUnescapedPipe(line)) return null;
  const cells = splitRowCells(line);
  if (cells.length === 0) return null;
  const out: Align[] = [];
  for (const raw of cells) {
    const c = trimMd(raw);
    if (c === "") return null;
    let i = 0;
    const left = c[i] === ":";
    if (left) i += 1;
    let dashes = 0;
    while (i < c.length && c[i] === "-") {
      i += 1;
      dashes += 1;
    }
    const right = i < c.length && c[i] === ":";
    if (right) i += 1;
    if (dashes === 0 || i !== c.length) return null;
    out.push(left && right ? "center" : right ? "right" : "left");
  }
  return out;
}
