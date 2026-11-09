/**
 * 마크다운 모드의 ProseMirror 스키마 + 블록 목록 ↔ 문서 변환 (설계 문서 §3-1).
 *
 * 스키마에 들어가는 것은 **파일로 나가는 것만**이다. 글자 뒤 배경·찾기 강조처럼
 * 표시 전용 속성은 데코레이션으로 하고 문서 모델에 넣지 않는다(§9-2).
 */

import { Fragment, Schema, type Node as PmNode, type NodeSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

import {
  EM_BOLD,
  EM_ITALIC,
  EM_STRIKE,
  type Align,
  type Block,
  type ListItem,
  type Run,
} from "./types";

const ALIGNS: readonly Align[] = ["left", "center", "right"];

function asAlign(v: unknown): Align {
  return typeof v === "string" && (ALIGNS as readonly string[]).includes(v) ? (v as Align) : "left";
}

const tn = tableNodes({
  tableGroup: "block",
  cellContent: "inline*",
  cellAttributes: {
    align: {
      default: "left",
      getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || "left",
      setDOMAttr: (value, attrs) => {
        if (value !== "left") attrs.style = `text-align:${String(value)}`;
      },
    },
  },
}) as Record<string, NodeSpec>;

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${String(node.attrs.level)}`, 0],
    },
    /**
     * 글머리 기호 목록 — 승인된 시안 L1. **파일로 나가는 것만** 스키마에 넣는 원칙대로
     * 마커(`-`/`*`/`+`)와 원문 들여쓰기를 `list_item`의 속성으로 들고 있다(바이트 보존).
     * 표시용 기호(• ◦ ▪)는 CSS가 그린다(`index.css`) — 문서에 들어가지 않는다.
     */
    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", { class: "bullets" }, 0],
    },
    /**
     * 항목 하나. 내용은 **단락 하나 + 그 아래 중첩 목록(선택)**이다.
     *
     * 단락을 **하나만** 허용하는 것이 중요하다: 여러 개를 허용하면 `baseKeymap`의
     * `splitBlock`이 항목 **안에서** 단락을 쪼개 "항목 하나에 두 줄"이 생기는데,
     * 마크다운으로는 그것을 한 줄짜리 항목 문법으로 적을 수 없어 왕복이 깨진다.
     */
    list_item: {
      content: "paragraph bullet_list?",
      defining: true,
      attrs: {
        marker: { default: "-" },
        /** 원문 들여쓰기 그대로. `null`이면 직렬화기가 중첩 깊이로 계산한다. */
        indent: { default: null },
      },
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    // 원본 RichEdit의 U+000B(`\line`)에 대응. `Shift+Enter`로 넣고, 파일에서는
    // "빈 줄 없이 붙어 있던 줄"이 된다.
    soft_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br", { class: "soft" }],
    },
    text: { group: "inline" },
    ...tn,
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0],
    },
    // 저장되는 색만 attr로 둔다 — 표시 전용 속성과 섞이지 않게.
    highlight: {
      attrs: { color: { default: "#FFEB3B" } },
      parseDOM: [{ tag: "mark" }],
      toDOM: (mark) => ["mark", { style: `background:${String(mark.attrs.color)}` }],
    },
  },
});

function marksOf(run: Run) {
  const m = [];
  if (run.em & EM_STRIKE) m.push(schema.marks.strike.create());
  if (run.em & EM_BOLD) m.push(schema.marks.strong.create());
  if (run.em & EM_ITALIC) m.push(schema.marks.em.create());
  if (run.hl) m.push(schema.marks.highlight.create({ color: run.hl }));
  return m;
}

function inlineOfLines(lines: readonly Run[][]): PmNode[] {
  const out: PmNode[] = [];
  lines.forEach((runs, i) => {
    if (i) out.push(schema.nodes.soft_break.create());
    for (const r of runs) if (r.text !== "") out.push(schema.text(r.text, marksOf(r)));
  });
  return out;
}

/** 마커·들여쓰기 속성 읽기 — 손으로 만든 문서(붙여넣기 등)에서 와도 안전하게. */
function markerOf(li: PmNode): string {
  const m = li.attrs.marker;
  return m === "-" || m === "*" || m === "+" ? m : "-";
}

function indentOf(li: PmNode): string | null {
  const v = li.attrs.indent;
  return typeof v === "string" ? v : null;
}

/**
 * 평평한 항목 목록(`level`) → **중첩된** `bullet_list`.
 *
 * 파서가 깊이를 한 단계씩만 늘려 주지만(정규화), 깊이가 뛰어도 깨지지 않게 "뛴 만큼은
 * 바로 앞 항목의 자식"으로 받는다.
 */
function buildItems(
  items: readonly ListItem[],
  start: number,
  level: number
): { nodes: PmNode[]; next: number } {
  const nodes: PmNode[] = [];
  let i = start;
  while (i < items.length && items[i].level >= level) {
    if (items[i].level > level) {
      const sub = buildItems(items, i, items[i].level);
      const list = schema.nodes.bullet_list.create(null, sub.nodes);
      if (nodes.length > 0) {
        const prev = nodes[nodes.length - 1];
        nodes[nodes.length - 1] = prev.type.create(
          prev.attrs,
          Fragment.from([prev.child(0), list])
        );
      } else {
        nodes.push(
          schema.nodes.list_item.create(null, [schema.nodes.paragraph.create(), list])
        );
      }
      i = sub.next;
      continue;
    }
    const it = items[i];
    nodes.push(
      schema.nodes.list_item.create(
        { marker: it.marker, indent: it.indent },
        schema.nodes.paragraph.create(null, inlineOfLines([it.runs]))
      )
    );
    i += 1;
  }
  return { nodes, next: i };
}

function listToNode(items: readonly ListItem[]): PmNode {
  if (items.length === 0) return schema.nodes.paragraph.create();
  return schema.nodes.bullet_list.create(null, buildItems(items, 0, items[0].level).nodes);
}

/** `bullet_list` → 평평한 항목 목록. 항목 **한 줄 = 항목 하나**다. */
function nodeToItems(list: PmNode, level: number, out: ListItem[]): void {
  list.forEach((li) => {
    const marker = markerOf(li);
    const indent = indentOf(li);
    // 한 항목에 소프트 줄바꿈이 들어오면(붙여넣기) **줄마다 항목**으로 쪼갠다 —
    // 마크다운에 "두 줄짜리 항목" 문법이 없으므로 그래야 왕복이 맞는다.
    for (const runs of runsOfInline(li.child(0))) out.push({ level, marker, indent, runs });
    if (li.childCount > 1) nodeToItems(li.child(1), level + 1, out);
  });
}

export function blocksToDoc(blocks: readonly Block[]): PmNode {
  const nodes = blocks.map((b) => {
    if (b.kind === "empty") return schema.nodes.paragraph.create();
    if (b.kind === "para") return schema.nodes.paragraph.create(null, inlineOfLines(b.lines));
    if (b.kind === "list") return listToNode(b.items);
    if (b.kind === "heading") {
      return schema.nodes.heading.create({ level: b.level }, inlineOfLines(b.lines));
    }
    const rows = b.rows.map((row, ri) =>
      schema.nodes.table_row.create(
        null,
        row.map((cell, ci) => {
          const type = ri === 0 ? schema.nodes.table_header : schema.nodes.table_cell;
          return type.create({ align: b.aligns[ci] ?? "left" }, inlineOfLines([cell]));
        })
      )
    );
    return schema.nodes.table.create(null, rows);
  });
  return schema.nodes.doc.create(null, nodes);
}

/** 인라인 내용 → 줄 목록(`soft_break`가 줄을 쪼갠다). */
function runsOfInline(node: PmNode): Run[][] {
  const lines: Run[][] = [[]];
  node.forEach((child) => {
    if (child.type === schema.nodes.soft_break) {
      lines.push([]);
      return;
    }
    let em = 0;
    let hl: string | null = null;
    for (const m of child.marks) {
      if (m.type === schema.marks.strong) em |= EM_BOLD;
      else if (m.type === schema.marks.em) em |= EM_ITALIC;
      else if (m.type === schema.marks.strike) em |= EM_STRIKE;
      else if (m.type === schema.marks.highlight) hl = String(m.attrs.color);
    }
    const cur = lines[lines.length - 1];
    const last = cur[cur.length - 1];
    const text = child.text ?? "";
    if (last && last.em === em && last.hl === hl) last.text += text;
    else cur.push({ text, em, hl });
  });
  return lines;
}

export function docToBlocks(doc: PmNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    if (node.type === schema.nodes.paragraph) {
      const lines = runsOfInline(node);
      if (lines.length === 1 && lines[0].length === 0) blocks.push({ kind: "empty" });
      else blocks.push({ kind: "para", lines });
    } else if (node.type === schema.nodes.heading) {
      blocks.push({ kind: "heading", level: Number(node.attrs.level), lines: runsOfInline(node) });
    } else if (node.type === schema.nodes.bullet_list) {
      const items: ListItem[] = [];
      nodeToItems(node, 0, items);
      if (items.length > 0) blocks.push({ kind: "list", items });
    } else if (node.type === schema.nodes.table) {
      const rows: Run[][][] = [];
      const aligns: Align[] = [];
      node.forEach((row, _offset, ri) => {
        const cells: Run[][] = [];
        row.forEach((cell, _o2, ci) => {
          if (ri === 0) aligns[ci] = asAlign(cell.attrs.align);
          cells.push(runsOfInline(cell).flat());
        });
        rows.push(cells);
      });
      blocks.push({ kind: "table", aligns, rows });
    }
  });
  return blocks;
}
