import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { t } from "../lib/i18n";
import { TINT_DOTS } from "../lib/palette";
import { clippedPills, pageScroll, scrollToPill, type ListMode, type Span } from "../lib/tabStrip";
import { tabLabel, type Tab } from "../lib/tabs";
import { useTabDrag, type TearInfo } from "./useTabDrag";

/**
 * 위 줄 — 시안 R5 (36px, 배경은 종이색이라 자기 배경이 없다).
 *
 * [목록 버튼 26] [알약 탭…] [+ 26] [빈 곳(끌기)] [─ □ ✕ 각 34×36]
 *
 * 메모 목록을 켜면 알약 탭은 **목록으로 옮겨 가고** 이 줄에는 창 버튼만 남는다
 * (시안 R5List). 목록 버튼도 그때는 패널 머리로 옮겨 간다.
 *
 * 빈 곳 전체가 `data-tauri-drag-region`이라 끌기와 더블클릭 최대화가 된다.
 *
 * 오버레이에서는 **이 줄 전체가 bar 색으로 불투명하게 남고 통째로 `data-hit`**이다
 * (원본도 오버레이에서 제목 줄을 불투명하게 유지했다). 그래야 빈 곳을 끌어 창을 옮기고
 * 더블클릭으로 최대화할 수 있다 — 빈 곳이 클릭 통과 영역이면 끌기가 뒤 창으로 빠진다.
 * 위 모서리 반지름은 창 바깥 반지름 8과 맞춘다.
 *
 * **넘침**(시안 R5에 없는 경우 — 시안은 한 폭으로만 그려진다). 원본이 같은 자리에서
 * 내린 판단을 그대로 쓴다(`main.cpp` `LayoutTabs`, NEXT_SESSION ⑮): 먼저 탭을
 * **줄이고 이름을 `…`로 자르고**(최소 84px, 아주 좁은 창에서는 44px), 그래도 모자라면
 * `◀ ▶`가 나오고 `+`는 스크롤 영역 **밖**에 고정된다 — 좁은 창을 구해 주는 그 버튼이
 * 스크롤되어 사라지면 안 되기 때문이다. 줄이는 일은 flex(`min-width`/`max-width`)가
 * 하고, 여기서는 "넘쳤는가"만 재서 화살표를 켠다.
 *
 * **반쯤 잘린 알약을 없앤다**(사용자 보고 3). 스크롤 영역의 끝에서는 알약이 잘려
 * 보였다. 그래서 `tabStrip.ts`가 "온전히 보이지 않는 알약"을 골라 주고 그 알약은
 * `visibility: hidden`이 된다 — **자리는 그대로 남으므로** 끌어서 순서 바꾸기의 좌표
 * 계산(`dropIndex`)이 하나도 달라지지 않는다. 화살표도 알약 경계에 맞춰 멈추고,
 * 활성 탭이 바뀌면(메모 목록·막대·Ctrl+Tab) 그 알약이 보이게 줄을 민다.
 *
 * **끌어서 순서 바꾸기**: 누른 자리에서 6px을 넘어가면 끌기로 보고, 포인터가 이웃 탭
 * 위를 지나는 순간 자리를 바꾼다(원본과 같은 규칙이라 드롭 표시가 필요 없다).
 * 자리 계산은 `tabs.ts`의 `dropIndex` 하나이고 메모 목록도 같은 함수를 쓴다.
 *
 * **떼어내기**: 포인터가 이 줄을 벗어나면 `useTabDrag`이 손을 떼고 `App`이 고스트 탭을
 * 띄운다(§5). 반대로 **다른 창에서 끌어온 탭**이 이 줄 위에 있으면 `dropAt`이 들어갈
 * 자리를 알려 주고, 그 자리에 2px accent 선을 그린다 — 창을 넘는 끌기에서는 결과가
 * 아직 화면에 없으므로(줄 안 순서 바꾸기와 다르다) 표시가 있어야 어디에 놓이는지 보인다.
 */

interface Props {
  tabs: readonly Tab[];
  activeId: number;
  /**
   * 메모 목록의 단계. `full`일 때만 알약 탭이 **목록으로 옮겨 가고**(시안 R5List) 이 줄에는
   * 창 버튼만 남는다. `rail`(좁은 창의 색 점 막대)에서는 이름이 보이지 않으므로 알약 탭이
   * 이 줄에 그대로 있다. 목록 버튼은 목록이 꺼져 있을 때만 이 줄에 있다(켜면 목록 머리로).
   */
  listMode: ListMode;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onNewTab: () => void;
  /** 끌어서 순서 바꾸기 — `id`를 보이는 탭의 `to` 번째 자리로. */
  onReorder: (id: number, to: number) => void;
  onToggleNoteList: () => void;
  /** 제목 줄 우클릭 → 시스템 메뉴 (원본과 같다). */
  onSystemMenu: (x: number, y: number) => void;
  /** 알약 줄 요소 — `App`이 놓을 자리(드롭 존)를 재는 데 쓴다. */
  zoneRef: RefObject<HTMLDivElement | null>;
  /** 포인터가 이 줄을 벗어났다 — 여기서부터 `App`이 떼어내기를 몰고 간다. */
  onTear: (info: TearInfo) => void;
  /** `App`이 떼어내기를 몰고 가는 중인가. */
  tearing: boolean;
  /** 끌어온 탭이 들어갈 자리(0 ~ 탭 수). `null`이면 표시하지 않는다. */
  dropAt: number | null;
}

/** 목록 패널 아이콘 — 시안 R5List 그대로 (왼쪽 칸이 있는 네모). */
export function PanelIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
  );
}

export function TintDot({ tint }: { tint: Tab["tint"] }) {
  if (tint === "none") return <span className="tint-dot" data-empty="1" />;
  return <span className="tint-dot" style={{ background: TINT_DOTS[tint] }} />;
}

/**
 * 탭마다 붙는 닫기 ✕ — Windows 11 메모장과 같다: **활성 탭에는 늘 보이고 비활성
 * 탭에는 가리킬 때만** 보인다(보임새는 CSS가 정한다 — 메모 목록은 가리킬 때만).
 * 자리는 늘 차지하므로 가리킬 때 알약 폭이 흔들리지 않는다(메모장도 그렇다).
 *
 * `<button>` 안에 `<button>`을 넣을 수 없으므로(알약 자체가 버튼이다) `role="button"`인
 * `<span>`이다. `pointerdown`을 여기서 멈추는 것이 핵심 — 멈추지 않으면 `useTabDrag`이
 * 끌기로 보고 탭을 떼어낸다. `click`도 멈춰서 탭 전환이 일어나지 않게 한다.
 *
 * 누른 뒤의 동작은 **기존 탭 닫기 규칙 그대로**다(`App.closeTab`): 미저장이면 D1로 묻고,
 * 알림이 걸린 탭은 숨겨 보관하고, 마지막 탭이면 창이 닫힌다.
 *
 * `label`은 메모 목록의 **최근 파일** 줄이 쓴다 — 거기서 ✕는 탭 닫기가 아니라
 * `목록에서 빼기`라서 말이 달라야 한다(모양과 멈추는 규칙은 같다).
 */
export function TabClose({ label, onClose }: { label?: string; onClose: () => void }) {
  const name = label ?? t("menuCloseTab");
  return (
    <span
      className="tab-close"
      role="button"
      tabIndex={-1}
      aria-label={name}
      title={name}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      ✕
    </span>
  );
}

/** 알약들의 내용 좌표 범위 — 넘침 계산(`tabStrip.ts`)에 넘기는 유일한 측정값. */
function pillSpans(strip: HTMLElement): Span[] {
  const box = strip.getBoundingClientRect();
  const base = box.left - strip.scrollLeft;
  return Array.from(strip.querySelectorAll<HTMLElement>('[data-tab="1"]')).map((el) => {
    const r = el.getBoundingClientRect();
    return { start: r.left - base, end: r.right - base };
  });
}

export default function TitleBar({
  tabs,
  activeId,
  listMode,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onReorder,
  onToggleNoteList,
  onSystemMenu,
  zoneRef,
  onTear,
  tearing,
  dropAt,
}: Props) {
  const win = getCurrentWindow();
  const stripRef = zoneRef;
  const [overflow, setOverflow] = useState(false);
  /** 반쯤 잘려 보이지 않게 숨길 알약(자리는 그대로 남는다). */
  const [clipped, setClipped] = useState<readonly boolean[]>([]);
  const drag = useTabDrag({
    container: stripRef,
    axis: "x",
    onReorder,
    onTear,
    tearing,
  });

  /** 줄여도 모자라는가(= `◀ ▶`) + 어느 알약이 잘렸는가. */
  const measure = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    setOverflow(strip.scrollWidth > strip.clientWidth + 1);
    const next = clippedPills(pillSpans(strip), strip.clientWidth, strip.scrollLeft);
    // 같은 답이면 상태를 건드리지 않는다(숨김이 자리를 바꾸지 않으므로 되풀이는 없지만,
    // 쓸데없는 재렌더가 끌기 중에 끼어들지 않게 한다).
    setClipped((old) =>
      old.length === next.length && old.every((v, i) => v === next[i]) ? old : next
    );
  }, [stripRef]);

  useEffect(() => {
    measure();
    const strip = stripRef.current;
    if (!strip) return undefined;
    /*
     * 재는 일은 **한 프레임에 한 번**으로 묶는다(`App`의 오버레이 사각형과 같은 수법).
     *
     * `ResizeObserver` 콜백은 레이아웃 바로 뒤, 같은 프레임 안에서 불린다. 거기서
     * 바로 `setState`를 하면 React는 그것을 **커밋 중에 끼어든 갱신**으로 세고, 알약
     * 줄이 움직이는 동안(부드러운 스크롤·빠른 입력) 그 사슬이 50개를 넘어
     * `Maximum update depth exceeded`를 콘솔에 뱉었다. rAF로 한 번 미루면 콜백과
     * 갱신이 다른 프레임으로 갈라져 사슬이 끊긴다 — 재는 값은 그대로다.
     */
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    // 창 폭·탭 개수·이름 길이 어느 것이 바뀌어도 같은 답을 다시 구해야 한다.
    const observer = new ResizeObserver(schedule);
    observer.observe(strip);
    window.addEventListener("resize", schedule);
    strip.addEventListener("scroll", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      strip.removeEventListener("scroll", schedule);
    };
    // `tabs`는 **그 목록이 실제로 바뀔 때만** 새 배열이어야 한다(`App`의 `shown`이
    // `useMemo`인 이유) — 렌더마다 새 배열이면 이 효과가 렌더마다 다시 돌며 잰다.
  }, [measure, stripRef, tabs]);

  /**
   * 활성 탭이 잘린 자리에 있으면 줄을 밀어 보이게 한다 — 메모 목록·색 점 막대나
   * Ctrl+Tab으로 **지금 안 보이는 탭을 고를 수 있어야** 하기 때문이다.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const at = tabs.findIndex((tab) => tab.id === activeId);
    if (at < 0) return;
    const left = scrollToPill(
      pillSpans(strip),
      strip.clientWidth,
      strip.scrollLeft,
      at,
      strip.scrollWidth - strip.clientWidth
    );
    if (Math.abs(left - strip.scrollLeft) > 0.5) strip.scrollTo({ left, behavior: "smooth" });
  }, [activeId, stripRef, tabs]);

  /** 화살표 — 알약 경계에 딱 맞게 멈춘다(잘린 알약이 남지 않게). */
  const page = (dir: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    const left = pageScroll(
      pillSpans(strip),
      strip.clientWidth,
      strip.scrollLeft,
      dir,
      strip.scrollWidth - strip.clientWidth
    );
    strip.scrollTo({ left, behavior: "smooth" });
  };

  return (
    <div
      className="titlebar"
      // 끌기 영역은 **빈 곳(`.titlebar-drag`)에만** 붙인다. 이 줄 전체에 붙이면
      // Tauri의 끌기 처리가 알약 탭과 창 버튼의 클릭까지 먹는다.
      // `data-hit`은 줄 전체에 붙는다 — 위 설명 참고.
      data-hit
      onContextMenu={(e) => {
        e.preventDefault();
        onSystemMenu(e.clientX, e.clientY);
      }}
    >
      {listMode !== "full" && (
        <>
          {listMode === "off" && (
            <button
              className="list-toggle"
              type="button"
              aria-label={t("noteListShow")}
              title={t("menuNoteList")}
              data-hit
              onClick={onToggleNoteList}
            >
              <PanelIcon />
            </button>
          )}

          {overflow && (
            <button
              className="tab-arrow"
              type="button"
              aria-label={t("tabScrollLeft")}
              data-hit
              onClick={() => page(-1)}
            >
              ◀
            </button>
          )}

          <div className="tab-strip" ref={stripRef} data-hit>
            {tabs.map((tab, i) => (
              <button
                className="tab-pill"
                type="button"
                key={tab.id}
                data-drop={dropAt === i ? "before" : undefined}
                data-tab="1"
                data-active={tab.id === activeId ? "1" : "0"}
                // 반쯤 잘린 알약은 숨긴다(자리는 그대로) — `tabStrip.ts` 참고.
                data-clipped={clipped[i] ? "1" : undefined}
                title={tabLabel(tab)}
                data-hit
                // 떼어내기로 끝난 끌기의 클릭은 버린다 — 그 탭은 이미 다른 창으로 간다.
                onClick={() => {
                  if (!drag.tore()) onSelectTab(tab.id);
                }}
                onPointerDown={(e) => drag.down(e, tab.id)}
                onPointerMove={(e) => drag.move(e, tab.id)}
                onPointerUp={drag.up}
                onPointerCancel={drag.up}
                // 가운데 클릭으로 닫기 (메모장과 같다). auxclick이 가운데 버튼의 제자리다.
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
              >
                <TintDot tint={tab.tint} />
                <span>{tabLabel(tab)}</span>
                {tab.dirty && <span className="dirty-dot" />}
                {/* 탭이 하나뿐이면 ✕가 없다(메모장과 같다 — 그 창의 닫기는 제목 줄 ✕다). */}
                {tabs.length > 1 && <TabClose onClose={() => onCloseTab(tab.id)} />}
              </button>
            ))}
            {/* 맨 끝에 놓는 경우 — 알약의 `::before`로는 그릴 자리가 없다. */}
            {dropAt !== null && dropAt >= tabs.length && <span className="drop-mark" />}
          </div>

          {overflow && (
            <button
              className="tab-arrow"
              type="button"
              aria-label={t("tabScrollRight")}
              data-hit
              onClick={() => page(1)}
            >
              ▶
            </button>
          )}

          <button
            className="tab-new"
            type="button"
            aria-label={t("menuNewTab")}
            data-hit
            onClick={onNewTab}
          >
            +
          </button>
        </>
      )}

      {/* 빈 곳(끌기) + 테이프 자리.
          테이프는 `position: fixed`로 **창 가로 가운데**에 떠 있으므로(시안 Pin), 위 줄의
          탭·`+`·창 버튼이 그 자리를 밟지 않게 흐름 안에 72px(테이프 56 + 좌우 8)을
          비워 둔다. 오른쪽 빈 곳의 폭을 `50% - 138`(= 창 버튼 34×3 + 36)로 고정하면
          그 72px 칸이 정확히 창 가운데에 온다 — 왼쪽 빈 곳이 남는 폭을 다 먹고,
          좁아지면 왼쪽 빈 곳이 0이 된 다음 알약이 줄어든다(R5의 넘침 규칙 그대로). */}
      <div className="titlebar-drag" data-tauri-drag-region />
      <div className="tape-slot" data-tauri-drag-region />
      <div className="titlebar-drag titlebar-drag-right" data-tauri-drag-region />

      <button
        className="caption-btn"
        type="button"
        aria-label={t("sysMinimize")}
        data-hit
        onClick={() => void win.minimize()}
      >
        ─
      </button>
      <button
        className="caption-btn"
        type="button"
        aria-label={t("sysMaximize")}
        data-hit
        onClick={() => void win.toggleMaximize()}
      >
        □
      </button>
      <button
        className="caption-btn"
        data-close="1"
        type="button"
        aria-label={t("sysClose")}
        data-hit
        onClick={() => void win.close()}
      >
        ✕
      </button>
    </div>
  );
}
