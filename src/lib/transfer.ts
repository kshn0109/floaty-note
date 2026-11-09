/**
 * 탭 하나를 **다른 창으로 옮기는 꾸러미** (§5의 "문서 상태 이전").
 *
 * 떼어내기와 합치기는 창을 넘나드는 일이라 살아 있는 객체(편집기 뷰·DOM)를 그대로 넘길
 * 수 없다. 원본 Win32는 `SetParent`로 RichEdit HWND를 넘겨 실행 취소 스택까지 살렸지만,
 * 창마다 WebView2가 따로인 Tauri에는 그 길이 없다. 대신 우리 편집기는 **상태를 전부
 * 직렬화할 수 있다**(`DocHost.serialize()` — 원문 보존 `fileSrc` · 저장될 글 · 선택 ·
 * 스크롤 · 직렬화되는 실행 취소 스택). 그래서 옮긴 뒤 `Ctrl+Z`가 이어서 동작하고
 * 미저장 표시도 그대로다.
 *
 * 이 파일은 React도 Tauri도 모른다 — 꾸러미를 만들고(`freezeTab`) 받은 것을 믿을 수
 * 있는지 보는(`thawTab`) 순수 함수뿐이라 왕복을 단위 시험으로 지킨다.
 *
 * `thawTab`이 방어적인 이유: 꾸러미는 IPC를 건너온 **모르는 값**이다. 세션 파일을
 * `parseSession`으로 걸러 읽는 것과 같은 이유로, 칸이 없거나 모양이 다르면 기본값을
 * 주거나 꾸러미를 버린다(탭 하나를 잃는 것이 창이 깨지는 것보다 낫다).
 */

import type { DocFormat, TabDoc } from "./editor/DocHost";
import type { HistoryJSON } from "./editor/history";
import type { Encoding, Eol } from "./file";
import { TINTS, type Tint } from "./theme";

/** 옮겨지는 탭의 **보이는 값**. `Tab`에서 이 실행에만 뜻이 있는 `id`만 뺀 것이다. */
export interface TransferTab {
  uid: string;
  name: string | null;
  path: string | null;
  tint: Tint;
  dirty: boolean;
  format: DocFormat;
  enc: Encoding;
  eol: Eol;
  bigMd: boolean;
  hidden: boolean;
  reminder: string | null;
}

export interface TabTransfer {
  tab: TransferTab;
  doc: TabDoc;
  /** 받는 창의 탭 줄에서 들어갈 자리. */
  at: number;
}

export function freezeTab(tab: TransferTab, doc: TabDoc, at: number): TabTransfer {
  return {
    tab: {
      uid: tab.uid,
      name: tab.name,
      path: tab.path,
      tint: tab.tint,
      dirty: tab.dirty,
      format: tab.format,
      enc: tab.enc,
      eol: tab.eol,
      bigMd: tab.bigMd,
      hidden: tab.hidden,
      reminder: tab.reminder,
    },
    doc,
    at: Math.max(0, Math.round(at)),
  };
}

// --- 받은 꾸러미를 믿을 수 있는 값으로 -------------------------------------

function str(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function history(value: unknown): HistoryJSON {
  const empty: HistoryJSON = { done: [], undone: [], savedId: null, seq: 0 };
  if (!value || typeof value !== "object") return empty;
  const h = value as Record<string, unknown>;
  if (!Array.isArray(h.done) || !Array.isArray(h.undone)) return empty;
  return {
    done: h.done,
    undone: h.undone,
    savedId: typeof h.savedId === "number" ? h.savedId : null,
    seq: num(h.seq, 0),
  } as HistoryJSON;
}

/** 꾸러미를 읽는다. `uid`가 없으면 `null` — 버퍼 이름을 만들 수 없는 탭이다. */
export function thawTab(value: unknown): TabTransfer | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (!p.tab || typeof p.tab !== "object") return null;
  const t = p.tab as Record<string, unknown>;
  const uid = str(t.uid, null);
  if (uid === null || uid === "") return null;

  const format: DocFormat = t.format === "plain" ? "plain" : "markdown";
  const raw = (p.doc ?? {}) as Record<string, unknown>;
  const doc: TabDoc = {
    // 문서의 모드는 **탭의 모드**다 — 둘이 어긋나면 받는 창이 엉뚱한 엔진을 만든다.
    format,
    fileSrc: str(raw.fileSrc, null),
    text: str(raw.text, "") ?? "",
    selection: raw.selection ?? null,
    scrollTop: num(raw.scrollTop, 0),
    history: history(raw.history),
  };

  return {
    tab: {
      uid,
      name: str(t.name, null),
      path: str(t.path, null),
      tint: TINTS.includes(t.tint as Tint) ? (t.tint as Tint) : "none",
      dirty: bool(t.dirty),
      format,
      enc: (["utf8", "utf8Bom", "utf16le", "ansi"] as const).includes(t.enc as Encoding)
        ? (t.enc as Encoding)
        : "utf8",
      eol: (["lf", "crlf", "cr", "mixed"] as const).includes(t.eol as Eol)
        ? (t.eol as Eol)
        : "lf",
      bigMd: bool(t.bigMd),
      hidden: bool(t.hidden),
      reminder: str(t.reminder, null),
    },
    doc,
    at: Math.max(0, Math.round(num(p.at, 0))),
  };
}
