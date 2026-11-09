/**
 * 블록 목록 → 마크다운. 원본 `main.cpp SerializeMarkdown`의 루프와 같은 규칙이고,
 * 그 위에 **원문 보존(hull)** 방식을 얹었다(설계 문서 §4-3).
 */

import { emitInline, nextLineLooksLikeDelimiter } from "./inline";
import {
  blocksEqual,
  defaultOpts,
  mkPred,
  plainOf,
  type Block,
  type ListItem,
  type LoadedMarkdown,
  type MdOptions,
  type Pred,
} from "./types";

/**
 * 목록 한 덩어리 → 출력 줄들. **원문 들여쓰기를 그대로** 쓰고(`indent`), 근거가 없는
 * 항목(편집기에서 새로 만든 것)만 계산해 적는다.
 *
 * 계산 규칙: 0단계는 들여쓰기 없음, 그 아래는 **바로 윗단계보다 2칸 더**. 들여쓰기가
 * 윗단계보다 깊지 않으면(손으로 만든 이상한 조합) 계산값으로 바꾼다 — 그러지 않으면
 * 다시 읽을 때 중첩이 무너진다. 파서의 쌓기 규칙과 거울이다.
 *
 * `escPipe`는 늘 false다: 항목 줄은 `- `로 시작하므로 **표의 구분 행이 될 수 없고**
 * (`delimiterAligns`의 첫 칸이 `- …`가 되어 반드시 실패한다), 목록 바로 뒤 블록과는
 * 늘 빈 줄 한 개로 떨어져 있다.
 */
function emitListLines(items: readonly ListItem[], P: Pred, opts: MdOptions): string[] {
  const widths: number[] = [];
  return items.map((it) => {
    const lv = Math.max(0, Math.floor(it.level));
    const parent = lv === 0 ? -1 : (widths[lv - 1] ?? -1);
    const keep = it.indent !== null && it.indent.length > parent;
    const indent = keep
      ? (it.indent as string)
      : " ".repeat(lv === 0 ? 0 : Math.max(parent + 2, lv * 2));
    widths[lv] = indent.length;
    widths.length = lv + 1;
    return `${indent}${it.marker} ${emitInline(it.runs, false, false, P, opts, "item")}`;
  });
}

/** 블록 하나 → 출력 줄들(빈 단락은 빈 줄 하나). */
function emitBlockLines(b: Block, P: Pred, opts: MdOptions): string[] {
  if (b.kind === "empty") return [""];
  if (b.kind === "list") return emitListLines(b.items, P, opts);
  if (b.kind === "table") {
    let cols = 0;
    for (const r of b.rows) cols = Math.max(cols, r.length);
    cols = Math.max(cols, b.aligns.length);
    const out: string[] = [];
    for (let ri = 0; ri < b.rows.length; ri += 1) {
      let line = "|";
      for (let ci = 0; ci < cols; ci += 1) {
        line += " ";
        if (ci < b.rows[ri].length) {
          // 칸 안의 줄바꿈은 공백 하나로(원본과 동일). 칸 안에서는 `|`를 항상 이스케이프.
          const runs = b.rows[ri][ci].map((r) => ({
            ...r,
            text: r.text.replace(/[\u000B\r\n]/g, " "),
          }));
          line += emitInline(runs, true, false, P, opts, "cell");
        }
        line += " |";
      }
      out.push(line);
      if (ri === 0) {
        let d = "|";
        for (let ci = 0; ci < cols; ci += 1) {
          const al = b.aligns[ci] ?? "left";
          d += al === "center" ? " :---: |" : al === "right" ? " ---: |" : " --- |";
        }
        out.push(d);
      }
    }
    return out;
  }
  const level = b.kind === "heading" ? b.level : 0;
  const out: string[] = [];
  for (let li = 0; li < b.lines.length; li += 1) {
    let line = "";
    if (level > 0 && li === 0) line += "#".repeat(level) + " ";
    const escPipe = li + 1 < b.lines.length && nextLineLooksLikeDelimiter(plainOf(b.lines[li + 1]));
    line += emitInline(b.lines[li], escPipe, level > 0 && li === 0, P, opts);
    out.push(line);
  }
  return out;
}

/**
 * 블록 목록 → 출력 줄 목록. 글 블록 사이에는 늘 구분 빈 줄 1개 + 빈 단락마다 빈 줄 1개
 * (= 빈 단락 N개 ↔ 빈 줄 N+1개).
 *
 * `startAny`: 앞(원문 그대로 복사한 접두부)에 이미 글 블록이 있었는가.
 * `needGap`: 뒤(원문 그대로 복사할 접미부)가 글 블록으로 시작하는가.
 */
function blocksToLines(
  blocks: readonly Block[],
  P: Pred,
  opts: MdOptions,
  startAny = false,
  needGap = false
): string[] {
  const out: string[] = [];
  let any = startAny;
  let pending = 0;
  for (const b of blocks) {
    if (b.kind === "empty") {
      if (any) pending += 1;
      else out.push("");
      continue;
    }
    if (any) for (let k = 0; k <= pending; k += 1) out.push("");
    pending = 0;
    for (const l of emitBlockLines(b, P, opts)) out.push(l);
    any = true;
  }
  const tail = needGap && any ? pending + 1 : pending;
  for (let k = 0; k < tail; k += 1) out.push("");
  return out;
}

/** 보존할 원문이 없을 때(새 문서)의 평범한 직렬화. */
export function serializeMarkdown(
  blocks: readonly Block[],
  opts: MdOptions = defaultOpts
): string {
  const P = mkPred(opts);
  if (blocks.length === 1 && blocks[0].kind === "empty") return "";
  return blocksToLines(blocks, P, opts).join("\n") + "\n";
}

/**
 * 원문 보존 저장 — 손대지 않은 앞/뒤 블록의 **바이트를 그대로** 되돌려 쓴다(§4-3).
 *
 * - 블록이 전부 같으면 → 읽은 바이트 그대로
 * - 아니면 → 원문 접두부 줄 + 바뀐 구간만 새로 직렬화 + 원문 접미부 줄
 */
export function serializeWithSource(
  blocks: readonly Block[],
  base: LoadedMarkdown | null,
  opts: MdOptions = defaultOpts
): string {
  const P = mkPred(opts);
  // 원문이 없거나 "줄이 0개"(= 빈 파일)면 보존할 바이트가 없다 → 보통 직렬화.
  if (!base || base.lines.length === 0) return serializeMarkdown(blocks, opts);
  const bb = base.blocks;
  let p = 0;
  while (p < blocks.length && p < bb.length && blocksEqual(blocks[p], bb[p])) p += 1;
  if (p === blocks.length && p === bb.length) return base.text;

  let s = 0;
  while (
    s < blocks.length - p &&
    s < bb.length - p &&
    blocksEqual(blocks[blocks.length - 1 - s], bb[bb.length - 1 - s])
  ) {
    s += 1;
  }

  // 접미부는 **글 블록으로 시작할 때만** 원문 그대로 쓸 수 있다. 빈 단락으로 시작하면
  // 그 앞의 구분 줄 유무가 "앞에 글 블록이 있는가"에 따라 달라지므로(§4-2의 비대칭
  // 규칙) 편집으로 문맥이 바뀌면 바이트가 어긋난다.
  while (s > 0 && bb[bb.length - s].kind === "empty") s -= 1;

  // 접두부: 원문 블록 p의 첫 줄 앞까지. 블록 p가 **글 블록**이고 앞에 글 블록이 있으면
  // 바로 앞 빈 줄은 "구분 줄"이므로 접두부에서 빼고 중간부가 다시 만든다.
  const startAny = bb.slice(0, p).some((b) => b.kind !== "empty");
  let cutPre = 0;
  if (p > 0) {
    const ls = p < bb.length ? base.lineStart[p] : base.lines.length;
    const gapBefore =
      p < bb.length && bb[p].kind !== "empty" && startAny && ls > 0 && base.lines[ls - 1] === "";
    cutPre = gapBefore ? ls - 1 : ls;
  }
  const q = bb.length - s;
  const cutPost = s > 0 ? base.lineStart[q] : base.lines.length;
  if (cutPre > cutPost) return serializeMarkdown(blocks, opts); // 안전장치

  const out = [
    ...base.lines.slice(0, cutPre),
    ...blocksToLines(blocks.slice(p, blocks.length - s), P, opts, startAny, s > 0),
    ...(s > 0 ? base.lines.slice(cutPost) : []),
  ];
  if (out.length === 0) return "";
  if (out.length === 1 && out[0] === "") return "";
  // 접미부를 원문 그대로 썼으면 파일 끝 줄바꿈도 원문을 따른다.
  const trailing = s > 0 ? (base.endsWithNewline ? "\n" : "") : "\n";
  return out.join("\n") + trailing;
}
