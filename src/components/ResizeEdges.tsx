import type { CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Direction =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthWest"
  | "NorthEast"
  | "SouthWest"
  | "SouthEast";

const EDGE = 6;
const CORNER = 12;

/**
 * 창 가장자리 리사이즈 — `decorations: false`라 시스템이 해 주지 않으므로
 * 직접 구현한다. 가장자리 6px · 모서리 12px (MIGRATION_HANDOFF §4 창 크롬).
 * 최대화 상태와 오버레이 모드에서는 CSS가 숨긴다.
 */
const EDGES: { dir: Direction; style: CSSProperties }[] = [
  { dir: "North", style: { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" } },
  { dir: "South", style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" } },
  { dir: "West", style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" } },
  { dir: "East", style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE, cursor: "ew-resize" } },
  { dir: "NorthWest", style: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
  { dir: "NorthEast", style: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
  { dir: "SouthWest", style: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: "nesw-resize" } },
  { dir: "SouthEast", style: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" } },
];

export default function ResizeEdges() {
  const win = getCurrentWindow();
  return (
    <>
      {EDGES.map(({ dir, style }) => (
        <div
          key={dir}
          className="resize-edge"
          style={style}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
