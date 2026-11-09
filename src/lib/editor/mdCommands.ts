/**
 * 마크다운 모드의 편집 명령 (설계 문서 §7). 원본 `main.cpp`의 규칙을 그대로 옮긴 것:
 *
 * - **굵게·취소선**: 선택이 없으면 커서 위치의 단어(원본은 `SCF_WORD`). 섞여 있으면 켜진다.
 * - **H1~H3**: 단락 단위, 같은 레벨을 다시 누르면 본문으로(`ApplyHeading`의 주석과 동일).
 * - **형광펜**: 선택이 그 색으로 균일하면 해제(`HighlightSelection`의 `uniform && cur == color`).
 * - **표**: 현재 단락 **뒤에** 새 블록으로, 비어 있던 단락이면 그 자리에. 커서는 첫 칸.
 *
 * 모든 함수는 **트랜잭션 하나**를 돌려준다 = `Ctrl+Z` 한 번.
 */

import {
  Fragment,
  Slice,
  type MarkType,
  type Node as PmNode,
  type ResolvedPos,
} from "prosemirror-model";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";

import { schema } from "../md/pmdoc";
import type { HeadingLevel } from "./DocHost";

/** 단어 글자 — 한글·한자도 단어로 본다(사용자 결정 2와 같은 판정). */
const RE_WORD = /[\p{L}\p{N}_]/u;

function eachText(
  doc: PmNode,
  from: number,
  to: number,
  f: (node: PmNode, a: number, b: number) => void
): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (b > a) f(node, a, b);
    return false;
  });
}

/** 선택 범위, 또는 커서 위치의 단어. 단어 밖이면 `null`(원본처럼 아무 일도 안 한다). */
export function wordRange(state: EditorState): { from: number; to: number } | null {
  const { from, to, $from } = state.selection;
  if (to > from) return { from, to };
  const parent = $from.parent;
  if (!parent.isTextblock) return null;
  const text = parent.textBetween(0, parent.content.size, "\n", "\n");
  const off = $from.parentOffset;
  let a = off;
  let b = off;
  while (a > 0 && RE_WORD.test(text[a - 1])) a -= 1;
  while (b < text.length && RE_WORD.test(text[b])) b += 1;
  if (a === b) return null;
  const start = $from.start();
  return { from: start + a, to: start + b };
}

export function inTable(state: EditorState): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type === schema.nodes.table) return true;
  }
  return false;
}

// --------------------------------------------------------------------------- 굵게 · 취소선

function allTextHas(doc: PmNode, from: number, to: number, pred: (n: PmNode) => boolean): boolean {
  let seen = 0;
  let ok = 0;
  eachText(doc, from, to, (node) => {
    seen += 1;
    if (pred(node)) ok += 1;
  });
  return seen > 0 && seen === ok;
}

/**
 * 글자 마크 하나의 상태 — 선택이 없으면 **커서 위치의 단어**를 본다(원본 `SCF_WORD`).
 * 단어 밖이면 `storedMarks`(= 다음에 칠 글자의 서식)를 본다.
 */
function queryMark(state: EditorState, type: MarkType): boolean {
  const r = wordRange(state);
  if (!r) return type.isInSet(state.storedMarks ?? state.selection.$from.marks()) !== undefined;
  return allTextHas(state.doc, r.from, r.to, (n) => type.isInSet(n.marks) !== undefined);
}

/**
 * 마크를 켜고 끈다. 범위가 섞여 있으면 **켜진다**(원본 규칙). 선택이 없으면 커서
 * 위치의 단어가 대상이고, 단어 밖이면 아무 일도 하지 않는다(`null`).
 */
function toggleMark(state: EditorState, type: MarkType): Transaction | null {
  const r = wordRange(state);
  if (!r) return null;
  const on = allTextHas(state.doc, r.from, r.to, (n) => type.isInSet(n.marks) !== undefined);
  const tr = state.tr;
  if (on) tr.removeMark(r.from, r.to, type);
  else tr.addMark(r.from, r.to, type.create());
  return tr;
}

export function queryBold(state: EditorState): boolean {
  return queryMark(state, schema.marks.strong);
}

export function toggleBold(state: EditorState): Transaction | null {
  return toggleMark(state, schema.marks.strong);
}

/** 취소선 — 굵게와 **같은 규칙**이다. 파일에는 `~~글자~~`로 나간다(원본 규칙). */
export function queryStrike(state: EditorState): boolean {
  return queryMark(state, schema.marks.strike);
}

export function toggleStrike(state: EditorState): Transaction | null {
  return toggleMark(state, schema.marks.strike);
}

// --------------------------------------------------------------------------- 제목

interface TopBlock {
  node: PmNode;
  from: number;
  index: number;
}

/** 선택에 걸친 **최상위** 단락·제목 블록들(표는 제외). 문서 순서대로. */
function topBlocksInSelection(state: EditorState): TopBlock[] {
  const { from, to } = state.selection;
  const out: TopBlock[] = [];
  state.doc.forEach((node, offset, index) => {
    const end = offset + node.nodeSize;
    // 커서 하나(from === to)도 그 커서를 품은 블록 하나와 겹친다.
    if (offset >= to || end <= from) return;
    if (node.type === schema.nodes.paragraph || node.type === schema.nodes.heading) {
      out.push({ node, from: offset, index });
    }
  });
  return out;
}

/**
 * 블록 안의 **줄** 범위들 — `soft_break`가 줄을 쪼갠다(`.txt`에서 읽거나 붙여넣은 글은
 * 줄바꿈으로 이어진 **한 단락**이다). 제목은 줄 단위이므로 이 줄들이 대상 단위다.
 */
interface BlockLine {
  from: number;
  to: number;
}

function linesOf(node: PmNode, blockFrom: number): BlockLine[] {
  const start = blockFrom + 1; // 블록 안쪽 첫 자리
  const lines: BlockLine[] = [];
  let from = start;
  let pos = start;
  node.forEach((child) => {
    if (child.type === schema.nodes.soft_break) {
      lines.push({ from, to: pos });
      pos += child.nodeSize;
      from = pos;
      return;
    }
    pos += child.nodeSize;
  });
  lines.push({ from, to: pos });
  return lines;
}

/** 선택이 걸친 줄 구간 `[i, j]`(이어져 있다). 안 걸치면 `null`. */
function touchedLines(
  lines: readonly BlockLine[],
  selFrom: number,
  selTo: number
): [number, number] | null {
  let i = -1;
  let j = -1;
  for (let k = 0; k < lines.length; k += 1) {
    const l = lines[k];
    const hit =
      selTo > selFrom
        ? l.from <= selTo && l.to >= selFrom
        : l.from <= selFrom && selFrom <= l.to;
    if (!hit) continue;
    if (i < 0) i = k;
    j = k;
  }
  return i < 0 ? null : [i, j];
}

function levelOf(node: PmNode): HeadingLevel {
  if (node.type !== schema.nodes.heading) return 0;
  const l = Number(node.attrs.level);
  return l >= 1 && l <= 6 ? (l as HeadingLevel) : 0;
}

export function queryHeading(state: EditorState): HeadingLevel {
  const blocks = topBlocksInSelection(state);
  if (blocks.length === 0) return 0;
  const level = levelOf(blocks[0].node);
  for (const b of blocks) if (levelOf(b.node) !== level) return 0;
  return level;
}

/**
 * H1~H6. **제목은 줄(블록) 단위**이므로 선택이 걸친 **줄들만** 바뀐다.
 *
 * `.txt`에서 읽거나 붙여넣은 글은 줄바꿈(`soft_break`)으로 이어진 **한 단락**이다.
 * 그 단락 전체를 제목으로 바꾸면 선택하지 않은 줄까지 제목이 되고(사용자 보고한 버그),
 * 마크다운으로도 못 적는다(`#`는 첫 줄에만 붙으므로 둘째 줄부터는 다시 읽을 때 본문이 된다).
 * 그래서 선택이 걸친 줄들을 **각각 별도 블록으로 쪼갠 뒤** 그 블록만 제목으로 만들고,
 * 앞뒤 줄은 원래 단락으로 남긴다. 트랜잭션 하나이므로 `Ctrl+Z` 한 번에 되돌아간다.
 *
 * 같은 레벨을 다시 누르면 본문으로(원본 `ApplyHeading`) — 같은 줄 규칙이다.
 */
export function applyHeading(state: EditorState, level: 1 | 2 | 3 | 4 | 5 | 6): Transaction | null {
  if (inTable(state)) return null;
  const blocks = topBlocksInSelection(state);
  if (blocks.length === 0) return null;
  const { from: selFrom, to: selTo } = state.selection;

  const targets: { block: TopBlock; lines: BlockLine[]; i: number; j: number }[] = [];
  for (const b of blocks) {
    const lines = linesOf(b.node, b.from);
    const run = touchedLines(lines, selFrom, selTo);
    if (run) targets.push({ block: b, lines, i: run[0], j: run[1] });
  }
  if (targets.length === 0) return null;

  // 같은 레벨을 다시 누르면 본문으로.
  const allSame = targets.every(
    (t) =>
      t.block.node.type === schema.nodes.heading && Number(t.block.node.attrs.level) === level
  );

  // 쪼갤 자리(= `soft_break` 하나씩)와, 쪼갠 뒤 대상이 될 블록 **번호**를 먼저 센다.
  // 번호로 세면 빈 줄이 섞여 있어도 자리가 헷갈리지 않는다.
  const cuts: number[] = [];
  const indices: number[] = [];
  let added = 0;
  for (const t of targets) {
    const last = t.lines.length - 1;
    if (t.i > 0) cuts.push(t.lines[t.i].from - 1);
    for (let k = t.i; k <= t.j; k += 1) if (k < last) cuts.push(t.lines[k].to);
    const base = t.block.index + added + (t.i > 0 ? 1 : 0);
    for (let k = t.i; k <= t.j; k += 1) indices.push(base + (k - t.i));
    added += (t.i > 0 ? 1 : 0) + (t.j - t.i) + (t.j < last ? 1 : 0);
  }

  const tr = state.tr;
  // 뒤(큰 자리)부터 — 앞쪽 자리가 밀리지 않는다.
  for (const p of [...new Set(cuts)].sort((a, b) => b - a)) {
    tr.delete(p, p + 1); // 줄바꿈을 지우고
    tr.split(p); //         그 자리에서 블록을 끊는다
  }

  const type = allSame ? schema.nodes.paragraph : schema.nodes.heading;
  const attrs = allSame ? null : { level };
  const wanted = new Set(indices);
  const at: number[] = [];
  tr.doc.forEach((_node, offset, index) => {
    if (wanted.has(index)) at.push(offset);
  });
  for (const p of at) {
    const node = tr.doc.nodeAt(p);
    if (node) tr.setNodeMarkup(p, type, attrs, node.marks);
  }
  return tr.docChanged ? tr : null;
}

// --------------------------------------------------------------------------- 형광펜

export function queryHighlight(state: EditorState): string | null {
  const { from, to } = state.selection;
  if (to <= from) {
    const mark = schema.marks.highlight.isInSet(
      state.storedMarks ?? state.selection.$from.marks()
    );
    return mark ? String(mark.attrs.color) : null;
  }
  let color: string | null = null;
  let seen = 0;
  let same = 0;
  eachText(state.doc, from, to, (node) => {
    seen += 1;
    const mark = schema.marks.highlight.isInSet(node.marks);
    if (!mark) return;
    const c = String(mark.attrs.color);
    if (color === null) color = c;
    if (color === c) same += 1;
  });
  return seen > 0 && seen === same ? color : null;
}

/**
 * 색을 칠하거나 지운다. `color === null`이면 지우기.
 * 선택이 없으면 `null`을 돌려준다 — 그때 부르는 쪽이 펜 모드를 켜고 끈다(원본과 동일).
 *
 * `toggle`이 참이면 선택이 그 색으로 균일할 때 **해제**한다
 * (원본 `HighlightSelection`의 `uniform && cur == color`). 펜 모드는 `toggle: false`로
 * 불러서 이미 칠해진 범위를 지우지 않게 한다.
 */
export function applyHighlight(
  state: EditorState,
  color: string | null,
  toggle = true
): Transaction | null {
  const { from, to } = state.selection;
  if (to <= from) return null;
  const uniform = queryHighlight(state) === color;
  if (color !== null && uniform && !toggle) return null;
  const tr = state.tr;
  if (color === null) {
    tr.removeMark(from, to, schema.marks.highlight);
    return tr.docChanged ? tr : null;
  }
  tr.removeMark(from, to, schema.marks.highlight);
  if (!uniform) tr.addMark(from, to, schema.marks.highlight.create({ color }));
  return tr.docChanged ? tr : null;
}

// --------------------------------------------------------------------------- 표

function buildTable(rows: number, cols: number): PmNode {
  const rowNodes: PmNode[] = [];
  for (let r = 0; r < rows; r += 1) {
    const cells: PmNode[] = [];
    for (let c = 0; c < cols; c += 1) {
      const type = r === 0 ? schema.nodes.table_header : schema.nodes.table_cell;
      cells.push(type.createAndFill({ align: "left" }) as PmNode);
    }
    rowNodes.push(schema.nodes.table_row.create(null, cells));
  }
  return schema.nodes.table.create(null, rowNodes);
}

export function insertTable(state: EditorState, rows: number, cols: number): Transaction | null {
  if (rows < 1 || cols < 1 || inTable(state)) return null;
  const $from = state.selection.$from;
  const topIndex = $from.depth === 0 ? Math.min($from.index(0), state.doc.childCount - 1) : $from.index(0);
  let blockStart = 0;
  let blockEnd = 0;
  state.doc.forEach((node, offset, index) => {
    if (index !== topIndex) return;
    blockStart = offset;
    blockEnd = offset + node.nodeSize;
  });
  const node = state.doc.child(topIndex);
  const table = buildTable(rows, cols);
  const tr = state.tr;
  const empty = node.type === schema.nodes.paragraph && node.content.size === 0;
  const at = empty ? blockStart : blockEnd;
  if (empty) tr.replaceWith(blockStart, blockEnd, table);
  else tr.insert(blockEnd, table);
  // 표 → 행 → 칸으로 세 단계 들어간 자리가 첫 칸의 글자 위치다. 커서는 첫 칸(원본).
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 3, tr.doc.content.size))));
  return tr;
}

/**
 * 지금 가리키고 있는 **표 한 덩어리**의 범위. 표와 상관없으면 `null`.
 *
 * 세 가지를 다 본다(사용자 보고: "표 삭제가 안 돼"):
 *   · 표가 통째로 골라져 있다(`NodeSelection`) — Backspace/Delete가 만드는 상태.
 *   · 칸이 골라져 있다(`CellSelection`) — 표 안에서 끌면 생긴다. 칸이 전부든 일부든
 *     그 표를 가리킨다고 본다(지울지 말지는 부르는 쪽이 정한다).
 *   · 커서가 칸 **안**에 있다 — 우클릭 메뉴의 `표 삭제`가 쓰는 길이다.
 */
export function tableRange(state: EditorState): { from: number; to: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === schema.nodes.table) {
    return { from: sel.from, to: sel.from + sel.node.nodeSize };
  }
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type !== schema.nodes.table) continue;
    const start = $from.before(d);
    return { from: start, to: start + $from.node(d).nodeSize };
  }
  return null;
}

/** 칸이 **표 전체**만큼 골라져 있는가(행도 열도 전부). 그때는 표를 지운다. */
export function wholeTableCells(state: EditorState): boolean {
  const sel = state.selection;
  return sel instanceof CellSelection && sel.isColSelection() && sel.isRowSelection();
}

/**
 * 표 한 덩어리를 지운다. 문서에 쓸 블록이 하나도 남지 않으면(스키마가 `block+`이다)
 * **빈 단락 하나**를 대신 둔다 — 지운 뒤에도 칠 자리가 있어야 한다.
 *
 * 장식이 아니라 진짜 편집이므로 실행 취소 한 번이고, 저장 바이트에서는 그 표의 원문이
 * 그대로 사라진다(`serializeWithSource`가 바뀐 블록만 새로 적는다).
 */
export function deleteTable(state: EditorState): Transaction | null {
  const range = tableRange(state);
  if (!range) return null;
  const tr = state.tr;
  if (state.doc.childCount === 1) {
    tr.replaceWith(range.from, range.to, schema.nodes.paragraph.create());
  } else {
    tr.delete(range.from, range.to);
  }
  const at = Math.min(range.from, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(at), 1));
  return tr;
}

/**
 * 표 **바로 뒤** 블록의 맨 앞에서 Backspace(`dir = -1`), 또는 표 **바로 앞** 블록의
 * 맨 끝에서 Delete(`dir = 1`)를 눌렀을 때 그 표를 통째로 고른다.
 *
 * 흔한 편집기 규칙이다: 한 번 누르면 **골라지고**(눈에 보이고) 한 번 더 누르면 지워진다.
 * 그래야 표가 소리 없이 사라지지 않는다. 고르기만 하므로 문서는 바뀌지 않는다.
 */
export function selectAdjacentTable(state: EditorState, dir: -1 | 1): Transaction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $from = sel.$from;
  // 깊이 1 = 맨 위 층의 글자 블록. 표 **안**이면 여기 걸리지 않는다.
  if ($from.depth !== 1 || !$from.parent.isTextblock) return null;
  if (dir < 0 && $from.parentOffset !== 0) return null;
  if (dir > 0 && $from.parentOffset !== $from.parent.content.size) return null;
  const index = $from.index(0) + (dir < 0 ? -1 : 1);
  if (index < 0 || index >= state.doc.childCount) return null;
  if (state.doc.child(index).type !== schema.nodes.table) return null;
  let pos = 0;
  state.doc.forEach((_node, offset, i) => {
    if (i === index) pos = offset;
  });
  return state.tr.setSelection(NodeSelection.create(state.doc, pos));
}

// --------------------------------------------------------------------------- 평문 넣기 / 붙여넣기

/**
 * 평문 → 블록 조각. 파일 규칙과 같다: 붙어 있는 줄들은 **한 단락 + 소프트 줄바꿈**,
 * 빈 줄 묶음은 빈 단락이 된다. 그래서 붙여넣은 글이 저장될 때 **원래 줄 모양 그대로** 나간다.
 * 마크다운 문법은 해석하지 않는다(붙여넣은 `#`는 글자 `#`다).
 */
export function textToSlice(text: string): Slice {
  const lines = text.split(/\r\n?|\n/);
  const nodes: PmNode[] = [];
  let any = false;
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "") {
      let k = i;
      while (k < lines.length && lines[k] === "") k += 1;
      const run = k - i;
      const empties = !any || k >= lines.length ? run : run - 1;
      for (let e = 0; e < empties; e += 1) nodes.push(schema.nodes.paragraph.create());
      i = k;
      continue;
    }
    const inline: PmNode[] = [];
    let first = true;
    while (i < lines.length && lines[i] !== "") {
      if (!first) inline.push(schema.nodes.soft_break.create());
      inline.push(schema.text(lines[i]));
      first = false;
      i += 1;
    }
    nodes.push(schema.nodes.paragraph.create(null, inline));
    any = true;
  }
  if (nodes.length === 0) nodes.push(schema.nodes.paragraph.create());
  return Slice.maxOpen(Fragment.fromArray(nodes));
}

export function insertText(state: EditorState, text: string): Transaction | null {
  if (text === "") return null;
  const tr = state.tr;
  tr.replaceSelection(textToSlice(text));
  return tr.docChanged ? tr : null;
}

/** `Shift+Enter` — 소프트 줄바꿈(= 파일에서 빈 줄 없이 붙은 다음 줄). */
export function insertSoftBreak(state: EditorState): Transaction | null {
  const tr = state.tr;
  tr.replaceSelectionWith(schema.nodes.soft_break.create(), false);
  tr.scrollIntoView();
  return tr.docChanged ? tr : null;
}

// --------------------------------------------------------------------------- 글머리 기호 목록

/**
 * 목록 명령은 모두 **줄 모델**로 돌아간다(승인된 시안 L1).
 *
 * 왜 `prosemirror-schema-list`를 안 쓰는가: 의존성에 없고 새 패키지를 넣지 않기로 했다
 * (사용자 지시). 그리고 이 편집기의 "줄"은 PM의 블록과 1:1이 아니다 — `.txt`에서 읽은
 * 글은 `soft_break`로 이어진 **한 단락**이라 `wrapInList`/`liftListItem`이 보는 단위와
 * 어긋난다. 그래서 제목(`applyHeading`)과 **같은 방식**으로 간다: 손댈 최상위 블록
 * 구간을 줄 목록으로 펼치고 → 줄에 손대고 → 그 구간을 **한 번에** 바꿔 쓴다.
 * 바꿔 쓰는 것이 `replaceWith` 하나이므로 `Ctrl+Z` 한 번이다.
 */

/** 펼쳐진 줄 하나. 항목이면 `item`, 아니면 단락(`heading === 0`)이나 제목이다. */
interface DocLine {
  item: boolean;
  /** 중첩 깊이(항목일 때만 뜻이 있다). */
  level: number;
  marker: string;
  /** 원문 들여쓰기 — 깊이가 그대로일 때만 살려 쓴다(바이트 보존). */
  indent: string | null;
  heading: number;
  content: Fragment;
  /** 원래 문서에서 이 줄의 글자 범위(선택 자리를 옮길 때 쓴다). */
  from: number;
  to: number;
}

interface LineRange {
  /** 통째로 바꿔 쓸 최상위 블록 범위. */
  from: number;
  to: number;
  lines: DocLine[];
  /** 선택이 걸친 줄 구간 `[i, j]`. */
  hit: [number, number];
}

/** 줄 안에서의 자리 — 바꿔 쓴 뒤 선택을 같은 곳에 돌려놓는 데 쓴다. */
interface LinePos {
  line: number;
  off: number;
}

const MARKERS = "-*+";

function markerOf(li: PmNode): string {
  const m = li.attrs.marker;
  return typeof m === "string" && m.length === 1 && MARKERS.includes(m) ? m : "-";
}

function indentOf(li: PmNode): string | null {
  const v = li.attrs.indent;
  return typeof v === "string" ? v : null;
}

/** 커서가 든 `list_item`의 깊이. 목록 안이 아니면 `-1`. */
function itemDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type === schema.nodes.list_item) return d;
  }
  return -1;
}

/** 커서가 든 항목의 중첩 깊이(0부터). */
function itemLevel($pos: ResolvedPos): number {
  let n = 0;
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type === schema.nodes.bullet_list) n += 1;
  }
  return Math.max(0, n - 1);
}

/**
 * 커서 줄이 글머리 기호 항목인가 — 도구 줄의 눌린 모양(`aria-pressed`·`data-on`)이
 * 이 값을 쓴다. 제목·취소선 상태가 넘어가는 길(`EditorQuery`)과 같다.
 */
export function queryBullet(state: EditorState): boolean {
  const sel = state.selection;
  return itemDepth(sel.$from) > 0 && itemDepth(sel.$to) > 0;
}

/** 목록 한 덩어리 → 줄 목록(항목 안에 소프트 줄바꿈이 있으면 줄마다 항목 하나). */
function readListLines(list: PmNode, listStart: number, level: number, out: DocLine[]): void {
  let pos = listStart + 1;
  list.forEach((li) => {
    const pStart = pos + 1; // 항목 안쪽 = 단락 노드의 자리
    const para = li.child(0);
    const marker = markerOf(li);
    const indent = indentOf(li);
    for (const l of linesOf(para, pStart)) {
      out.push({
        item: true,
        level,
        marker,
        indent,
        heading: 0,
        content: para.content.cut(l.from - pStart - 1, l.to - pStart - 1),
        from: l.from,
        to: l.to,
      });
    }
    if (li.childCount > 1) readListLines(li.child(1), pStart + para.nodeSize, level + 1, out);
    pos += li.nodeSize;
  });
}

/**
 * 선택이 걸친 최상위 블록들을 **줄 목록으로 펼친다**. 표가 걸려 있으면 `null`
 * (표는 줄 모델로 다룰 것이 아니다 — 목록 명령은 그때 아무 일도 하지 않는다).
 */
function readLines(state: EditorState): LineRange | null {
  const { from: selFrom, to: selTo } = state.selection;
  const picked: { node: PmNode; from: number }[] = [];
  let bad = false;
  state.doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    if (offset >= selTo || end <= selFrom) return;
    if (
      node.type !== schema.nodes.paragraph &&
      node.type !== schema.nodes.heading &&
      node.type !== schema.nodes.bullet_list
    ) {
      bad = true;
      return;
    }
    picked.push({ node, from: offset });
  });
  if (bad || picked.length === 0) return null;

  const lines: DocLine[] = [];
  for (const b of picked) {
    if (b.node.type === schema.nodes.bullet_list) {
      readListLines(b.node, b.from, 0, lines);
      continue;
    }
    const heading = b.node.type === schema.nodes.heading ? Number(b.node.attrs.level) : 0;
    for (const l of linesOf(b.node, b.from)) {
      lines.push({
        item: false,
        level: 0,
        marker: "-",
        indent: null,
        heading,
        content: b.node.content.cut(l.from - b.from - 1, l.to - b.from - 1),
        from: l.from,
        to: l.to,
      });
    }
  }
  if (lines.length === 0) return null;
  const hit = touchedLines(lines, selFrom, selTo) ?? [0, lines.length - 1];
  const last = picked[picked.length - 1];
  return { from: picked[0].from, to: last.from + last.node.nodeSize, lines, hit };
}

/** 붙어 있는 항목 줄들 → **중첩된** `bullet_list` 하나. 깊이는 0부터로 정규화한다. */
function buildList(lines: readonly DocLine[], start: number, end: number): PmNode {
  const span = lines.slice(start, end);
  let base = span[0].level;
  for (const l of span) base = Math.min(base, l.level);
  const levels: number[] = [];
  let prev = -1;
  for (const l of span) {
    const lv = Math.min(Math.max(0, l.level - base), prev + 1);
    levels.push(lv);
    prev = lv;
  }
  const build = (i: number, level: number): { nodes: PmNode[]; next: number } => {
    const nodes: PmNode[] = [];
    let k = i;
    while (k < span.length && levels[k] >= level) {
      if (levels[k] > level) {
        const sub = build(k, levels[k]);
        const list = schema.nodes.bullet_list.create(null, sub.nodes);
        if (nodes.length > 0) {
          const prevNode = nodes[nodes.length - 1];
          nodes[nodes.length - 1] = prevNode.type.create(
            prevNode.attrs,
            Fragment.from([prevNode.child(0), list])
          );
        } else {
          nodes.push(
            schema.nodes.list_item.create(null, [schema.nodes.paragraph.create(), list])
          );
        }
        k = sub.next;
        continue;
      }
      const l = span[k];
      // 깊이가 바뀐 항목은 원문 들여쓰기의 근거를 잃는다 → `null`로 두고 직렬화기가 센다.
      const indent = base === 0 && l.level === levels[k] ? l.indent : null;
      nodes.push(
        schema.nodes.list_item.create(
          { marker: l.marker, indent },
          schema.nodes.paragraph.create(null, l.content)
        )
      );
      k += 1;
    }
    return { nodes, next: k };
  };
  return schema.nodes.bullet_list.create(null, build(0, 0).nodes);
}

/** 줄 목록 → 최상위 블록들. 붙어 있는 항목 줄은 목록 하나로 묶인다. */
function buildLines(lines: readonly DocLine[]): PmNode[] {
  const out: PmNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.item) {
      out.push(
        l.heading > 0
          ? schema.nodes.heading.create({ level: l.heading }, l.content)
          : schema.nodes.paragraph.create(null, l.content)
      );
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].item) j += 1;
    out.push(buildList(lines, i, j));
    i = j;
  }
  return out;
}

/** 원래 문서 자리 → (줄, 줄 안 칸). 범위 밖이면 가장 가까운 줄로 당긴다. */
function linePosOf(r: LineRange, pos: number): LinePos {
  for (let k = 0; k < r.lines.length; k += 1) {
    const l = r.lines[k];
    if (pos >= l.from && pos <= l.to) return { line: k, off: pos - l.from };
  }
  const last = r.lines.length - 1;
  if (pos < r.lines[0].from) return { line: 0, off: 0 };
  return { line: last, off: r.lines[last].to - r.lines[last].from };
}

/**
 * 줄 목록을 문서에 **한 번에** 적는다 = `Ctrl+Z` 한 번.
 *
 * 선택은 "몇 번째 줄 · 줄 안 몇 칸"으로 기억했다가 새 줄의 같은 자리에 돌려놓는다
 * (바꿔 쓴 구간의 자리 번호가 전부 달라지므로 `mapping`으로는 못 맞춘다).
 */
function applyLines(
  state: EditorState,
  r: LineRange,
  lines: readonly DocLine[],
  anchorAt?: LinePos,
  headAt?: LinePos
): Transaction | null {
  const nodes = buildLines(lines);
  if (nodes.length === 0) return null;
  // 바뀐 것이 없으면 아무 일도 하지 않는다 — `replaceWith`는 내용이 같아도 스텝을
  // 남기므로(그래서 `docChanged`로는 못 걸러낸다) 여기서 먼저 비교한다.
  if (Fragment.fromArray(nodes).eq(state.doc.content.cut(r.from, r.to))) return null;
  const wantAnchor = anchorAt ?? linePosOf(r, state.selection.anchor);
  const wantHead = headAt ?? linePosOf(r, state.selection.head);
  const tr = state.tr;
  tr.replaceWith(r.from, r.to, nodes);
  if (!tr.docChanged) return null;

  let size = 0;
  for (const n of nodes) size += n.nodeSize;
  const starts: { from: number; to: number }[] = [];
  tr.doc.nodesBetween(r.from, Math.min(r.from + size, tr.doc.content.size), (node, pos) => {
    if (!node.isTextblock) return true;
    starts.push({ from: pos + 1, to: pos + 1 + node.content.size });
    return false;
  });
  const at = (p: LinePos): number => {
    const l = starts[Math.min(Math.max(p.line, 0), starts.length - 1)];
    if (!l) return r.from;
    return Math.min(l.from + Math.max(p.off, 0), l.to);
  };
  const size2 = tr.doc.content.size;
  const $a = tr.doc.resolve(Math.min(at(wantAnchor), size2));
  const $h = tr.doc.resolve(Math.min(at(wantHead), size2));
  tr.setSelection(TextSelection.between($a, $h));
  return tr;
}

/**
 * 글머리 기호 토글(Ctrl+Shift+8 · 도구 줄 `•≡`).
 *
 * 선택이 걸친 **줄마다** 항목이 된다(선택이 없으면 커서 줄 하나). `soft_break`로 이어진
 * 한 단락은 줄 단위로 쪼개진다 — 제목(`applyHeading`)과 **같은 규칙**이다. 걸린 줄이
 * 모두 이미 항목이면 해제한다(토글). 제목 줄에 걸면 제목이 풀리고 본문 항목이 된다.
 */
export function toggleBullet(state: EditorState): Transaction | null {
  if (inTable(state)) return null;
  const r = readLines(state);
  if (!r) return null;
  const [i, j] = r.hit;
  const hits = r.lines.slice(i, j + 1);
  // 빈 줄은 **셈에서 뺀다**: 글이 있는 줄이 하나라도 걸렸으면 그 줄들만 보고 토글을
  // 정하고, 빈 줄은 건드리지 않는다(문서 전체를 선택해 눌렀을 때 빈 줄마다 `- `가
  // 생기지 않게 — 빈 줄만 걸렸으면 그 줄이 대상이다).
  const meaningful = hits.filter((l) => l.content.size > 0);
  const scope = meaningful.length > 0 ? meaningful : hits;
  const on = scope.every((l) => l.item);
  const lines = r.lines.map((l, k) => {
    if (k < i || k > j) return l;
    if (on) return l.item ? { ...l, item: false, level: 0, indent: null, heading: 0 } : l;
    if (l.item || (meaningful.length > 0 && l.content.size === 0)) return l;
    return { ...l, item: true, heading: 0, level: 0, marker: "-", indent: null };
  });
  return applyLines(state, r, lines);
}

/**
 * Tab / Shift+Tab — 중첩 · 해제. 더 깊어질 수 있는 것은 **바로 위에 같은 깊이(또는 더
 * 깊은) 항목이 있을 때만**이다(마크다운이 그렇게만 읽는다). 항목의 **자식들도 같이** 움직인다.
 */
export function indentBullet(state: EditorState, dir: -1 | 1): Transaction | null {
  if (inTable(state) || !queryBullet(state)) return null;
  const r = readLines(state);
  if (!r) return null;
  const [i, j] = r.hit;
  if (!r.lines.slice(i, j + 1).every((l) => l.item)) return null;
  // 마지막으로 걸린 항목의 자식(더 깊은 항목)까지 구간을 늘린다.
  let end = j;
  while (
    end + 1 < r.lines.length &&
    r.lines[end + 1].item &&
    r.lines[end + 1].level > r.lines[j].level
  ) {
    end += 1;
  }
  if (dir > 0) {
    const above = i > 0 && r.lines[i - 1].item ? r.lines[i - 1].level : -1;
    if (r.lines[i].level > above) return null;
  } else if (r.lines.slice(i, end + 1).every((l) => l.level === 0)) return null;
  const lines = r.lines.map((l, k) =>
    k >= i && k <= end ? { ...l, level: Math.max(0, l.level + dir), indent: null } : l
  );
  return applyLines(state, r, lines);
}

/**
 * 항목에서 Enter — 다음 항목으로. **빈 항목**에서 누르면 목록에서 빠져나와 본문이 된다.
 *
 * `Shift+Enter`도 같은 길이다: 항목 하나에 두 줄을 담는 마크다운 문법이 없으므로
 * 소프트 줄바꿈을 항목 안에 넣지 않는다.
 */
export function splitBullet(state: EditorState): Transaction | null {
  const sel = state.selection;
  if (itemDepth(sel.$from) < 0 || itemDepth(sel.$to) < 0) return null;
  const r = readLines(state);
  if (!r) return null;
  const [i, j] = r.hit;
  if (!r.lines.slice(i, j + 1).every((l) => l.item)) return null;
  const a = r.lines[i];
  const b = r.lines[j];
  // 빈 항목 + 커서만 → 목록에서 빠져나온다.
  if (i === j && sel.empty && a.content.size === 0) return toggleBullet(state);
  const offA = Math.max(0, Math.min(sel.from - a.from, a.content.size));
  const offB = Math.max(0, Math.min(sel.to - b.from, b.content.size));
  const lines = [
    ...r.lines.slice(0, i),
    { ...a, content: a.content.cut(0, offA) },
    { ...a, content: b.content.cut(offB), indent: null },
    ...r.lines.slice(j + 1),
  ];
  const put = { line: i + 1, off: 0 };
  return applyLines(state, r, lines, put, put);
}

/**
 * 항목 **맨 앞**에서 Backspace — 한 단계 내어쓰고, 0단계면 항목을 해제한다.
 * (Windows 메모장에는 목록이 없다. 널리 쓰는 편집기 규칙을 따랐다.)
 */
export function bulletBackspace(state: EditorState): Transaction | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const d = itemDepth(sel.$from);
  if (d < 0 || sel.$from.depth !== d + 1 || sel.$from.parentOffset !== 0) return null;
  return itemLevel(sel.$from) > 0 ? indentBullet(state, -1) : toggleBullet(state);
}

/**
 * 입력 규칙 — 줄 맨 앞에서 `- ` · `* ` · `+ ` 를 치면 그 줄이 항목이 된다.
 * 마커 글자는 지우고 **새 항목의 마커는 `-`**다(새로 적는 항목은 `- 항목`으로 나간다).
 *
 * `at`은 방금 친 스페이스가 들어갈 자리다(스페이스는 문서에 넣지 않는다).
 */
export function bulletFromInput(state: EditorState, at: number): Transaction | null {
  if (!state.selection.empty || inTable(state) || queryBullet(state)) return null;
  const r = readLines(state);
  if (!r) return null;
  const p = linePosOf(r, at);
  const l = r.lines[p.line];
  if (l.item || l.heading > 0 || p.off !== 1 || l.content.size < 1) return null;
  const ch = l.content.textBetween(0, 1, "", "");
  if (ch.length !== 1 || !MARKERS.includes(ch)) return null;
  const lines = r.lines.map((x, k) =>
    k === p.line
      ? {
          ...x,
          item: true,
          level: 0,
          marker: "-",
          indent: null,
          heading: 0,
          content: x.content.cut(1),
        }
      : x
  );
  const put = { line: p.line, off: 0 };
  return applyLines(state, r, lines, put, put);
}
