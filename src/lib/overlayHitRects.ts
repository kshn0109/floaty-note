import { invoke } from "@tauri-apps/api/core";

/**
 * 오버레이 모드에서 "클릭을 잡아야 하는 영역"을 모아 Rust로 보낸다.
 *
 * 좌표계: **창 클라이언트 영역 기준 물리 픽셀.** 여기서는 CSS 픽셀로 측정한 뒤
 * `window.devicePixelRatio`를 곱한다. WebView2는 클라이언트 영역을 꽉 채우므로
 * CSS (0,0) = 클라이언트 (0,0)이고, Rust 쪽 `inner_position()`도 클라이언트
 * 좌상단의 물리 좌표라 둘이 바로 맞물린다. 모니터마다 DPI가 달라도 그 창이 있는
 * 모니터의 배율이 그대로 `devicePixelRatio`에 반영되므로 추가 보정이 없다.
 *
 * 대상:
 *   1) 글자 줄 — 편집 영역의 텍스트 노드마다 `Range.getClientRects()`
 *   2) `data-hit` 가 붙은 요소 — 제목 줄(통째로, 불투명하므로 끌기도 여기서),
 *      툴바 칩, 상태 칩
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function push(out: Rect[], r: DOMRect, dpr: number, clip: DOMRect | null): void {
  let { left, top, right, bottom } = r;
  if (clip) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  // 창 밖으로 나간 부분은 버린다.
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  if (right - left <= 0 || bottom - top <= 0) return;
  out.push({
    x: Math.floor(left * dpr),
    y: Math.floor(top * dpr),
    w: Math.ceil((right - left) * dpr),
    h: Math.ceil((bottom - top) * dpr),
  });
}

/** 편집 영역의 글자 줄 사각형들. 공백만 있는 노드는 건너뛴다. */
function textRects(editor: HTMLElement, out: Rect[], dpr: number): void {
  const clip = editor.getBoundingClientRect();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || node.nodeValue.trim() === "") continue;
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i += 1) push(out, rects[i], dpr, clip);
  }
}

export function collectHitRects(editor: HTMLElement | null): Rect[] {
  const dpr = window.devicePixelRatio || 1;
  const out: Rect[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-hit]"))) {
    push(out, el.getBoundingClientRect(), dpr, null);
  }
  if (editor) textRects(editor, out, dpr);
  return out;
}

export async function sendHitRects(editor: HTMLElement | null): Promise<void> {
  await invoke("set_overlay_hit_rects", { rects: collectHitRects(editor) });
}

export async function setOverlay(enabled: boolean): Promise<void> {
  await invoke("set_overlay", { enabled });
}
