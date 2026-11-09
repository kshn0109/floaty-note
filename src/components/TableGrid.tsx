import { useLayoutEffect, useRef, useState } from "react";

import { t, tf } from "../lib/i18n";
import type { Anchor } from "./Popup";

/**
 * 표 크기 고르기 — 8×8 격자 팝업 (`Ctrl+Shift+L`, 도구 줄의 표 버튼).
 *
 * 수치는 원본 `TableGrid`(main.cpp 6582~6740행) 그대로: 칸 18 · 간격 3 · 안쪽 여백 10 ·
 * 격자와 글자 사이 8 · 글자 줄 18. 팝업 껍데기는 승인된 시안 `Popups.dc.html` 규칙
 * (r12 · 패딩 없음(격자가 자기 여백을 가짐) · bar 배경 · 1px hairline · 효과 없음)이고,
 * 아래 글자는 팝업 섹션 라벨과 같은 11px dim이다.
 *
 * 홈통은 **왼쪽 위 칸에 속한다**(원본과 같다) — 포인터를 쓸어도 크기가 앞 값으로
 * 깜빡이지 않는다.
 */

const ROWS = 8;
const COLS = 8;
const CELL = 18;
const GAP = 3;
const PAD = 10;
const LABEL_GAP = 8;
const LABEL_H = 18;
const SCREEN_MARGIN = 8;
/** 팝업과 누른 버튼 사이 간격 (Popup.tsx의 `GAP`과 같은 값). */
const ANCHOR_GAP = 6;

export const GRID_W = 2 * PAD + COLS * CELL + (COLS - 1) * GAP;
export const GRID_H = PAD + ROWS * CELL + (ROWS - 1) * GAP + LABEL_GAP + LABEL_H + PAD;

interface Props {
  anchor: Anchor;
  onPick: (rows: number, cols: number) => void;
  onClose: () => void;
}

export default function TableGrid({ anchor, onPick, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // 0 = 아직 아무것도 안 고름 → 글자 줄에 안내가 나온다(원본과 같다).
  const [rows, setRows] = useState(0);
  const [cols, setCols] = useState(0);

  useLayoutEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  const maxLeft = window.innerWidth - GRID_W - SCREEN_MARGIN;
  const maxTop = window.innerHeight - GRID_H - SCREEN_MARGIN;
  const left = Math.round(
    Math.min(
      Math.max(anchor.left + (anchor.right - anchor.left) / 2 - GRID_W / 2, SCREEN_MARGIN),
      Math.max(maxLeft, SCREEN_MARGIN)
    )
  );
  const top = Math.round(
    Math.min(Math.max(anchor.top - GRID_H - ANCHOR_GAP, SCREEN_MARGIN), Math.max(maxTop, SCREEN_MARGIN))
  );

  const move = (dr: number, dc: number): void => {
    setRows((r) => Math.min(Math.max(r + dr, 1), ROWS));
    setCols((c) => Math.min(Math.max(c + dc, 1), COLS));
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    switch (e.key) {
      case "ArrowDown":
        move(1, cols === 0 ? 1 : 0);
        break;
      case "ArrowUp":
        move(-1, cols === 0 ? 1 : 0);
        break;
      case "ArrowRight":
        move(rows === 0 ? 1 : 0, 1);
        break;
      case "ArrowLeft":
        move(rows === 0 ? 1 : 0, -1);
        break;
      case "Enter":
      case " ":
        if (rows > 0 && cols > 0) onPick(rows, cols);
        break;
      case "Escape":
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="popup-scrim"
      data-hit
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="popup table-grid"
        role="dialog"
        aria-label={t("tableSizePrompt")}
        tabIndex={-1}
        ref={cardRef}
        data-hit
        style={{ left, top, width: GRID_W, height: GRID_H }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerLeave={() => {
          setRows(0);
          setCols(0);
        }}
      >
        <div className="table-grid-cells" style={{ gap: GAP }}>
          {Array.from({ length: ROWS }, (_r, r) => (
            <div className="table-grid-row" key={r} style={{ gap: GAP }}>
              {Array.from({ length: COLS }, (_c, c) => (
                <button
                  className="table-grid-cell"
                  type="button"
                  key={c}
                  style={{ width: CELL, height: CELL }}
                  data-on={r < rows && c < cols ? "1" : "0"}
                  aria-label={tf("tableSizeFmt", r + 1, c + 1)}
                  onPointerEnter={() => {
                    setRows(r + 1);
                    setCols(c + 1);
                  }}
                  onClick={() => onPick(r + 1, c + 1)}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="table-grid-label" style={{ marginTop: LABEL_GAP, height: LABEL_H }}>
          {rows > 0 && cols > 0 ? tf("tableSizeFmt", rows, cols) : t("tableSizePrompt")}
        </div>
      </div>
    </div>
  );
}
