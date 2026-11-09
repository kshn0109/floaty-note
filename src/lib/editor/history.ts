/**
 * 직렬화할 수 있는 실행 취소 스택 (설계 문서 §6).
 *
 * `prosemirror-history`와 `@codemirror/commands`의 history는 내부 상태(Item·StepMap)를
 * **직렬화할 수 없다.** 탭을 다른 창으로 옮길 때 실행취소 기록을 함께 옮겨야 하므로
 * 직접 만든다. 협업(원격 스텝)이 없으니 리베이스가 필요 없고 **선형 스택이면 충분하다**
 * (spike `docs/editor-spike/undo.mjs`로 확인).
 *
 * 이 모듈은 스텝의 **내용을 모른다**: 마크다운 호스트는 `Step.toJSON()`을, 일반 텍스트
 * 호스트는 `ChangeSet.toJSON()`을 넣는다. 그래서 두 엔진이 같은 스택을 쓴다.
 */

/** 묶기 창(ProseMirror 기본 `newGroupDelay`와 같은 수치). */
export const COALESCE_MS = 500;

export interface UndoEntry {
  /** 저장 시점 비교용 식별자. 같은 깊이의 다른 편집을 구별한다. */
  id: number;
  /** 다시 실행할 때 앞에서부터 적용한다. */
  steps: unknown[];
  /** 실행 취소할 때 **뒤에서부터** 적용한다(steps와 1:1 평행). */
  inverted: unknown[];
  selBefore: unknown;
  selAfter: unknown;
  /** 'typing' 같은 묶기 태그. `null`이면 절대 묶지 않는다. */
  groupTag: string | null;
  at: number;
}

export interface HistoryJSON {
  done: UndoEntry[];
  undone: UndoEntry[];
  /** 저장한 순간의 맨 위 항목 id. 빈 스택에서 저장했으면 `null`. */
  savedId: number | null;
  seq: number;
}

export interface RecordInput {
  steps: unknown[];
  inverted: unknown[];
  selBefore: unknown;
  selAfter: unknown;
  /** 'typing' 등. 명령(굵게·제목·표·모두 바꾸기)은 `null`을 줘서 한 항목으로 남긴다. */
  groupTag?: string | null;
  /** 지금 시각(시험에서 고정하기 위해 주입할 수 있게). */
  now?: number;
}

export class EditHistory {
  private done: UndoEntry[] = [];
  private undone: UndoEntry[] = [];
  private savedId: number | null = null;
  private seq = 0;
  /** 다음 기록은 앞 항목에 묶지 않는다(IME 조합이 끝났을 때 등). */
  private breakNext = false;

  /** 한 트랜잭션을 기록한다. 조건이 맞으면 **앞 항목에 합쳐** Ctrl+Z 한 번이 되게 한다. */
  record(input: RecordInput): void {
    const now = input.now ?? Date.now();
    const tag = input.groupTag ?? null;
    const last = this.done[this.done.length - 1];
    const mergeable =
      !this.breakNext &&
      tag !== null &&
      last !== undefined &&
      last.groupTag === tag &&
      now - last.at < COALESCE_MS &&
      // 저장한 지점을 넘어 합치면 '수정됨' 판단이 흐려진다.
      last.id !== this.savedId;
    this.breakNext = false;
    if (mergeable && last) {
      for (const s of input.steps) last.steps.push(s);
      for (const s of input.inverted) last.inverted.push(s);
      last.selAfter = input.selAfter;
      last.at = now;
      this.undone.length = 0;
      return;
    }
    this.seq += 1;
    this.done.push({
      id: this.seq,
      steps: input.steps,
      inverted: input.inverted,
      selBefore: input.selBefore,
      selAfter: input.selAfter,
      groupTag: tag,
      at: now,
    });
    this.undone.length = 0;
  }

  /** 다음 기록이 앞 항목에 묶이지 않게 한다. */
  breakGroup(): void {
    this.breakNext = true;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** 맨 위 항목을 꺼내 `undone`으로 옮긴다. 호출한 쪽이 `inverted`를 적용해야 한다. */
  takeUndo(): UndoEntry | null {
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    this.breakNext = true;
    return e;
  }

  /** 되돌린 항목 하나를 되살린다. 호출한 쪽이 `steps`를 적용해야 한다. */
  takeRedo(): UndoEntry | null {
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    this.breakNext = true;
    return e;
  }

  /**
   * 수정 표시(`*`). 저장한 순간의 맨 위 항목과 지금 맨 위 항목을 **id로** 비교한다.
   * 깊이만 비교하면 "끝까지 되돌린 뒤 다른 편집"이 같은 깊이라 깨끗해 보인다.
   *
   * 테마·메모지 색·탭 전환·찾기는 트랜잭션을 만들지 않으므로 여기에 닿지 않는다
   * (원본의 반복 버그 — MIGRATION_HANDOFF §7).
   */
  isDirty(): boolean {
    const top = this.done.length ? this.done[this.done.length - 1].id : null;
    return top !== this.savedId;
  }

  /** 지금을 "저장된 상태"로 삼는다. */
  markSaved(): void {
    this.savedId = this.done.length ? this.done[this.done.length - 1].id : null;
  }

  /** 파일을 열면 스택을 비운다(원본 규칙). */
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.savedId = null;
    this.breakNext = false;
  }

  toJSON(): HistoryJSON {
    return { done: this.done, undone: this.undone, savedId: this.savedId, seq: this.seq };
  }

  static fromJSON(j: HistoryJSON): EditHistory {
    const h = new EditHistory();
    h.done = j.done ?? [];
    h.undone = j.undone ?? [];
    h.savedId = j.savedId ?? null;
    h.seq = j.seq ?? h.done.length + h.undone.length;
    return h;
  }
}
