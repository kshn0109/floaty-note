/**
 * 마크다운 모드 편집기 — ProseMirror (설계 문서 §3-1 · §3-3).
 *
 * 탭마다 이 호스트가 하나씩 있고, **뷰는 살아 있는 채로 DOM만 옮긴다**(`mount`/`unmount`).
 * 그래서 탭을 오갈 때 문서·선택·스크롤·실행취소가 그대로 남고, 탭 전환은 트랜잭션이
 * 아니므로 수정 표시에 영향이 없다(MIGRATION_HANDOFF §7).
 *
 * 설계 문서 §10은 "뷰 하나 + `updateState`"를 적었는데, 탭마다 뷰를 살려 두는 쪽이
 * 같은 보증을 더 적은 코드로 준다(상태를 옮겨 담지 않으므로 스크롤·IME 상태가 안 깨진다).
 */

import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import {
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { goToNextCell, tableEditing } from "prosemirror-tables";
import { Step } from "prosemirror-transform";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";

import { loadMarkdown } from "../md/parse";
import { anchorShift } from "../zoom";
import { blocksToDoc, docToBlocks, schema } from "../md/pmdoc";
import { serializeWithSource } from "../md/serialize";
import type { LoadedMarkdown } from "../md/types";
import type {
  ChangeReason,
  DocHost,
  DocStatsFull,
  EditorCmd,
  EditorQuery,
  TabDoc,
  TopAnchor,
} from "./DocHost";
import { EditHistory } from "./history";
import {
  applyHeading,
  applyHighlight,
  bulletBackspace,
  bulletFromInput,
  deleteTable,
  indentBullet,
  insertSoftBreak,
  insertTable,
  insertText,
  inTable,
  queryBold,
  queryBullet,
  queryHeading,
  queryHighlight,
  queryStrike,
  selectAdjacentTable,
  splitBullet,
  textToSlice,
  toggleBold,
  toggleBullet,
  toggleStrike,
  wholeTableCells,
} from "./mdCommands";
import { plainIndex, plainToPos, posToPlain, type PlainIndex } from "./mdPlain";
import { docLineIndex, lineColAt, selectionChars } from "./mdStats";
import { runSearch, type SearchHit, type SearchQuery } from "./search";

/**
 * 찾기 일치 강조 — **데코레이션만**(설계 문서 §9-2). 문서에 들어가지 않으므로
 * 저장 바이트·수정 표시·실행취소에 영향이 0이고, 편집이 일어나면 `map`이 자리를
 * 따라 옮겨 준다.
 */
const hitKey = new PluginKey<DecorationSet>("findHits");

const hitPlugin = new Plugin<DecorationSet>({
  key: hitKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, old) {
      const next = tr.getMeta(hitKey) as DecorationSet | undefined;
      if (next) return next;
      return old.map(tr.mapping, tr.doc);
    },
  },
  props: {
    decorations: (state) => hitKey.getState(state) ?? DecorationSet.empty,
  },
});

/**
 * 글자 뒤 받침(text backing) — **맨 위 층의 글자 블록**(단락·제목)마다 그 안의 글자
 * 전체를 인라인 장식 하나(`.backing`)로 감싼다. 칠하는 것은 CSS뿐이고 받침이 꺼져
 * 있으면 색이 `transparent`라 아무것도 안 보인다.
 *
 * 왜 블록이 아니라 인라인인가: 블록에 `width: fit-content`로 칠하면 **접혀서 여러 줄이
 * 되는 단락**은 결국 폭을 꽉 채워 줄 끝의 빈 자리까지 큰 사각형이 된다(사용자 보고).
 * 인라인 + `box-decoration-break: clone`이면 접힌 줄마다 글자 길이만큼만 칠해진다.
 *
 * 표는 **건너뛴다**(`isTextblock`이 아니다) — 표는 `index.css`가 블록 하나로 칠한다.
 * 칸 속 단락까지 따로 칠하면 격자가 얼룩덜룩해진다. 빈 단락도 범위가 없어 건너뛴다.
 */
export function backingRanges(doc: PMNode): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.isTextblock) {
      if (node.content.size === 0) return;
      out.push({ from: offset + 1, to: offset + 1 + node.content.size });
      return;
    }
    // 글머리 기호 목록은 **항목 줄마다** 칠한다(받침 규칙이 목록 안에서도 줄 단위로
    // 걸려야 한다 — 시안 L1). 표는 여기 걸리지 않고 `index.css`가 블록 하나로 칠한다.
    if (node.type !== schema.nodes.bullet_list) return;
    node.descendants((child, pos) => {
      if (!child.isTextblock) return true;
      if (child.content.size > 0) {
        const at = offset + 1 + pos + 1;
        out.push({ from: at, to: at + child.content.size });
      }
      return false;
    });
  });
  return out;
}

const backingKey = new PluginKey<DecorationSet>("textBacking");

function backingSet(doc: PMNode): DecorationSet {
  return DecorationSet.create(
    doc,
    backingRanges(doc).map((r) => Decoration.inline(r.from, r.to, { class: "backing" }))
  );
}

const backingPlugin = new Plugin<DecorationSet>({
  key: backingKey,
  state: {
    init: (_cfg, state) => backingSet(state.doc),
    apply: (tr, old) => (tr.docChanged ? backingSet(tr.doc) : old),
  },
  props: {
    decorations: (state) => backingKey.getState(state) ?? DecorationSet.empty,
  },
});

export class MarkdownHost implements DocHost {
  readonly kind = "markdown" as const;

  private view: EditorView | null = null;
  private state: EditorState;
  private base: LoadedMarkdown | null = null;
  private hist = new EditHistory();
  private listeners = new Set<(why: ChangeReason) => void>();
  private pen: string | null = null;
  /** 앞 기록이 끝난 자리. 커서가 그 자리에서 이어질 때만 입력을 묶는다. */
  private lastHead: number | null = null;
  private scrollTop = 0;

  constructor(text = "") {
    this.base = loadMarkdown(text);
    this.state = this.buildState(text);
  }

  /** 마크다운 문자열 하나로 상태를 만든다(보존 기준 `base`는 건드리지 않는다). */
  private buildState(text: string): EditorState {
    const doc = blocksToDoc(loadMarkdown(text).blocks);
    return EditorState.create({
      doc,
      schema,
      selection: Selection.atStart(doc),
      plugins: [
        keymap({
          // **편집기에 초점이 있을 때의 실행 취소·다시 실행·굵게는 여기서 처리한다.**
          //
          // `prosemirror-view`의 `captureKeyDown`은 Ctrl+B/I/Y/Z를 "브라우저 기본
          // 동작을 막기 위해" 처리한 것으로 보고 **`event.preventDefault()`를 부른다**
          // (dist/index.js `captureKeyDown`: `mods == "c" && (66|73|89|90)`).
          // 그래서 `App`의 창 수준 keydown 처리기가 `e.defaultPrevented`로 걸러 버려
          // 마크다운 탭에서 Ctrl+Z·Ctrl+Y·Ctrl+B가 통째로 죽어 있었다.
          // 편집기가 스스로 묶어 두면 PM이 먼저 처리하므로 그 길이 되살아난다.
          //
          // **다시 실행은 `Ctrl+Y`만**이다(사용자 지시 — Windows 11 메모장과 같다).
          // `Ctrl+Shift+Z`는 묶지 않는다: `captureKeyDown`은 `mods == "cs"`를 잡지 않고
          // `baseKeymap`에도 그 키가 없으므로 **아무 일도 일어나지 않는다**.
          "Mod-z": () => this.undo(),
          "Mod-y": () => this.redo(),
          "Mod-b": () => this.exec({ t: "bold" }),
          // 취소선도 **여기서** 받는다. `captureKeyDown`은 Ctrl+Shift+X를 잡지 않지만,
          // 서식 키는 모두 편집기가 먼저 처리하는 한 길로 둔다(Ctrl+B와 같은 이유).
          "Mod-Shift-x": () => this.exec({ t: "strike" }),
          // 글머리 기호 — 승인된 시안 L1. `Ctrl+Shift+8`(메모장에는 없는 기능이라
          // 널리 쓰이는 키를 골랐다). 서식 키는 모두 편집기가 먼저 받는 한 길로 둔다.
          "Mod-Shift-8": () => this.exec({ t: "bullet" }),
          // 목록 항목에서 Enter → 다음 항목, 빈 항목에서 Enter → 목록 끝(본문).
          // 목록 밖이면 `false`를 돌려 `baseKeymap`의 Enter가 그대로 돈다.
          Enter: (state, dispatch) => this.listKey(state, dispatch, splitBullet),
          // 항목 안에서는 소프트 줄바꿈을 넣지 않는다(한 항목 = 한 줄).
          "Shift-Enter": (state, dispatch) => {
            const tr = splitBullet(state) ?? insertSoftBreak(state);
            if (!tr) return false;
            tr.setMeta("groupTag", null);
            dispatch?.(tr);
            return true;
          },
          Tab: (state, dispatch, view) =>
            this.listKey(state, dispatch, (s) => indentBullet(s, 1)) ||
            goToNextCell(1)(state, dispatch, view),
          "Shift-Tab": (state, dispatch, view) =>
            this.listKey(state, dispatch, (s) => indentBullet(s, -1)) ||
            goToNextCell(-1)(state, dispatch, view),
          // 표 지우기 (사용자 보고: "표 삭제가 안 돼"). `baseKeymap`보다 **먼저** 본다.
          // 항목 맨 앞의 Backspace는 목록 해제/내어쓰기가 먼저다.
          Backspace: (state, dispatch) =>
            this.listKey(state, dispatch, bulletBackspace) ||
            this.tableDeleteKey(state, dispatch, -1),
          Delete: (state, dispatch) => this.tableDeleteKey(state, dispatch, 1),
        }),
        keymap(baseKeymap),
        tableEditing(),
        // 입력 규칙 — 줄 맨 앞에 `- `/`* `/`+ `를 치면 그 줄이 항목이 된다.
        // `prosemirror-inputrules`를 새로 넣지 않고 같은 자리(`handleTextInput`)에서 한다.
        new Plugin({
          props: {
            handleTextInput: (_view, from, to, text) => {
              if (text !== " " || from !== to) return false;
              const tr = bulletFromInput(this.state, from);
              if (!tr) return false;
              tr.setMeta("groupTag", null);
              this.lastHead = null;
              this.apply(tr);
              return true;
            },
          },
        }),
        backingPlugin,
        hitPlugin,
      ],
    });
  }

  /**
   * Backspace·Delete가 표를 만났을 때. 처리했으면 `true`(= `baseKeymap`으로 넘기지 않는다).
   *
   *   1. 표가 통째로 골라져 있으면 지운다.
   *   2. 칸이 **표 전체**만큼 골라져 있으면 지운다 — `prosemirror-tables`의 기본은 칸
   *      **내용만** 비우는 것이라 표가 남았다(사용자 보고의 한 갈래).
   *   3. 표 바로 뒤 블록의 맨 앞(Backspace) · 바로 앞 블록의 맨 끝(Delete)이면 그 표를
   *      **고른다**. 한 번 더 누르면 1번으로 지워진다.
   *
   * 그 밖에는 `false`를 돌려 평소의 지우기가 그대로 동작하게 둔다.
   */
  /**
   * 목록 명령 하나를 키로 돌린다. 할 일이 없으면 `false`를 돌려 **다음 처리기**로
   * 넘긴다(표 키 · `baseKeymap`). 명령 하나 = 실행 취소 한 번이다.
   */
  private listKey(
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    run: (s: EditorState) => Transaction | null
  ): boolean {
    const tr = run(state);
    if (!tr) return false;
    tr.setMeta("groupTag", null);
    tr.scrollIntoView();
    dispatch?.(tr);
    return true;
  }

  private tableDeleteKey(
    state: EditorState,
    dispatch: ((tr: Transaction) => void) | undefined,
    dir: -1 | 1
  ): boolean {
    const sel = state.selection;
    const onNode = sel instanceof NodeSelection && sel.node.type === schema.nodes.table;
    if (onNode || wholeTableCells(state)) {
      const tr = deleteTable(state);
      if (!tr) return false;
      tr.setMeta("groupTag", null);
      dispatch?.(tr);
      return true;
    }
    const pick = selectAdjacentTable(state, dir);
    if (!pick) return false;
    dispatch?.(pick);
    return true;
  }

  // --- 화면 ---------------------------------------------------------------

  mount(el: HTMLElement): void {
    if (this.view) {
      el.appendChild(this.view.dom);
      el.scrollTop = this.scrollTop;
      return;
    }
    this.view = new EditorView(
      { mount: document.createElement("div") },
      {
        state: this.state,
        dispatchTransaction: (tr) => this.apply(tr),
        // 붙여넣기는 평문을 파일 규칙대로 받는다. HTML은 스키마가 걸러 주므로
        // bold/em/strike/mark만 남고 나머지는 평문으로 떨어진다(§7).
        clipboardTextParser: (text) => textToSlice(text),
        attributes: { class: "pm", spellcheck: "false" },
        handleDOMEvents: {
          // 브라우저의 기본 실행취소는 우리 스택을 모른다 — 문서가 어긋나므로 막는다.
          beforeinput: (_view, event) => {
            const type = (event as InputEvent).inputType;
            if (type === "historyUndo") {
              event.preventDefault();
              this.undo();
              return true;
            }
            if (type === "historyRedo") {
              event.preventDefault();
              this.redo();
              return true;
            }
            return false;
          },
          compositionend: () => {
            // 한글 조합이 끝나면 묶기를 끊는다(§6).
            this.hist.breakGroup();
            this.lastHead = null;
            return false;
          },
        },
      }
    );
    el.appendChild(this.view.dom);
    el.scrollTop = this.scrollTop;
  }

  unmount(): void {
    const dom = this.view?.dom;
    if (dom?.parentElement) {
      this.scrollTop = dom.parentElement.scrollTop;
      dom.remove();
    }
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
    this.listeners.clear();
  }

  focus(): void {
    this.view?.focus();
  }

  // --- 트랜잭션과 기록 ----------------------------------------------------

  private apply(tr: Transaction): void {
    const before = this.state;
    if (tr.docChanged && tr.getMeta("addToHistory") !== false) {
      const mergeable = this.lastHead !== null && before.selection.head === this.lastHead;
      this.hist.record({
        steps: tr.steps.map((s) => s.toJSON()),
        inverted: tr.steps.map((s, i) => s.invert(tr.docs[i]).toJSON()),
        selBefore: before.selection.toJSON(),
        selAfter: tr.selection.toJSON(),
        // 명령(굵게·제목·형광펜·표)은 `groupTag: null`을 달아 한 항목으로 남는다.
        groupTag: mergeable ? ((tr.getMeta("groupTag") as string | null) ?? "typing") : null,
      });
      this.lastHead = tr.selection.head;
    }
    this.state = before.apply(tr);
    this.view?.updateState(this.state);
    this.emit(tr.docChanged ? "doc" : "selection");
  }

  /** 기록하지 않고 적용한다(실행 취소·다시 실행 자신). */
  private applyRaw(tr: Transaction): void {
    tr.setMeta("addToHistory", false);
    this.state = this.state.apply(tr);
    this.view?.updateState(this.state);
    this.emit("doc");
  }

  private emit(why: ChangeReason): void {
    for (const cb of this.listeners) cb(why);
  }

  onChange(cb: (why: ChangeReason) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // --- 파일 경계 ----------------------------------------------------------

  /** 스크롤 위치를 기억한다(탭을 떠나도 되돌아올 자리를 잃지 않게). */
  noteScroll(top: number): void {
    this.scrollTop = top;
    this.emit("viewport");
  }

  /**
   * 확대/축소 직전의 "맨 위에 보이던 블록". 스크롤 상자는 **겉 컨테이너**(`.editor`)이고
   * 그 안의 `.pm`의 자식 하나가 단락·제목·표 한 덩어리다. 아무것도 바꾸지 않는다.
   */
  captureTopAnchor(): TopAnchor | null {
    const dom = this.view?.dom;
    const sc = dom?.parentElement;
    if (!dom || !sc) return null;
    if (sc.scrollTop <= 0) return { atTop: true, ref: null, delta: 0 };
    const top = sc.getBoundingClientRect().top;
    for (const child of Array.from(dom.children)) {
      const r = child.getBoundingClientRect();
      // 윗변에 걸쳐 있거나 그 아래 첫 번째 블록.
      if (r.bottom > top + 0.5) return { atTop: false, ref: child, delta: r.top - top };
    }
    return null;
  }

  /** 적어 둔 블록을 다시 같은 자리로. 문서도 선택도 건드리지 않는다. */
  restoreTopAnchor(anchor: TopAnchor | null, scale: number): void {
    const sc = this.view?.dom.parentElement;
    if (!sc || !anchor) return;
    if (anchor.atTop) {
      sc.scrollTop = 0;
    } else {
      const el = anchor.ref;
      if (!(el instanceof Element) || !el.isConnected) return;
      const now = el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
      sc.scrollTop += anchorShift(now, anchor.delta, scale);
    }
    this.scrollTop = sc.scrollTop;
    this.emit("viewport");
  }

  load(text: string): void {
    this.base = loadMarkdown(text);
    this.state = this.buildState(text);
    this.view?.updateState(this.state);
    this.hist.clear();
    this.lastHead = null;
    this.scrollTop = 0;
    this.emit("doc");
  }

  save(): string {
    return serializeWithSource(docToBlocks(this.state.doc), this.base);
  }

  plainText(): string {
    return plainIndex(this.state.doc).text;
  }

  markSaved(): void {
    // 방금 쓴 바이트가 새 보존 기준이 된다.
    this.base = loadMarkdown(this.save());
    this.hist.markSaved();
    this.emit("doc");
  }

  isDirty(): boolean {
    return this.hist.isDirty();
  }

  // --- 편집 ---------------------------------------------------------------

  exec(cmd: EditorCmd): boolean {
    let tr: Transaction | null = null;
    switch (cmd.t) {
      case "bold":
        tr = toggleBold(this.state);
        break;
      case "strike":
        tr = toggleStrike(this.state);
        break;
      case "heading":
        tr = applyHeading(this.state, cmd.level);
        break;
      case "bullet":
        tr = toggleBullet(this.state);
        break;
      case "highlight":
        tr = applyHighlight(this.state, cmd.color, cmd.toggle ?? true);
        break;
      case "table":
        tr = insertTable(this.state, cmd.rows, cmd.cols);
        break;
      case "deleteTable":
        tr = deleteTable(this.state);
        break;
      case "insertText":
        tr = insertText(this.state, cmd.text);
        break;
      case "delete":
        if (this.state.selection.empty) return false;
        tr = this.state.tr.deleteSelection();
        break;
      case "selectAll":
        this.select(0, this.state.doc.content.size);
        return true;
      default:
        return false;
    }
    if (!tr) return false;
    // 명령 하나 = 실행 취소 한 번. 묶기 대상이 아니다.
    this.lastHead = null;
    tr.setMeta("groupTag", null);
    tr.scrollIntoView();
    this.apply(tr);
    this.lastHead = null;
    return true;
  }

  select(from: number, to = from): void {
    const size = this.state.doc.content.size;
    const a = Math.max(0, Math.min(from, size));
    const b = Math.max(0, Math.min(to, size));
    // `between`은 글자가 들어갈 수 없는 자리(블록 경계)를 가까운 글자 자리로 옮겨 준다.
    const tr = this.state.tr.setSelection(
      TextSelection.between(this.state.doc.resolve(a), this.state.doc.resolve(b))
    );
    tr.setMeta("addToHistory", false);
    tr.scrollIntoView();
    this.state = this.state.apply(tr);
    this.view?.updateState(this.state);
    this.lastHead = null;
    this.emit("selection");
  }

  selectedText(): string {
    const { from, to } = this.state.selection;
    // 소프트 줄바꿈과 블록 경계는 둘 다 줄바꿈 한 글자로 나간다(파일에서 보이는 모양).
    return this.state.doc.textBetween(from, to, "\n", "\n");
  }

  query(): EditorQuery {
    const { selection, doc } = this.state;
    return {
      bold: queryBold(this.state),
      strike: queryStrike(this.state),
      heading: queryHeading(this.state),
      bullet: queryBullet(this.state),
      highlight: queryHighlight(this.state),
      inTable: inTable(this.state),
      hasSelection: !selection.empty,
      hasText: docLineIndex(doc).chars > 0,
      canUndo: this.hist.canUndo(),
      canRedo: this.hist.canRedo(),
      canFormat: true,
    };
  }

  /**
   * 펜 모드 — 켜 두면 새로 치는 글자에도 색이 남는다(`storedMarks`).
   * 선택이 생길 때마다 자동으로 칠하는 쪽은 `App`이 선택 변경에서 `exec`로 부른다.
   */
  setPen(color: string | null): void {
    this.pen = color;
    const marks = color === null ? [] : [schema.marks.highlight.create({ color })];
    const tr = this.state.tr.setStoredMarks(marks);
    tr.setMeta("addToHistory", false);
    this.state = this.state.apply(tr);
    this.view?.updateState(this.state);
  }

  penColor(): string | null {
    return this.pen;
  }

  undo(): boolean {
    const e = this.hist.takeUndo();
    if (!e) return false;
    const tr = this.state.tr;
    for (let i = e.inverted.length - 1; i >= 0; i -= 1) {
      tr.step(Step.fromJSON(schema, e.inverted[i]));
    }
    this.restoreSelection(tr, e.selBefore);
    this.lastHead = null;
    this.applyRaw(tr);
    return true;
  }

  redo(): boolean {
    const e = this.hist.takeRedo();
    if (!e) return false;
    const tr = this.state.tr;
    for (const s of e.steps) tr.step(Step.fromJSON(schema, s));
    this.restoreSelection(tr, e.selAfter);
    this.lastHead = null;
    this.applyRaw(tr);
    return true;
  }

  private restoreSelection(tr: Transaction, json: unknown): void {
    try {
      tr.setSelection(Selection.fromJSON(tr.doc, json as never));
    } catch {
      // 문서가 줄어들어 그 자리가 없어졌으면 가까운 자리로.
      tr.setSelection(Selection.atStart(tr.doc));
    }
    tr.scrollIntoView();
  }

  // --- 찾기/바꾸기 (§8) ---------------------------------------------------

  search(q: SearchQuery, repl = ""): SearchHit[] | null {
    return runSearch(plainIndex(this.state.doc).text, q, repl);
  }

  selectionRange(): { from: number; to: number } {
    const index = plainIndex(this.state.doc);
    const { from, to } = this.state.selection;
    return { from: posToPlain(index, from), to: posToPlain(index, to) };
  }

  selectHit(hit: SearchHit): void {
    const index = plainIndex(this.state.doc);
    this.select(plainToPos(index, hit.from), plainToPos(index, hit.to));
  }

  setHits(hits: readonly SearchHit[], current: number): void {
    const index = plainIndex(this.state.doc);
    const decos: Decoration[] = [];
    for (let i = 0; i < hits.length; i += 1) {
      const from = plainToPos(index, hits[i].from);
      const to = plainToPos(index, hits[i].to);
      if (to <= from) continue;
      decos.push(
        Decoration.inline(from, to, {
          class: i === current ? "find-hit find-hit-current" : "find-hit",
        })
      );
    }
    const tr = this.state.tr;
    tr.setMeta(hitKey, DecorationSet.create(this.state.doc, decos));
    tr.setMeta("addToHistory", false);
    this.state = this.state.apply(tr);
    this.view?.updateState(this.state);
  }

  /**
   * 한 일치를 바꿔 트랜잭션에 쌓는다. 바꾼 글자는 **일치가 시작하던 자리의 서식**을
   * 물려받는다(원본 `ReplaceRangeKeepFormat`).
   *
   * 블록·표 칸 경계를 걸친 일치는 **건너뛴다**: 바꾸면 블록이 합쳐져 문서 구조가
   * 달라지기 때문이다(찾기는 그대로 찾고 선택도 된다 — 바꾸기만 하지 않는다).
   */
  private replaceRange(
    tr: Transaction,
    index: PlainIndex,
    hit: SearchHit,
    text: string
  ): boolean {
    // 뒤에서 앞으로 바꾸므로 앞쪽 위치는 밀리지 않지만, 매핑을 거치면 순서에 의존하지 않는다.
    const from = tr.mapping.map(plainToPos(index, hit.from));
    const to = tr.mapping.map(plainToPos(index, hit.to));
    if (to <= from) return false;
    const $from = tr.doc.resolve(from);
    const $to = tr.doc.resolve(to);
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
    if (text === "") {
      tr.delete(from, to);
      return true;
    }
    const marks = tr.doc.nodeAt(from)?.marks ?? $from.marks();
    tr.replaceWith(from, to, schema.text(text, marks));
    return true;
  }

  replaceHit(hit: SearchHit, text: string): boolean {
    const index = plainIndex(this.state.doc);
    const tr = this.state.tr;
    if (!this.replaceRange(tr, index, hit, hit.expanded ?? text)) return false;
    tr.setMeta("groupTag", null);
    tr.scrollIntoView();
    this.lastHead = null;
    this.apply(tr);
    this.lastHead = null;
    return true;
  }

  /** 모두 바꾸기 = **한 트랜잭션**(뒤에서 앞으로) → `Ctrl+Z` 한 번(원본 요구사항). */
  replaceAll(q: SearchQuery, text: string): number {
    const index = plainIndex(this.state.doc);
    const hits = runSearch(index.text, q, text);
    if (!hits || hits.length === 0) return 0;
    const tr = this.state.tr;
    let n = 0;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      if (this.replaceRange(tr, index, hits[i], hits[i].expanded ?? text)) n += 1;
    }
    if (n === 0) return 0;
    tr.setMeta("groupTag", null);
    this.lastHead = null;
    this.apply(tr);
    this.lastHead = null;
    return n;
  }

  // --- 상태 글자 ----------------------------------------------------------

  stats(): DocStatsFull {
    const { doc, selection } = this.state;
    const index = docLineIndex(doc);
    const at = lineColAt(doc, selection.head);
    return {
      lines: index.lines,
      line: at.line,
      col: at.col,
      chars: index.chars,
      selChars: selectionChars(doc, selection.from, selection.to),
    };
  }

  // --- 탭/창 --------------------------------------------------------------

  serialize(): TabDoc {
    return {
      format: this.kind,
      fileSrc: this.base ? this.base.text : null,
      text: this.save(),
      selection: this.state.selection.toJSON(),
      scrollTop: this.scrollTop,
      history: this.hist.toJSON(),
    };
  }

  restore(doc: TabDoc): void {
    // 보존 기준은 읽은 원문, 문서는 지금 내용. 파서가 결정적이라 같은 텍스트를 다시
    // 파싱하면 노드 위치까지 같은 문서가 나오므로 저장해 둔 스텝이 그대로 유효하다(§10).
    this.base = loadMarkdown(doc.fileSrc ?? "");
    this.state = this.buildState(doc.text);
    this.hist = EditHistory.fromJSON(doc.history);
    this.lastHead = null;
    this.scrollTop = doc.scrollTop;
    const tr = this.state.tr;
    this.restoreSelection(tr, doc.selection);
    tr.setMeta("addToHistory", false);
    this.state = this.state.apply(tr);
    this.view?.updateState(this.state);
    this.emit("doc");
  }
}
