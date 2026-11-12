/**
 * 파일 계층 (설계 문서 §13 단계 5 · MIGRATION_HANDOFF §4).
 *
 * **편집기는 파일을 모른다.** 여기서 바이트를 읽어 LF 문자열로 만들고 `DocHost.load`에
 * 넘기고, 저장할 때는 `DocHost.save()`가 준 문자열을 그대로 쓴다. 인코딩·줄바꿈은
 * 탭 레이어의 값이고 편집기 밖이다(§10).
 *
 * 파일 시스템은 **Rust 커맨드로만** 닿는다(`src-tauri/src/textfile.rs`): 프론트에
 * `fs` 권한이 없으므로 사용자가 대화상자에서 고른 경로 하나밖에 열 수 없고, 관리자
 * 권한도 필요 없다.
 */

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { t } from "./i18n";

/** 디스크에 있던 인코딩 — Rust `textfile::Enc`와 1:1. */
export type Encoding = "utf8" | "utf8Bom" | "utf16le" | "ansi";
/** 디스크에 있던 줄바꿈 — Rust `textfile::Eol`과 1:1. */
export type Eol = "lf" | "crlf" | "cr" | "mixed";

export interface ReadResult {
  /** 늘 LF로 정규화된 내용. */
  text: string;
  enc: Encoding;
  eol: Eol;
  bytes: number;
}

/**
 * 인코딩·줄바꿈 이름은 **어느 언어에서나 같은 토큰**이라 문자열 표에 넣지 않는다
 * (원본 `DocEncName`/`DocEolName`의 주석 그대로). 이름이 아니라 단어인 둘만 표에서 온다.
 */
export function encName(enc: Encoding): string {
  switch (enc) {
    case "utf8Bom":
      return "UTF-8 (BOM)";
    case "utf16le":
      return "UTF-16 LE";
    case "ansi":
      return t("statusEncAnsi");
    default:
      return "UTF-8";
  }
}

export function eolName(eol: Eol): string {
  switch (eol) {
    case "crlf":
      return "CRLF";
    case "cr":
      return "CR";
    case "mixed":
      return t("statusEolMixed");
    default:
      return "LF";
  }
}

/** 경로의 마지막 조각(파일 이름). 원본 `PathLeaf`. */
export function leafOf(path: string): string {
  const at = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return at < 0 ? path : path.slice(at + 1);
}

export async function readTextFile(path: string): Promise<ReadResult> {
  return invoke<ReadResult>("read_text_file", { path });
}

/** 늘 UTF-8(BOM 없음) + LF. 임시 파일에 쓴 뒤 제자리로 옮긴다(Rust 쪽). */
export async function writeTextFile(path: string, text: string): Promise<void> {
  await invoke("write_text_file", { path, text });
}

/** 열기 대화상자의 필터 — 원본 `PickFile` 그대로. */
const FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "Text", extensions: ["txt"] },
  { name: "All files", extensions: ["*"] },
];

/**
 * 저장 대화상자의 필터 — 맨 앞이 기본 선택이다. 제안 이름이 `.txt`면 텍스트를, 아니면
 * 마크다운을 앞에 둔다(새 메모의 기본은 `.md` — 사용자 결정 2026-11-12).
 */
const MD_FILTER = { name: "Markdown", extensions: ["md", "markdown"] };
const TXT_FILTER = { name: "Text", extensions: ["txt"] };
const ALL_FILTER = { name: "All files", extensions: ["*"] };

function saveFiltersFor(ext: string) {
  return ext === "txt" ? [TXT_FILTER, MD_FILTER, ALL_FILTER] : [MD_FILTER, TXT_FILTER, ALL_FILTER];
}

/** 제안 이름의 확장자(소문자). 없으면 `md`. */
function extOf(name: string): string {
  const leaf = leafOf(name);
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "md";
}

/** 열기 대화상자. 취소하면 `null`. */
export async function pickOpenPath(): Promise<string | null> {
  const picked = await openDialog({ multiple: false, directory: false, filters: FILTERS });
  return typeof picked === "string" ? picked : null;
}

/**
 * 다른 이름으로 저장 대화상자. 취소하면 `null`.
 *
 * 확장자를 적지 않은 이름은 제안 이름의 확장자(새 메모면 `.md`)를 받는다. Windows의
 * 대화상자는 기본 확장자를 스스로 붙여 주지만 Tauri 플러그인은 보장하지 않으므로
 * 여기서 한 번 더 확인한다 — "제목 없음"으로 저장한 파일이 확장자 없이 남으면
 * 마크다운으로 열리기는 해도 탐색기에서 연결 프로그램을 잃는다.
 */
export async function pickSavePath(suggestedName: string): Promise<string | null> {
  const ext = extOf(suggestedName);
  const picked = await saveDialog({ defaultPath: suggestedName, filters: saveFiltersFor(ext) });
  if (typeof picked !== "string" || picked === "") return null;
  const leaf = leafOf(picked);
  return leaf.includes(".") ? picked : `${picked}.${ext}`;
}
