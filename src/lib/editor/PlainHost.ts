/**
 * 일반 텍스트 모드 편집기 — CodeMirror 6 (설계 문서 §3-2 · §5).
 *
 * 왜 다른 엔진인가: `.txt`·로그는 수 MB가 흔하고 ProseMirror는 문서 전체를 DOM으로 그린다.
 * CodeMirror는 **보이는 줄만** 그려서 5MB를 0.04초에 연다(§2-4). 서식은 아예 없고
 * 저장은 편집기 문자열 그대로이므로 바이트 왕복은 자동으로 완전하다.
 *
 * 서식 명령(굵게·제목·형광펜·표)은 **비활성**이다(사용자 결정 3): 넣을 수 없으니
 * 저장할 때 조용히 버릴 일도 없다.
 */

import { defaultKeymap } from "@codemirror/commands";
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

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
import { runSearch, type SearchHit, type SearchQuery } from "./search";

/** 이 트랜잭션은 실행취소에 기록하지 않는다(실행 취소 자신). */
const NO_HISTORY = Annotation.define<boolean>();

/**
 * 시안 A 수치 — 본문 15px, 줄 간격 1.75, 여백 위 18 / 좌우 32.
 *
 * 글자 크기는 `--zoom`(`lib/zoom.ts`)을 탄다 — 마크다운 쪽 `.editor`와 **같은 식**이라
 * 두 엔진의 배율이 하나다. 줄 간격은 무차원이라 같이 커진다.
 */
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "calc(var(--doc-size, 15px) * var(--zoom, 1))",
    color: "var(--text)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    // 글꼴은 `index.css`의 `--mono-font` 하나에서 온다(`displayMode.ts`가 받침 띠
    // 높이를 재려면 같은 글꼴을 알아야 한다).
    fontFamily: "var(--mono-font)",
    lineHeight: "1.75",
    overflow: "auto",
  },
  // 여백은 `index.css`의 `--edit-pad-*` 하나에서 온다(좁은 창에서 두 엔진이 같이 줄어든다).
  ".cm-content": {
    padding: "var(--edit-pad-top) var(--edit-pad-x) var(--edit-pad-bottom)",
    caretColor: "var(--text)",
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--hover)",
  },
  ".cm-gutters": { display: "none" },
});

/**
 * 찾기 일치 강조 — **데코레이션만**(설계 문서 §9-2). 문서에 들어가지 않으므로 저장
 * 바이트·수정 표시에 영향이 0이고, 편집이 일어나면 `map`이 자리를 따라 옮겨 준다.
 */
const setHitsEffect = StateEffect.define<{ hits: readonly SearchHit[]; current: number }>();

const HIT_MARK = Decoration.mark({ class: "find-hit" });
const HIT_MARK_CURRENT = Decoration.mark({ class: "find-hit find-hit-current" });

const hitField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setHitsEffect)) continue;
      const { hits, current } = e.value;
      const n = tr.state.doc.length;
      const ranges = [];
      for (let i = 0; i < hits.length; i += 1) {
        const from = Math.max(0, Math.min(hits[i].from, n));
        const to = Math.max(0, Math.min(hits[i].to, n));
        if (to <= from) continue;
        ranges.push((i === current ? HIT_MARK_CURRENT : HIT_MARK).range(from, to));
      }
      return Decoration.set(ranges, true);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * 글자 뒤 받침(text backing) — **보이는 줄마다** 그 줄의 글자 전체를 인라인 장식
 * 하나(`.backing`)로 감싼다. 칠하는 것은 CSS뿐이고, 받침이 꺼져 있으면 색이
 * `transparent`라 아무것도 안 보인다. 그래서 편집기는 모드를 알 필요가 없다.
 *
 * 왜 줄(블록)이 아니라 글자(인라인)인가: 블록에 칠하면 **접힌 줄**의 끝 빈 자리까지
 * 큰 사각형이 된다(사용자 보고: 저장된 `.txt`를 열었을 때). 인라인 +
 * `box-decoration-break: clone`이면 접힌 줄마다 글자 길이만큼만 칠해진다.
 *
 * 빈 줄은 범위가 없으므로 장식도 없다(큰 상자가 생기지 않는다).
 * 장식은 문서가 아니므로 저장 바이트·수정 표시·실행취소에 영향이 0이다(설계 문서 §9-2).
 */
const BACKING_MARK = Decoration.mark({ class: "backing" });

/** 보이는 범위의 줄마다 글자 전체를 덮는 장식들. 시험이 부를 수 있게 밖으로 낸다. */
export function backingRanges(
  doc: { lineAt(pos: number): { from: number; to: number } },
  visible: readonly { from: number; to: number }[]
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const span of visible) {
    for (let pos = span.from; pos <= span.to; ) {
      const line = doc.lineAt(pos);
      if (line.to > line.from) out.push({ from: line.from, to: line.to });
      pos = line.to + 1;
    }
  }
  return out;
}

const backingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }

    private build(view: EditorView): DecorationSet {
      const ranges = backingRanges(view.state.doc, view.visibleRanges).map((r) =>
        BACKING_MARK.range(r.from, r.to)
      );
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (v) => v.decorations }
);

export class PlainHost implements DocHost {
  readonly kind = "plain" as const;

  private view: EditorView | null = null;
  private state: EditorState;
  private hist = new EditHistory();
  private listeners = new Set<(why: ChangeReason) => void>();
  private lastHead: number | null = null;
  private scrollTop = 0;

  constructor(text = "") {
    this.state = this.buildState(text);
  }

  /**
   * 실행 취소·다시 실행은 **편집기에 초점이 있을 때 여기서** 처리한다.
   *
   * CodeMirror의 `defaultKeymap`에는 history가 없어서 Ctrl+Z가 창 수준 처리기까지
   * 올라가기는 한다. 그래도 마크다운 쪽(`MarkdownHost`)과 **같은 한 길**로 묶어 둔다:
   * 편집기가 먼저 처리하므로 두 모드의 동작이 같고, 나중에 CodeMirror가 그 키를
   * 가로채더라도(ProseMirror의 `captureKeyDown`이 그랬던 것처럼) 영향이 없다.
   *
   * **다시 실행은 `Ctrl+Y`만**이다(사용자 지시 — Windows 11 메모장과 같다).
   * `Ctrl+Shift+Z`는 묶지 않는다: `defaultKeymap`에는 history 키가 하나도 없고
   * (`historyKeymap`은 따로 들여오지 않는다) 우리 `history()`도 쓰지 않으므로
   * **아무 일도 일어나지 않는다**.
   */
  private buildState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        theme,
        keymap.of([
          { key: "Mod-z", run: () => this.undo(), preventDefault: true },
          { key: "Mod-y", run: () => this.redo(), preventDefault: true },
        ]),
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        backingPlugin,
        hitField,
      ],
    });
  }

  // --- 화면 ---------------------------------------------------------------

  mount(el: HTMLElement): void {
    if (!this.view) {
      this.view = new EditorView({
        state: this.state,
        dispatch: (tr: Transaction) => this.apply(tr),
      });
      this.view.scrollDOM.addEventListener("scroll", () => {
        this.scrollTop = this.view?.scrollDOM.scrollTop ?? 0;
        this.emit("viewport");
      });
    }
    el.appendChild(this.view.dom);
    this.view.scrollDOM.scrollTop = this.scrollTop;
  }

  unmount(): void {
    if (!this.view) return;
    this.scrollTop = this.view.scrollDOM.scrollTop;
    this.view.dom.remove();
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
    this.listeners.clear();
  }

  focus(): void {
    this.view?.focus();
  }

  noteScroll(): void {
    this.scrollTop = this.view?.scrollDOM.scrollTop ?? this.scrollTop;
  }

  /**
   * 확대/축소에서 읽던 자리 — **일반 텍스트 모드는 아무것도 하지 않는다.**
   *
   * CodeMirror에는 자기 스크롤 고정(scroll anchoring)이 이미 있다: 글자 크기가 바뀌어
   * 줄 높이가 달라지면 맨 위 줄을 기준으로 스크롤을 스스로 맞춘다. 실제로 재 보면
   * 배율을 1.0 → 1.3 → 1.0으로 오갈 때 읽던 자리가 제자리로 정확히 돌아온다.
   *
   * 여기서 우리가 한 번 더 스크롤하면 **두 번 보정되어** 오히려 수백 px씩 튀었다
   * (측정: 1.1배 한 걸음에 600 → 850). 게다가 CodeMirror는 보이지 않는 줄을 높이 지도의
   * **추정값**으로만 알고 있어서, 글자 크기가 막 바뀐 직후의 좌표는 DOM으로 재든
   * `lineBlockAt`으로 재든 아직 옛 값이다. 그래서 맡겨 둔다.
   *
   * 전에는 여기서 커서로 스크롤해서(`revealCaret`) 커서가 화면 밖이면 글이 통째로
   * 튀었다 — 사용자 보고의 원인이 그것이다.
   */
  captureTopAnchor(): TopAnchor | null {
    return null;
  }

  restoreTopAnchor(): void {
    // 위 주석 참조 — CodeMirror가 알아서 한다.
  }

  // --- 트랜잭션과 기록 ----------------------------------------------------

  private apply(tr: Transaction): void {
    if (tr.docChanged && tr.annotation(NO_HISTORY) !== true) {
      const before = tr.startState;
      const mergeable = this.lastHead !== null && before.selection.main.head === this.lastHead;
      this.hist.record({
        steps: [tr.changes.toJSON()],
        inverted: [tr.changes.invert(before.doc).toJSON()],
        selBefore: before.selection.toJSON(),
        selAfter: tr.state.selection.toJSON(),
        groupTag: mergeable ? "typing" : null,
      });
      this.lastHead = tr.state.selection.main.head;
    }
    this.state = tr.state;
    this.view?.update([tr]);
    this.emit(tr.docChanged ? "doc" : "selection");
  }

  private emit(why: ChangeReason): void {
    for (const cb of this.listeners) cb(why);
  }

  onChange(cb: (why: ChangeReason) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** `record: false`면 실행취소에 남기지 않는다. 기록 판단은 `apply` 한 곳에만 있다. */
  private commit(spec: TransactionSpec, record: boolean): void {
    this.apply(this.state.update(record ? spec : { ...spec, annotations: NO_HISTORY.of(true) }));
  }

  // --- 파일 경계 ----------------------------------------------------------

  load(text: string): void {
    this.state = this.buildState(text);
    this.view?.setState(this.state);
    this.hist.clear();
    this.lastHead = null;
    this.scrollTop = 0;
    this.emit("doc");
  }

  save(): string {
    return this.state.doc.toString();
  }

  /** 서식이 없는 모드라 보이는 글자가 곧 저장할 글자다. */
  plainText(): string {
    return this.save();
  }

  markSaved(): void {
    this.hist.markSaved();
    this.emit("doc");
  }

  isDirty(): boolean {
    return this.hist.isDirty();
  }

  // --- 편집 ---------------------------------------------------------------

  exec(cmd: EditorCmd): boolean {
    switch (cmd.t) {
      // 서식은 일반 텍스트에 없다 — 단축키도 아무 일을 하지 않는다(사용자 결정 3).
      case "bold":
      case "strike":
      case "heading":
      case "highlight":
      case "table":
        return false;
      case "insertText": {
        if (cmd.text === "") return false;
        const sel = this.state.selection.main;
        this.lastHead = null;
        this.commit(
          {
            changes: { from: sel.from, to: sel.to, insert: cmd.text },
            selection: { anchor: sel.from + cmd.text.length },
            scrollIntoView: true,
          },
          true
        );
        this.lastHead = null;
        return true;
      }
      case "delete": {
        const sel = this.state.selection.main;
        if (sel.empty) return false;
        this.lastHead = null;
        this.commit({ changes: { from: sel.from, to: sel.to, insert: "" } }, true);
        this.lastHead = null;
        return true;
      }
      case "selectAll":
        this.commit({ selection: { anchor: 0, head: this.state.doc.length } }, false);
        return true;
      default:
        return false;
    }
  }

  select(from: number, to = from): void {
    const n = this.state.doc.length;
    this.commit(
      {
        selection: {
          anchor: Math.max(0, Math.min(from, n)),
          head: Math.max(0, Math.min(to, n)),
        },
      },
      false
    );
    this.lastHead = null;
  }

  selectedText(): string {
    const sel = this.state.selection.main;
    return this.state.sliceDoc(sel.from, sel.to);
  }

  query(): EditorQuery {
    const sel = this.state.selection.main;
    return {
      bold: false,
      strike: false,
      heading: 0,
      highlight: null,
      inTable: false,
      hasSelection: !sel.empty,
      hasText: this.state.doc.length > 0,
      canUndo: this.hist.canUndo(),
      canRedo: this.hist.canRedo(),
      canFormat: false,
    };
  }

  setPen(): void {
    // 형광펜이 없는 모드다.
  }

  undo(): boolean {
    const e = this.hist.takeUndo();
    if (!e) return false;
    this.applyEntry(e.inverted, e.selBefore, true);
    return true;
  }

  redo(): boolean {
    const e = this.hist.takeRedo();
    if (!e) return false;
    this.applyEntry(e.steps, e.selAfter, false);
    return true;
  }

  private applyEntry(sets: unknown[], sel: unknown, reverse: boolean): void {
    const order = reverse ? [...sets].reverse() : sets;
    for (const raw of order) {
      this.commit({ changes: ChangeSet.fromJSON(raw as never) }, false);
    }
    try {
      this.commit(
        { selection: EditorSelection.fromJSON(sel as never), scrollIntoView: true },
        false
      );
    } catch {
      // 문서가 줄어들어 그 자리가 없어졌으면 선택은 그대로 둔다.
    }
    this.lastHead = null;
  }

  // --- 찾기/바꾸기 (§8) ---------------------------------------------------
  // 문서가 문자열 하나라 평문 글자 번호가 곧 문서 위치다 — 환산이 없다.

  search(q: SearchQuery, repl = ""): SearchHit[] | null {
    return runSearch(this.state.doc.toString(), q, repl);
  }

  selectionRange(): { from: number; to: number } {
    const sel = this.state.selection.main;
    return { from: sel.from, to: sel.to };
  }

  selectHit(hit: SearchHit): void {
    this.commit(
      { selection: { anchor: hit.from, head: hit.to }, scrollIntoView: true },
      false
    );
    this.lastHead = null;
  }

  setHits(hits: readonly SearchHit[], current: number): void {
    this.commit({ effects: setHitsEffect.of({ hits, current }) }, false);
  }

  replaceHit(hit: SearchHit, text: string): boolean {
    const n = this.state.doc.length;
    if (hit.to <= hit.from || hit.to > n) return false;
    this.lastHead = null;
    this.commit(
      {
        changes: { from: hit.from, to: hit.to, insert: hit.expanded ?? text },
        selection: { anchor: hit.from + (hit.expanded ?? text).length },
        scrollIntoView: true,
      },
      true
    );
    this.lastHead = null;
    return true;
  }

  /** 모두 바꾸기 = **한 트랜잭션**이라 `Ctrl+Z` 한 번에 되돌아간다. */
  replaceAll(q: SearchQuery, text: string): number {
    const hits = runSearch(this.state.doc.toString(), q, text);
    if (!hits || hits.length === 0) return 0;
    // CodeMirror의 변경 목록은 원본 문서 좌표로 적으므로 앞에서부터 모아도 밀리지 않는다.
    const changes = hits.map((h) => ({
      from: h.from,
      to: h.to,
      insert: h.expanded ?? text,
    }));
    this.lastHead = null;
    this.commit({ changes, scrollIntoView: true }, true);
    this.lastHead = null;
    return hits.length;
  }

  // --- 상태 글자 ----------------------------------------------------------

  stats(): DocStatsFull {
    const sel = this.state.selection.main;
    const line = this.state.doc.lineAt(sel.head);
    let selChars = 0;
    for (const r of this.state.selection.ranges) selChars += r.to - r.from;
    return {
      lines: this.state.doc.lines,
      line: line.number,
      col: sel.head - line.from + 1,
      chars: this.state.doc.length,
      selChars,
    };
  }

  // --- 탭/창 --------------------------------------------------------------

  serialize(): TabDoc {
    return {
      format: this.kind,
      fileSrc: null,
      text: this.save(),
      selection: this.state.selection.toJSON(),
      scrollTop: this.scrollTop,
      history: this.hist.toJSON(),
    };
  }

  restore(doc: TabDoc): void {
    this.state = this.buildState(doc.text);
    this.hist = EditHistory.fromJSON(doc.history);
    this.lastHead = null;
    this.scrollTop = doc.scrollTop;
    try {
      this.state = this.state.update({
        selection: EditorSelection.fromJSON(doc.selection as never),
      }).state;
    } catch {
      // 선택을 복원할 수 없으면 문서 맨 앞.
    }
    this.view?.setState(this.state);
    this.emit("doc");
  }
}
