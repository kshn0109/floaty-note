/**
 * 인라인 규칙 — 원본 `main.cpp` 2550~2700행(`ParseInline`, `ParseInlineHl`, `NeedsEscape`,
 * `EmitEmphasis`, `EmitInline`)을 그대로 옮긴 것. 설계 문서 §4-4.
 *
 * **파서와 직렬화기는 거울**이다. 한쪽만 고치면 바이트 왕복이 깨진다.
 */

import { delimiterAligns } from "./table";
import {
  EM_BOLD,
  EM_ITALIC,
  EM_STRIKE,
  HL_DEFAULT,
  isAsciiPunct,
  isMdSpace,
  type MdOptions,
  type Pred,
  type Run,
} from "./types";

// --------------------------------------------------------------------------- 읽기

interface Item {
  ch: string;
  esc: boolean;
  em: number;
  del: boolean;
}

interface Delim {
  start: number;
  len: number;
  c: string;
  canOpen: boolean;
  canClose: boolean;
}

/** 강조 마커만 처리한다(형광펜은 `parseInlineHl`이 먼저 잘라낸다). */
function parseInline(line: string, P: Pred): Run[] {
  const items: Item[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\" && i + 1 < line.length && isAsciiPunct(line[i + 1])) {
      items.push({ ch: line[i + 1], esc: true, em: 0, del: false });
      i += 1;
    } else {
      items.push({ ch: line[i], esc: false, em: 0, del: false });
    }
  }

  const delims: Delim[] = [];
  for (let i = 0; i < items.length; ) {
    const c = items[i].ch;
    if (items[i].esc || (c !== "*" && c !== "_" && c !== "~")) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < items.length && !items[j].esc && items[j].ch === c) j += 1;
    const prev = i > 0 ? items[i - 1].ch : " ";
    const next = j < items.length ? items[j].ch : " ";
    const prevWs = isMdSpace(prev);
    const nextWs = isMdSpace(next);
    const prevP = P.isPunctCh(prev);
    const nextP = P.isPunctCh(next);
    const left = !nextWs && (!nextP || prevWs || prevP);
    const right = !prevWs && (!prevP || nextWs || nextP);
    const d: Delim = { start: i, len: j - i, c, canOpen: left, canClose: right };
    if (c === "_") {
      d.canOpen = left && (!right || prevP);
      d.canClose = right && (!left || nextP);
    }
    delims.push(d);
    i = j;
  }

  const openers: number[] = [];
  for (let di = 0; di < delims.length; di += 1) {
    const cl = delims[di];
    if (cl.canClose) {
      while (cl.len > 0) {
        const need = cl.c === "~" ? 2 : 1;
        if (cl.len < need) break;
        let found = openers.length;
        for (let k = openers.length; k > 0; k -= 1) {
          const op = delims[openers[k - 1]];
          if (op.c === cl.c && op.len >= need) {
            found = k - 1;
            break;
          }
        }
        if (found === openers.length) break;
        const op = delims[openers[found]];
        const use = cl.c === "~" ? 2 : op.len >= 2 && cl.len >= 2 ? 2 : 1;
        const flag = cl.c === "~" ? EM_STRIKE : use === 2 ? EM_BOLD : EM_ITALIC;
        const opEnd = op.start + op.len;
        for (let t = opEnd - use; t < opEnd; t += 1) items[t].del = true;
        for (let t = cl.start; t < cl.start + use; t += 1) items[t].del = true;
        for (let t = opEnd; t < cl.start; t += 1) items[t].em |= flag;
        op.len -= use;
        cl.start += use;
        cl.len -= use;
        openers.length = found + (delims[openers[found]].len > 0 ? 1 : 0);
      }
    }
    if (cl.len > 0 && cl.canOpen) openers.push(di);
  }

  const runs: Run[] = [];
  for (const it of items) {
    if (it.del) continue;
    const last = runs[runs.length - 1];
    if (last && last.em === it.em && last.hl === null) last.text += it.ch;
    else runs.push({ text: it.ch, em: it.em, hl: null });
  }
  return runs;
}

/** `#RGB` / `#RRGGBB` → `#RRGGBB`(대문자). 아니면 `null`. */
function parseHexColor(s: string, start: number): string | null {
  let i = start;
  if (i >= s.length || s[i] !== "#") return null;
  i += 1;
  let n = 0;
  const d: number[] = [];
  while (n < 6 && i + n < s.length) {
    const v = parseInt(s[i + n], 16);
    if (Number.isNaN(v)) break;
    d.push(v);
    n += 1;
  }
  const hex = (r: number, g: number, b: number): string =>
    `#${[r, g, b].map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
  if (n === 3) return hex(d[0] * 17, d[1] * 17, d[2] * 17);
  if (n === 6) return hex(d[0] * 16 + d[1], d[2] * 16 + d[3], d[4] * 16 + d[5]);
  return null;
}

/** `<mark ...>` 여는 태그. `background:`와 `background-color:` 둘 다 받는다. */
function parseMarkOpen(s: string, i: number): { inner: number; color: string } | null {
  if (s.slice(i, i + 5) !== "<mark") return null;
  const close = s.indexOf(">", i + 5);
  if (close < 0) return null;
  const after = s[i + 5];
  if (after !== ">" && after !== " " && after !== "\t") return null;
  const attrs = s.slice(i + 5, close);
  let color = HL_DEFAULT;
  for (const key of ["background-color:", "background:"]) {
    const at = attrs.indexOf(key);
    if (at < 0) continue;
    let p = at + key.length;
    while (p < attrs.length && (attrs[p] === " " || attrs[p] === "\t")) p += 1;
    const c = parseHexColor(attrs, p);
    if (c) color = c;
    break;
  }
  return { inner: close + 1, color };
}

/** 한 줄 → `Run[]`. 형광펜 구간을 먼저 자르고 그 안에서 강조를 읽는다. */
export function parseInlineHl(line: string, P: Pred): Run[] {
  const out: Run[] = [];
  let plain = 0;
  const flushPlain = (end: number): void => {
    if (end <= plain) return;
    for (const r of parseInline(line.slice(plain, end), P)) out.push(r);
  };
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\") {
      i += 1;
      continue;
    }
    let inner: number;
    let innerEnd: number;
    let resume: number;
    let color: string;
    const mo = line[i] === "<" ? parseMarkOpen(line, i) : null;
    if (mo) {
      const end = line.indexOf("</mark>", mo.inner);
      if (end < 0) continue;
      inner = mo.inner;
      innerEnd = end;
      resume = end + 7;
      color = mo.color;
    } else if (line.slice(i, i + 2) === "==") {
      const end = line.indexOf("==", i + 2);
      if (end < 0 || end === i + 2) continue;
      inner = i + 2;
      innerEnd = end;
      resume = end + 2;
      color = HL_DEFAULT;
    } else continue;
    flushPlain(i);
    for (const r of parseInline(line.slice(inner, innerEnd), P)) {
      r.hl = color;
      out.push(r);
    }
    plain = resume;
    i = resume - 1;
  }
  flushPlain(line.length);

  const merged: Run[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.em === r.em && last.hl === r.hl) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged;
}

// --------------------------------------------------------------------------- 쓰기

/**
 * 이 글자들이 줄에서 어디에 놓이는가 — 이스케이프 판정이 달라진다.
 *   · `line` : 단락·제목의 한 줄 전체(줄 맨 앞 규칙이 다 걸린다)
 *   · `cell` : 표 칸 안
 *   · `item` : 글머리 기호 항목의 글자(`- ` 뒤에서 시작한다)
 */
export type EmitCtx = "line" | "cell" | "item";

/** 줄 맨 앞의 `- ` / `* ` / `+ ` 자리인가 — 파서 `itemPrefix`와 **같은 판정**이다. */
function isListMarker(s: string, i: number, ctx: EmitCtx): boolean {
  if (ctx !== "line") return false;
  if (s[i + 1] !== " ") return false;
  for (let k = 0; k < i; k += 1) if (s[k] !== " ") return false;
  return true;
}

/**
 * 원본 `NeedsEscape`(main.cpp:2649) — **우리 파서가 오해할 글자만** 이스케이프한다.
 * 그래서 `- 항목`·`[링크](url)`·코드펜스는 이스케이프 없이 그대로 나간다.
 */
function needsEscape(
  s: string,
  i: number,
  escPipe: boolean,
  inHeading: boolean,
  P: Pred,
  opts: MdOptions,
  ctx: EmitCtx
): boolean {
  const n = s.length;
  const c = s[i];
  const prev = i > 0 ? s[i - 1] : " ";
  const next = i + 1 < n ? s[i + 1] : " ";
  switch (c) {
    case "\\":
      return opts.strictBackslash ? true : isAsciiPunct(next);
    case "*":
      // 줄 맨 앞의 `* `·`- `·`+ `는 **글머리 기호 문법**이다 — 글자로 남기려면 반드시
      // 이스케이프해야 한다(파서의 `itemPrefix`와 거울). 표 칸·항목 글자는 줄 맨 앞이
      // 아니므로 해당 없다.
      if (isListMarker(s, i, ctx)) return true;
      return !isMdSpace(prev) || !isMdSpace(next);
    case "-":
    case "+":
      return isListMarker(s, i, ctx);
    case "~":
      return prev === "~" || next === "~";
    case "_":
      return !P.isWordCh(prev) || !P.isWordCh(next);
    case "|":
      return escPipe;
    case "=":
      return prev === "=" || next === "=";
    case "<": {
      const tail = s.slice(i, i + 6);
      return tail.startsWith("<mark") || tail.startsWith("</mark");
    }
    case "#":
      if (!inHeading) {
        // 줄 맨 앞이 아니면 제목으로 오해될 일이 없다. 글머리 기호 항목의 글자는
        // `- ` 뒤에서 시작하므로 `item`이다(`- # 할 일`을 그대로 적는다).
        if (i !== 0 || ctx === "item") return false;
        let k = 0;
        while (k < n && s[k] === "#") k += 1;
        return k <= 6 && (k === n || isMdSpace(s[k]));
      } else {
        let k = i;
        while (k < n && s[k] === "#") k += 1;
        return k === n && (i === 0 || isMdSpace(prev) || prev === "#");
      }
    default:
      return false;
  }
}

/** 마커 중첩 우선순위는 고정이다: `~~` 바깥 → `**` → `*`. */
const MARKS = ["~~", "**", "*"];
const BITS = [EM_STRIKE, EM_BOLD, EM_ITALIC];

/** 형광펜이 균일한 한 묶음 → 강조 마커가 붙은 문자열. */
function emitEmphasis(
  runs: Run[],
  escPipe: boolean,
  inHeading: boolean,
  P: Pred,
  opts: MdOptions,
  ctx: EmitCtx
): string {
  let s = "";
  const em: number[] = [];
  for (const r of runs) {
    s += r.text;
    for (let i = 0; i < r.text.length; i += 1) em.push(r.em);
  }
  const n = s.length;
  // 강조 구간의 앞뒤 공백은 마커 밖으로 밀어낸다(`** 굵게 **`는 마크다운이 아니다).
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && em[j] === em[i]) j += 1;
    if (em[i] !== 0) {
      let a = i;
      let b = j;
      while (a < b && isMdSpace(s[a])) {
        em[a] = 0;
        a += 1;
      }
      while (b > a && isMdSpace(s[b - 1])) {
        b -= 1;
        em[b] = 0;
      }
    }
    i = j;
  }
  let out = "";
  const openStack: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const want: number[] = [];
    for (let k = 0; k < 3; k += 1) if (em[i] & BITS[k]) want.push(k);
    let p = 0;
    while (p < openStack.length && p < want.length && openStack[p] === want[p]) p += 1;
    if (p < openStack.length) {
      for (let k = openStack.length; k > p; k -= 1) out += MARKS[openStack[k - 1]];
      openStack.length = p;
    }
    for (let k = p; k < want.length; k += 1) {
      out += MARKS[want[k]];
      openStack.push(want[k]);
    }
    if (needsEscape(s, i, escPipe, inHeading, P, opts, ctx)) out += "\\";
    out += s[i];
  }
  for (let k = openStack.length; k > 0; k -= 1) out += MARKS[openStack[k - 1]];
  return out;
}

/**
 * `Run[]` → 한 줄의 마크다운. **형광펜이 가장 바깥**이다: 색이 같은 구간으로 먼저 자르고
 * 그 안에서 강조 마커를 열고 닫는다. 기본색은 `==text==`, 나머지는 `<mark style>`.
 */
export function emitInline(
  runs: Run[],
  escPipe: boolean,
  inHeading: boolean,
  P: Pred,
  opts: MdOptions,
  /** 줄에서의 자리(기본 = 단락·제목의 한 줄). 표 칸은 `cell`, 항목 글자는 `item`. */
  ctx: EmitCtx = "line"
): string {
  let out = "";
  for (let i = 0; i < runs.length; ) {
    let j = i;
    while (j < runs.length && runs[j].hl === runs[i].hl) j += 1;
    const group = runs.slice(i, j).map((r) => ({ ...r }));
    const hl = runs[i].hl;
    i = j;
    if (hl === null) {
      // 줄 맨 앞 규칙은 **정말 줄 맨 앞인 묶음**에만 건다.
      out += emitEmphasis(group, escPipe, inHeading, P, opts, out === "" ? ctx : "cell");
      continue;
    }
    // 형광펜 구간의 앞뒤 공백도 마커 밖으로 (`== 글 ==`은 형광펜이 아니다).
    let lead = "";
    let trail = "";
    while (group.length) {
      const t = group[0].text;
      let k = 0;
      while (k < t.length && isMdSpace(t[k])) k += 1;
      lead += t.slice(0, k);
      group[0].text = t.slice(k);
      if (group[0].text !== "") break;
      group.shift();
    }
    while (group.length) {
      const t = group[group.length - 1].text;
      let k = t.length;
      while (k > 0 && isMdSpace(t[k - 1])) k -= 1;
      trail = t.slice(k) + trail;
      group[group.length - 1].text = t.slice(0, k);
      if (group[group.length - 1].text !== "") break;
      group.pop();
    }
    out += lead;
    if (group.length === 0) {
      out += trail;
      continue;
    }
    const isDefault = hl.toUpperCase() === HL_DEFAULT;
    out += isDefault ? "==" : `<mark style="background:${hl.toUpperCase()}">`;
    out += emitEmphasis(group, escPipe, inHeading, P, opts, "cell");
    out += isDefault ? "==" : "</mark>";
    out += trail;
  }
  return out;
}

/** 단락의 다음 줄이 구분 행처럼 보이는가 — 그때만 이 줄의 `|`를 이스케이프한다. */
export function nextLineLooksLikeDelimiter(plain: string): boolean {
  return delimiterAligns(plain) !== null;
}
