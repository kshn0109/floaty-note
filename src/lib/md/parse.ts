/**
 * 마크다운 → 블록 목록. 원본 `main.cpp`의 `ParseMarkdown` 블록 루프를 그대로 옮긴 것.
 * 블록 규칙은 설계 문서 §4-2 표와 같다.
 */

import { parseInlineHl } from "./inline";
import { delimiterAligns, hasUnescapedPipe, splitRowCells } from "./table";
import {
  defaultOpts,
  isMdSpace,
  mkPred,
  type Block,
  type ListItem,
  type LoadedMarkdown,
  type MdOptions,
  type ParsedMarkdown,
  type Run,
} from "./types";

/**
 * 줄 분해 — **마지막 줄바꿈 하나만** 종결자로 떼고 나머지는 그대로 센다.
 * `""` → 줄 0개, `"\n"` → 줄 1개(빈 줄).
 */
export function splitMdLines(text: string): string[] {
  if (text === "") return [];
  const t = text.endsWith("\n") ? text.slice(0, -1) : text;
  return t.split("\n");
}

/** ATX 제목 줄이면 레벨과 본문. 닫는 `#`은 떼어 낸다(원본과 동일). */
export function atxHeading(line: string): { level: number; text: string } | null {
  let i = 0;
  while (i < line.length && line[i] === "#") i += 1;
  if (i === 0 || i > 6) return null;
  if (i < line.length && !isMdSpace(line[i])) return null;
  let s = i;
  while (s < line.length && isMdSpace(line[s])) s += 1;
  let e = line.length;
  while (e > s && isMdSpace(line[e - 1])) e -= 1;
  let e2 = e;
  while (e2 > s && line[e2 - 1] === "#") e2 -= 1;
  if (e2 < e && (e2 === s || isMdSpace(line[e2 - 1]))) {
    e = e2;
    while (e > s && isMdSpace(line[e - 1])) e -= 1;
  }
  return { level: i, text: line.slice(s, e) };
}

/**
 * 글머리 기호 항목 줄인가 — **스페이스 들여쓰기 + `-`/`*`/`+` + 스페이스 하나**.
 *
 * 일부러 좁게 잡았다(바이트 보존이 먼저다):
 *   · 탭 들여쓰기는 **항목이 아니다** — 탭의 칸 수가 애매해 중첩 깊이를 되돌려 적을 수 없다.
 *   · 마커 뒤 스페이스가 없으면 아니다 → `---`(수평선)·`-`는 그대로 글자로 남는다.
 *   · 마커 뒤 **남는 스페이스는 글자 쪽**에 둔다(`-   x` → 글자 `"  x"`) → 다시 적으면 같은 바이트.
 */
export function itemPrefix(line: string): { indent: string; marker: string; text: string } | null {
  let i = 0;
  while (i < line.length && line[i] === " ") i += 1;
  const marker = line[i];
  if (marker !== "-" && marker !== "*" && marker !== "+") return null;
  if (line[i + 1] !== " ") return null;
  return { indent: line.slice(0, i), marker, text: line.slice(i + 2) };
}

/**
 * 들여쓰기 칸 수 → 중첩 깊이. **쌓기 규칙**이라 깊이가 한 번에 두 단계 뛰지 않고,
 * 같은 들여쓰기를 다시 적어 읽으면 **같은 깊이가 나온다**(직렬화기와 거울).
 */
function itemLevels(widthsOf: readonly number[]): number[] {
  const stack: number[] = [];
  return widthsOf.map((w) => {
    while (stack.length > 0 && w < stack[stack.length - 1]) stack.pop();
    if (stack.length === 0 || w > stack[stack.length - 1]) stack.push(w);
    return stack.length - 1;
  });
}

export function parseMarkdown(md: string, opts: MdOptions = defaultOpts): ParsedMarkdown {
  const P = mkPred(opts);
  const lines = splitMdLines(md);
  const blocks: Block[] = [];
  const lineStart: number[] = [];
  const push = (b: Block, ls: number): void => {
    blocks.push(b);
    lineStart.push(ls);
  };
  let any = false;
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "") {
      let k = i;
      while (k < lines.length && lines[k] === "") k += 1;
      const run = k - i;
      const empties = !any || k >= lines.length ? run : run - 1;
      // 줄 배정 규칙: 빈 단락은 빈 줄 묶음의 **앞쪽** 줄을 차지하고, 문단 사이 묶음의
      // **마지막** 빈 줄은 "구분 줄"(어느 블록에도 속하지 않음)로 남긴다. 저장할 때
      // 구분 줄은 늘 뒤따르는 글 블록 쪽에서 다시 만들어진다.
      for (let e = 0; e < empties; e += 1) push({ kind: "empty" }, i + e);
      i = k;
      continue;
    }

    const aligns =
      i + 1 < lines.length && hasUnescapedPipe(lines[i]) ? delimiterAligns(lines[i + 1]) : null;
    if (aligns) {
      const ls = i;
      const rowText = [splitRowCells(lines[i])];
      i += 2;
      while (
        i < lines.length &&
        lines[i] !== "" &&
        hasUnescapedPipe(lines[i]) &&
        !delimiterAligns(lines[i])
      ) {
        rowText.push(splitRowCells(lines[i]));
        i += 1;
      }
      const rows: Run[][][] = rowText.map((row) =>
        aligns.map((_a, c) => parseInlineHl(c < row.length ? row[c] : "", P))
      );
      push({ kind: "table", aligns, rows }, ls);
      any = true;
      continue;
    }

    const h = atxHeading(lines[i]);
    if (h) {
      push({ kind: "heading", level: h.level, lines: [parseInlineHl(h.text, P)] }, i);
      i += 1;
      any = true;
      continue;
    }

    const ls = i;
    const group: string[] = [];
    for (;;) {
      group.push(lines[i]);
      i += 1;
      if (i >= lines.length || lines[i] === "") break;
      if (atxHeading(lines[i])) break;
      if (i + 1 < lines.length && hasUnescapedPipe(lines[i]) && delimiterAligns(lines[i + 1])) break;
    }

    /**
     * 목록은 **줄 묶음 전체가 항목일 때만**이다.
     *
     * 왜 그렇게 좁히는가: 블록의 경계를 지금과 **한 줄도 다르지 않게** 두어야 바이트
     * 보존(§4-3)이 그대로 산다. `설명:` 바로 아래 `- 항목`처럼 섞인 묶음을 쪼개면 그
     * 사이에 §4-2의 구분 빈 줄이 새로 생겨 **기존 파일의 바이트가 바뀐다**(사용자 지시의
     * 가장 중요한 조건). 섞인 묶음은 지금처럼 글자 그대로 둔다 — 그 줄에서 글머리 기호
     * 단추를 누르면 그때 비로소(사용자가 바꾼 것이므로) 목록으로 쪼개진다.
     */
    const marks = group.map(itemPrefix);
    if (marks.every((m) => m !== null)) {
      const hits = marks as { indent: string; marker: string; text: string }[];
      const levels = itemLevels(hits.map((m) => m.indent.length));
      const items: ListItem[] = hits.map((m, k) => ({
        level: levels[k],
        marker: m.marker,
        indent: m.indent,
        runs: parseInlineHl(m.text, P),
      }));
      push({ kind: "list", items }, ls);
    } else {
      const plines: Run[][] = group.map((l) => parseInlineHl(l, P));
      push({ kind: "para", lines: plines }, ls);
    }
    any = true;
  }
  if (blocks.length === 0) push({ kind: "empty" }, 0);
  return { blocks, lineStart, lines, endsWithNewline: md === "" ? true : md.endsWith("\n") };
}

/** 나중에 원문을 보존하며 저장하려면(§4-3) 이쪽으로 읽는다. */
export function loadMarkdown(text: string, opts: MdOptions = defaultOpts): LoadedMarkdown {
  return { ...parseMarkdown(text, opts), text };
}
