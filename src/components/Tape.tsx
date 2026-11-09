import { useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { t } from "../lib/i18n";

/**
 * 테이프 — 승인된 시안 `Pin.dc.html`. 수치는 시안 그대로다:
 * **56×18 · `rotate(-2deg)` · 위 줄 가로 가운데 · 위 가장자리에 붙음(top 0)**.
 *   꺼짐 = 점선(dim) 윤곽, **위쪽 테두리 없음**, 아래 모서리 r3, 배경 없음
 *   켜짐 = accent 45% 채움, r2, 테두리 없음
 *
 * `position: fixed`인 이유: 같은 요소가 두 상태에서 **같은 자리**(창 위 가장자리 y=0)에
 * 있어야 한다. 평소에는 위 줄(36) 가운데에 걸쳐 보이고, 고정 중에는 종이가 8px 내려가
 * 테이프가 종이 위 가장자리에 걸친 모양이 된다(시안 ①·②). `.win`의 `overflow: hidden`은
 * 고정 위치 자손을 자르지 않는다(변형·필터가 없으므로 `.win`이 고정 요소의 기준 상자가
 * 되지 않는다).
 *
 * **클릭 = 끄기(해제), 끌기 = 창 이동.** 둘을 누른 자리에서의 이동 거리로 가른다
 * (`DRAG_THRESHOLD`). 끌기로 판정되면 Tauri의 `startDragging()`에 넘기므로 그 뒤로는
 * 포인터 이벤트가 오지 않고 click도 생기지 않는다 — 그래서 "끌었는데 꺼지는" 일이 없다.
 *
 * 우클릭은 **시스템 메뉴**를 연다: 고정 중에는 제목 줄이 없어 거기서 열던 메뉴가
 * 닿을 곳이 없기 때문이다(Alt+Space와 같은 메뉴).
 */

/** 누른 자리에서 이 거리를 넘어가면 클릭이 아니라 창 이동이다(탭 끌기와 같은 값). */
const DRAG_THRESHOLD = 6;

interface Props {
  /** 테이프가 켜진 모양인가 = 고정 중(오버레이면 강제로 켜진 모양). */
  on: boolean;
  /** 클릭 — 고정 해제(오버레이에서는 오버레이 끄기). `App`이 정한다. */
  onToggle: () => void;
  /** 우클릭 — 시스템 메뉴를 그 자리에 연다. */
  onSystemMenu: (x: number, y: number) => void;
}

export default function Tape({ on, onToggle, onSystemMenu }: Props) {
  const start = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  return (
    <button
      className="tape"
      type="button"
      data-on={on ? "1" : "0"}
      // 오버레이에서 클릭을 잡아야 하는 사각형에 들어간다(`overlayHitRects.ts`).
      data-hit
      aria-pressed={on}
      aria-label={on ? t("tapeUnpin") : t("tapePin")}
      title={on ? t("tapeUnpin") : t("tapePin")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, dragging: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.dragging) return;
        if (Math.abs(e.clientX - s.x) < DRAG_THRESHOLD && Math.abs(e.clientY - s.y) < DRAG_THRESHOLD) {
          return;
        }
        s.dragging = true;
        // 여기서부터는 OS가 창 이동을 몰고 간다 — 뒤따르는 click이 생기지 않는다.
        void getCurrentWindow().startDragging();
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (s && !s.dragging) onToggle();
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onSystemMenu(e.clientX, e.clientY);
      }}
    />
  );
}
