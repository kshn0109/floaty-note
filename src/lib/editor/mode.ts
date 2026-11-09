/**
 * 어떤 모드로 열 것인가 (설계 문서 §5 · §11).
 *
 * 원본 규칙: **확장자로 결정**한다. `.md` / `.markdown` / 확장자 없음 → 마크다운,
 * 그 밖의 모든 확장자(`.txt` 포함) → 일반 텍스트.
 */

import type { DocFormat } from "./DocHost";

const MARKDOWN_EXT = ["md", "markdown"];

/**
 * 큰 `.md`의 임계값(바이트) — 넘으면 일반 텍스트 모드로 연다(사용자 결정: 1MB).
 * 그 경우에도 저장 바이트는 완전히 보존되므로 파일이 망가질 위험이 없다.
 */
export const MARKDOWN_MAX_BYTES = 1024 * 1024;

/** 파일 이름(또는 `null` = 제목 없음) → 모드. */
export function formatOfName(name: string | null): DocFormat {
  if (name === null) return "markdown";
  const base = name.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "markdown"; // 확장자 없음(앞머리 점만 있는 이름도 포함)
  const ext = base.slice(dot + 1).toLowerCase();
  return MARKDOWN_EXT.includes(ext) ? "markdown" : "plain";
}

/**
 * 이름과 크기로 최종 모드를 정한다. 마크다운인데 임계값을 넘으면 일반 텍스트로 열고
 * 상태 글자에 그대로 "텍스트"로 나온다(안내 문구는 파일 단계에서).
 */
export function formatOfFile(name: string | null, byteLength: number): DocFormat {
  const f = formatOfName(name);
  if (f === "markdown" && byteLength > MARKDOWN_MAX_BYTES) return "plain";
  return f;
}
