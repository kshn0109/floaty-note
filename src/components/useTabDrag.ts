import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { dropIndex } from "../lib/tabs";
import { tearStarted } from "../lib/tearoff";

/**
 * 탭 끌기 — 알약 탭(가로)과 메모 목록(세로)이 **같은 코드**를 쓴다. 탭 데이터가 하나이므로
 * (§5) 끌기의 규칙도 하나여야 한다.
 *
 * 끌기에는 **두 단계**가 있다.
 *
 * 1. **줄 안에서 순서 바꾸기** — 원본 그대로(NEXT_SESSION ⑮ A): 누른 자리에서 6px을
 *    넘어가면 끌기가 되고, 포인터가 이웃 탭 위를 지나는 순간 자리를 바꾼다. 그래서
 *    **드롭 표시를 그리지 않는다** — 결과가 이미 화면에 있다(시안에도 없다).
 * 2. **떼어내기** — 포인터가 탭 줄을 벗어나면(`tearStarted`) 거기서부터는 `onTear`가
 *    불리고 이 훅은 손을 뗀다. 그 뒤는 `App`이 몰고 간다: 고스트 탭 창이 커서를 따라
 *    다니고(Rust가 전역 커서를 읽는다), 놓은 자리가 다른 창의 탭 줄이면 합치고
 *    아니면 새 창이 된다. 이 훅이 끌고 가면 포인터가 창을 벗어나는 순간 길이 끊긴다.
 *
 * `setPointerCapture`를 쓰므로 포인터가 탭 줄 밖으로 나가도 끌기가 끊기지 않고,
 * 순서가 바뀌어 DOM이 움직여도 같은 요소가 계속 이벤트를 받는다. 떼어내는 중에는
 * 탭이 DOM에서 사라질 수 있으므로 **놓기 판정은 `App`의 창 수준 리스너**가 한다.
 *
 * 끌고 있는 탭은 **활성 상태를 유지한다**: 누르는 순간 클릭이 그 탭을 고르고,
 * 끌기가 끝나도 그대로다(원본 ⑮ 실측: "첫 탭을 오른쪽으로 끌면 세 번째 자리로 가고
 * 활성 상태를 유지합니다").
 */

const THRESHOLD = 6;

/** 떼어내기가 시작될 때 `App`에 넘기는 값. 길이는 전부 **물리 픽셀**이다. */
export interface TearInfo {
  id: number;
  /** 끌고 있는 알약의 크기 — 고스트 창의 크기가 된다. */
  w: number;
  h: number;
  /** 누른 자리의 알약 안 상대 좌표. 고스트가 커서 아래 그 자리에 떠 있게 한다. */
  grabX: number;
  grabY: number;
  /** 알약 왼쪽 위의 **창 클라이언트 안** 좌표. 떼어낸 새 창의 자리를 여기서 구한다. */
  tabX: number;
  tabY: number;
}

export interface TabDragOptions {
  container: RefObject<HTMLElement | null>;
  axis: "x" | "y";
  onReorder: (id: number, to: number) => void;
  onTear: (info: TearInfo) => void;
  /** `App`이 떼어내기를 몰고 가는 중인가. 참이면 순서 바꾸기를 하지 않는다. */
  tearing: boolean;
}

export interface TabDragHandlers {
  down: (e: ReactPointerEvent<HTMLElement>, id: number) => void;
  move: (e: ReactPointerEvent<HTMLElement>, id: number) => void;
  up: (e: ReactPointerEvent<HTMLElement>) => void;
  /**
   * 방금 끝난 끌기가 **떼어내기였는가**(한 번 읽으면 지워진다).
   *
   * 브라우저는 `pointerup` 바로 뒤에 `click`을 보내고, 그 클릭은 "그 탭을 고르라"는 뜻이
   * 된다. 떼어낸 탭은 이미 다른 창으로 가고 있으므로 **없는 탭을 활성으로 만드는** 셈이다
   * (탭 줄에 아무것도 선택되지 않고 편집 영역이 빈 호스트로 바뀐다). 그래서 탭을 고르기
   * 전에 이것을 묻는다.
   */
  tore: () => boolean;
  /**
   * 지금 끌고 있는가(누른 뒤 아직 떼지 않았다). 탭 줄의 **휠 넘기기**가 끌기 중에
   * 끼어들지 않으려고 묻는다 — 끌면서 줄이 움직이면 놓을 자리가 포인터 밑에서 바뀐다.
   */
  active: () => boolean;
}

export function useTabDrag(options: TabDragOptions): TabDragHandlers {
  const { container, axis, onReorder, onTear, tearing } = options;
  const drag = useRef<{
    id: number;
    from: { x: number; y: number };
    moved: boolean;
    torn: boolean;
  } | null>(null);
  const tore = useRef(false);

  return {
    active: () => drag.current !== null,
    tore: () => {
      const was = tore.current;
      tore.current = false;
      return was;
    },
    down: (e, id) => {
      if (e.button !== 0) return;
      tore.current = false;
      drag.current = { id, from: { x: e.clientX, y: e.clientY }, moved: false, torn: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    move: (e, id) => {
      const d = drag.current;
      if (!d || d.id !== id || d.torn || tearing) return;
      const root = container.current;
      if (!root) return;
      const pos = { x: e.clientX, y: e.clientY };

      // 1) 탭 줄을 벗어났는가 — 순서 바꾸기보다 **먼저** 본다. 줄 밖으로 나간 포인터에
      //    순서를 맞추면 끝 자리로 튕기고 떼어내기가 영원히 시작되지 않는다.
      const box = root.getBoundingClientRect();
      const strip = { x: box.left, y: box.top, w: box.width, h: box.height };
      if (tearStarted(axis, pos, d.from, strip)) {
        d.torn = true;
        tore.current = true;
        const pill = e.currentTarget.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        onTear({
          id,
          w: Math.round(pill.width * dpr),
          h: Math.round(pill.height * dpr),
          grabX: Math.round((d.from.x - pill.left) * dpr),
          grabY: Math.round((d.from.y - pill.top) * dpr),
          tabX: Math.round(pill.left * dpr),
          tabY: Math.round(pill.top * dpr),
        });
        return;
      }

      // 2) 줄 안의 순서 바꾸기.
      const along = axis === "x" ? pos.x : pos.y;
      const start = axis === "x" ? d.from.x : d.from.y;
      if (!d.moved && Math.abs(along - start) < THRESHOLD) return;
      d.moved = true;
      const spans = Array.from(root.querySelectorAll<HTMLElement>('[data-tab="1"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return axis === "x" ? { start: r.left, end: r.right } : { start: r.top, end: r.bottom };
      });
      onReorder(id, dropIndex(spans, along));
    },
    up: (e) => {
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
  };
}
