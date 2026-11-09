/**
 * 마크다운 모드의 줄·칸·글자 수 (설계 문서 §9 · §12-6).
 *
 * 기준은 **편집 중 논리 줄**이다: 빈 단락 1줄, 소프트 줄바꿈 1줄, 표는 행마다 1줄.
 * 저장 파일의 줄 번호와 1~2 다를 수 있다(원본도 RichEdit 줄 기준이라 같은 성질).
 *
 * 문서 전체를 세는 값은 **문서 노드마다 한 번만** 계산해 `WeakMap`에 담아 둔다.
 * 선택만 바뀐 경우에는 다시 세지 않는다.
 */

import type { Node as PmNode } from "prosemirror-model";

import { schema } from "../md/pmdoc";

export interface DocLineIndex {
  /** 블록 i가 시작하는 논리 줄 번호(0-based). 길이 = `childCount + 1`. */
  prefix: number[];
  lines: number;
  chars: number;
}

const cache = new WeakMap<PmNode, DocLineIndex>();

/** 텍스트블록 안의 소프트 줄바꿈 개수. */
function softBreaks(node: PmNode): number {
  let n = 0;
  node.forEach((child) => {
    if (child.type === schema.nodes.soft_break) n += 1;
  });
  return n;
}

/** 목록 안의 항목 단락들 — 줄·칸 셈과 줄 번호가 같은 길을 쓴다. */
function itemParas(list: PmNode): { pos: number; node: PmNode }[] {
  const out: { pos: number; node: PmNode }[] = [];
  list.descendants((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return true;
    out.push({ pos, node });
    return false;
  });
  return out;
}

function blockShape(node: PmNode): { lines: number; chars: number } {
  // 글머리 기호 목록: **항목마다 한 줄**이다(표가 행마다 한 줄인 것과 같은 셈).
  if (node.type === schema.nodes.bullet_list) {
    const paras = itemParas(node);
    let chars = 0;
    for (const p of paras) chars += p.node.content.size;
    return { lines: Math.max(paras.length, 1), chars };
  }
  if (node.type === schema.nodes.table) {
    let lines = 0;
    let chars = 0;
    node.forEach((row) => {
      lines += 1;
      row.forEach((cell) => {
        chars += cell.content.size;
      });
    });
    return { lines: Math.max(lines, 1), chars };
  }
  // 단락·제목: 인라인 내용의 크기가 곧 글자 수이고(소프트 줄바꿈은 1 = 줄바꿈 한 글자),
  // 줄 수는 1 + 소프트 줄바꿈 개수다.
  return { lines: 1 + softBreaks(node), chars: node.content.size };
}

export function docLineIndex(doc: PmNode): DocLineIndex {
  const hit = cache.get(doc);
  if (hit) return hit;
  const prefix: number[] = [0];
  let lines = 0;
  let chars = 0;
  doc.forEach((node, _offset, index) => {
    const s = blockShape(node);
    lines += s.lines;
    // 블록 사이의 줄바꿈 한 글자(원본 RichEdit의 단락 마크와 같은 셈).
    chars += s.chars + (index > 0 ? 1 : 0);
    prefix.push(lines);
  });
  if (doc.childCount === 0) {
    lines = 1;
    prefix.push(1);
  }
  const out: DocLineIndex = { prefix, lines, chars };
  cache.set(doc, out);
  return out;
}

/** 문서 위치 하나 → 1-based 줄/칸. */
export function lineColAt(doc: PmNode, pos: number): { line: number; col: number } {
  const index = docLineIndex(doc);
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(at);
  if ($pos.depth === 0) {
    const i = Math.min($pos.index(0), Math.max(doc.childCount - 1, 0));
    return { line: (index.prefix[i] ?? 0) + 1, col: 1 };
  }
  const blockIndex = $pos.index(0);
  const base = index.prefix[blockIndex] ?? 0;
  const top = doc.child(Math.min(blockIndex, Math.max(doc.childCount - 1, 0)));

  if (top.type === schema.nodes.table) {
    // 표 안: 행이 줄이고, 칸은 셀 안의 글자 수다.
    const rowIndex = $pos.depth >= 2 ? $pos.index(1) : 0;
    return { line: base + rowIndex + 1, col: $pos.parentOffset + 1 };
  }

  if (top.type === schema.nodes.bullet_list) {
    // 목록 안: 항목이 줄이다. 커서가 든 항목이 몇 번째인지 센다.
    let topStart = 0;
    doc.forEach((_node, offset, i) => {
      if (i === blockIndex) topStart = offset;
    });
    const paras = itemParas(top);
    let row = 0;
    for (let k = 0; k < paras.length; k += 1) {
      const start = topStart + 1 + paras[k].pos + 1;
      if (start <= at) row = k;
    }
    return { line: base + row + 1, col: $pos.parentOffset + 1 };
  }

  // 단락·제목: 소프트 줄바꿈이 줄을 쪼갠다.
  let line = 0;
  let col = $pos.parentOffset;
  $pos.parent.forEach((child, offset) => {
    if (child.type !== schema.nodes.soft_break) return;
    if (offset < $pos.parentOffset) {
      line += 1;
      col = $pos.parentOffset - (offset + 1);
    }
  });
  return { line: base + line + 1, col: col + 1 };
}

/** 선택 범위의 글자 수(표 경계 같은 구조 위치는 세지 않는다). */
export function selectionChars(doc: PmNode, from: number, to: number): number {
  if (to <= from) return 0;
  let n = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const a = Math.max(from, pos);
      const b = Math.min(to, pos + node.nodeSize);
      if (b > a) n += b - a;
      return false;
    }
    if (node.type === schema.nodes.soft_break) {
      if (pos >= from && pos < to) n += 1;
      return false;
    }
    return true;
  });
  return n;
}
