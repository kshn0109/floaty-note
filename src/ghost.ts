/**
 * 떠다니는 고스트 탭의 페이지 (§5의 탭 떼어내기).
 *
 * **왜 `index.html`이 아닌 자기 페이지인가.** 고스트는 끌기 한 번에 쓰이는 작은 칩이고
 * 창 밖에서도 커서를 따라다녀야 해서 자기 창이다(`src-tauri/src/drag.rs`). 그 창에
 * `App`을 띄우면 React·ProseMirror·CodeMirror가 통째로 한 번 더 올라간다 — 칩 하나를
 * 그리려고 편집기 두 엔진을 켜는 셈이다. 그래서 이 페이지는 **Tauri 이벤트 하나만** 쓴다.
 *
 * 색은 여기서 고르지 않는다: **끌고 있는 창이 계산한 팔레트 색**을 그대로 받는다
 * (`winmgr.ts`의 `GhostPaint`). 팔레트가 두 곳에 생기면 테마가 어긋난다.
 *
 * 그림 값을 **두 길로** 받는 이유: 이벤트가 리스너보다 먼저 가면 사라지므로, 리스너를
 * 붙인 뒤 `ghost_paint`로 한 번 더 물어본다(Rust가 마지막 값을 들고 있다).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { blockReloadKeys } from "./lib/timestamp";

const GHOST_PAINT_EVENT = "inkwell://ghost-paint";

interface GhostPaint {
  name: string;
  dirty: boolean;
  dot: string | null;
  bar: string;
  hair: string;
  text: string;
  accent: string;
  dim: string;
}

const pill = document.getElementById("pill");
const name = document.getElementById("name");
const dot = document.getElementById("dot");
const dirty = document.getElementById("dirty");

function paint(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const p = value as Partial<GhostPaint>;
  if (!pill || !name || !dot || !dirty) return;
  pill.style.background = p.bar ?? "#17181C";
  pill.style.borderColor = p.hair ?? "#2C2E35";
  pill.style.color = p.text ?? "#C9CCD3";
  name.textContent = p.name ?? "";
  if (p.dot) {
    dot.style.background = p.dot;
    dot.style.border = "0";
  } else {
    // 색 없음 = 빈 동그라미(알약 탭과 같은 모양).
    dot.style.background = "transparent";
    dot.style.border = `1px solid ${p.dim ?? "#7C818C"}`;
  }
  dirty.style.display = p.dirty ? "block" : "none";
  dirty.style.background = p.accent ?? "#6EE7B7";
}

void listen<unknown>(GHOST_PAINT_EVENT, (event) => paint(event.payload)).then(() =>
  invoke<unknown>("ghost_paint")
    .then(paint)
    .catch(() => undefined)
);

// F5·Ctrl+R로 이 창이 새로 고쳐지면 끌고 있던 고스트가 사라진다.
blockReloadKeys();
