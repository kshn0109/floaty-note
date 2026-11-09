/**
 * 마크다운 중간 모델 — 원본 `main.cpp` §"Markdown bridge (Phase 4)"(2443~3460행)의
 * `MdRun` / 블록 규칙을 그대로 옮긴 것. 설계 문서 `docs/EDITOR_DESIGN.md` §4.
 *
 * 이 폴더(`src/lib/md`)는 **UI·Tauri·React를 import 하지 않는 순수 모듈**이다.
 * 그래서 Node(vitest)로 바로 단위 시험할 수 있고, 편집기 엔진이 무엇이든 규격은 하나다.
 */

/** `Run.em` 비트 — 원본 `kEmBold/kEmItalic/kEmStrike`. */
export const EM_BOLD = 1;
export const EM_ITALIC = 2;
export const EM_STRIKE = 4;

/** 형광펜 기본색(`kHlColors[0]`, 노랑). 이 색만 `==text==`로 쓴다. */
export const HL_DEFAULT = "#FFEB3B";

/** 서식이 균일한 글자 토막. `hl`은 형광펜 색(`#RRGGBB`) 또는 없음. */
export interface Run {
  text: string;
  em: number;
  hl: string | null;
}

/** 표의 열 정렬. 파일로 나가는 값은 **머리 행(0행)**의 것이다(원본과 동일). */
export type Align = "left" | "center" | "right";

/**
 * 글머리 기호 목록의 항목 **한 줄**.
 *
 * **바이트 보존이 먼저다**(사용자 지시): 원래 파일이 `*`·`+`를 썼으면 그 마커를,
 * 들여쓰기 칸 수가 2칸이 아니면 그 들여쓰기를 **그대로** 되돌려 쓴다. 그래서 목록이
 * 있는 기존 파일을 열고 그냥 저장하면 바이트가 한 개도 바뀌지 않는다.
 *
 * `indent`가 `null`이면 "원문에 근거가 없다"(편집기에서 새로 만든 항목)는 뜻이고,
 * 그때만 직렬화기가 `level`을 보고 2칸씩 들여쓴다.
 */
export interface ListItem {
  /** 중첩 깊이(0부터). 파서는 0에서 시작해 **한 단계씩만** 깊어지게 정규화한다. */
  level: number;
  /** 원문 마커 — `-` · `*` · `+` 중 하나. 새 항목은 `-`. */
  marker: string;
  /** 원문 들여쓰기(스페이스만). `null`이면 `level`로 계산해 적는다. */
  indent: string | null;
  /** 항목 한 줄의 글자. 항목은 **한 줄**이다(소프트 줄바꿈 없음). */
  runs: Run[];
}

/**
 * 블록 하나. `empty`는 빈 단락이고, 빈 줄 개수 규칙은 §4-2의 비대칭 규칙을 따른다
 * (글 블록 사이 빈 줄 N+1개 ↔ 빈 단락 N개).
 */
export type Block =
  | { kind: "empty" }
  | { kind: "para"; lines: Run[][] }
  | { kind: "heading"; level: number; lines: Run[][] }
  /**
   * 글머리 기호 목록 **한 덩어리**(붙어 있는 항목 줄 전체). 표처럼 블록 하나가 여러
   * 줄을 내므로 §4-2의 "글 블록 사이 빈 줄 1개" 규칙이 **목록 안에는 끼어들지 않는다**.
   */
  | { kind: "list"; items: ListItem[] }
  | { kind: "table"; aligns: Align[]; rows: Run[][][] };

/**
 * 왕복을 좌우하는 두 규칙의 스위치.
 *
 * 원본(`main.cpp`)은 ① 백슬래시를 **무조건** 이스케이프하고(`case L'\\': return true`),
 * ② `iswalnum`(C 로케일 = ASCII)으로 단어 글자를 판정해 `한글_밑줄_`을 `한글\_밑줄\_`로
 * 바꾼다. 둘 다 사용자 파일의 바이트를 바꾸는 쪽이라 **고치기로 결정**했다
 * (설계 문서 §12-2, 사용자 결정 2). 고친 쪽도 파서와 정확한 역함수다.
 */
export interface MdOptions {
  /** true면 `\`를 무조건 이스케이프(원본). false면 뒤가 ASCII 구두점일 때만. */
  strictBackslash: boolean;
  /** true면 한글·한자도 단어 글자로 본다. false면 ASCII만(원본). */
  unicodeWords: boolean;
}

/** 이 앱이 쓰는 규칙 — 원본 버그 2건을 고친 쪽(사용자 결정 2). */
export const INKWELL_OPTS: MdOptions = { strictBackslash: false, unicodeWords: true };
/** 원본과 바이트까지 같은 규칙. 비교 시험에만 쓴다. */
export const ORIGINAL_OPTS: MdOptions = { strictBackslash: true, unicodeWords: false };

export const defaultOpts: MdOptions = INKWELL_OPTS;

/** 파서 결과. `lineStart[i]`는 블록 i를 만든 첫 줄의 번호(원문 보존에 쓴다). */
export interface ParsedMarkdown {
  blocks: Block[];
  lineStart: number[];
  lines: string[];
  endsWithNewline: boolean;
}

/** 파서 결과 + 읽은 원문. 저장할 때 바이트 보존의 기준이 된다(§4-3). */
export interface LoadedMarkdown extends ParsedMarkdown {
  text: string;
}

/** 단어/구두점 판정 한 쌍. **파서와 직렬화기가 같은 것을 써야** 왕복이 맞는다. */
export interface Pred {
  isWordCh(c: string): boolean;
  isPunctCh(c: string): boolean;
}

const RE_UWORD = /^[\p{L}\p{N}_]$/u;
const RE_ASCII_WORD = /^[0-9A-Za-z_]$/;
const RE_ASCII_PUNCT = /^[!-/:-@[-`{-~]$/;
const RE_UPUNCT = /^[\p{P}\p{S}]$/u;

export const isMdSpace = (c: string): boolean => c === " " || c === "\t";
export const isAsciiPunct = (c: string): boolean => RE_ASCII_PUNCT.test(c);

export function mkPred(opts: MdOptions): Pred {
  if (opts.unicodeWords) {
    return { isWordCh: (c) => RE_UWORD.test(c), isPunctCh: (c) => RE_UPUNCT.test(c) };
  }
  return { isWordCh: (c) => RE_ASCII_WORD.test(c), isPunctCh: (c) => RE_ASCII_PUNCT.test(c) };
}

/** 마크다운에서 공백은 스페이스와 탭뿐이다(원본 `TrimMd`). */
export const trimMd = (s: string): string => s.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");

/** 줄 목록의 글자만 이어 붙인다. */
export const plainOf = (runs: Run[]): string => runs.map((r) => r.text).join("");

// ---------------------------------------------------------------------------
// 블록 깊은 비교 — 원문 보존(§4-3)의 접두부/접미부 길이를 구할 때 쓴다.
// JSON.stringify 비교는 키 순서에 기대므로 쓰지 않는다.
// ---------------------------------------------------------------------------

function runsEqual(a: Run[], b: Run[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].text !== b[i].text || a[i].em !== b[i].em || a[i].hl !== b[i].hl) return false;
  }
  return true;
}

function linesEqual(a: Run[][], b: Run[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!runsEqual(a[i], b[i])) return false;
  return true;
}

export function blocksEqual(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "empty") return true;
  if (a.kind === "para" && b.kind === "para") return linesEqual(a.lines, b.lines);
  if (a.kind === "heading" && b.kind === "heading") {
    return a.level === b.level && linesEqual(a.lines, b.lines);
  }
  if (a.kind === "list" && b.kind === "list") {
    if (a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i += 1) {
      const x = a.items[i];
      const y = b.items[i];
      if (x.level !== y.level || x.marker !== y.marker || x.indent !== y.indent) return false;
      if (!runsEqual(x.runs, y.runs)) return false;
    }
    return true;
  }
  if (a.kind === "table" && b.kind === "table") {
    if (a.aligns.length !== b.aligns.length || a.rows.length !== b.rows.length) return false;
    for (let i = 0; i < a.aligns.length; i += 1) if (a.aligns[i] !== b.aligns[i]) return false;
    for (let r = 0; r < a.rows.length; r += 1) {
      if (!linesEqual(a.rows[r], b.rows[r])) return false;
    }
    return true;
  }
  return false;
}

export function blockListsEqual(a: readonly Block[], b: readonly Block[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!blocksEqual(a[i], b[i])) return false;
  return true;
}
