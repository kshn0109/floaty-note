import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { runCommand, type CommandTable } from "../lib/commands";
import { DOCK_MARGIN, dockLayout, type FoldItem } from "../lib/dockFit";
import { t } from "../lib/i18n";
import { HEADING_MENU, PEN_MENU, rootMenu, type Menu } from "../lib/menus";
import { HIGHLIGHTS, OPACITY_MAX, OPACITY_MIN, OPACITY_STEP } from "../lib/palette";

/**
 * 떠 있는 도구 줄 — 시안 R5 + N2b.
 *
 * 높이 38 · r14 · bar 배경 · 1px hairline · 안쪽 여백 0 5 · 버튼 사이 2,
 * 버튼 30×28 r10, 구분선 1×18(좌우 여백 3), 아래 여백 14, 가운데 정렬.
 *   [☰] | [B][형광펜][H ▾][•≡][표][S] | [◐ NN%]
 *
 * 맨 오른쪽 `⚙`는 2026-11-09 사용자 결정으로 **빠졌다**(설정은 ☰ 메뉴에 있다). 그 자리를
 * 글머리 기호 전용 버튼 `•≡`이 받았다(승인된 시안 L1) — H ▾ 바로 오른쪽.
 *
 * **자리가 없으면 끝에서부터 `⋯`로 접는다**(승인된 시안 N2b·L1): ◐ → 취소선 → 표 → •≡ →
 * H ▾ 순서이고 ☰ · B · 형광펜은 끝까지 남는다. `⋯`(30 r10, hover 채움)를 누르면
 * 접힌 것만 담은 작은 팝오버가 위로 열린다 — 모양은 승인된 ◐ 팝오버(Pin ③, 폭 236 ·
 * 안쪽 10 12)에 팝업 행(30 r8)을 붙인 것이고 새 모양이 아니다. **넓은 창에서는
 * `⋯`가 없고 R5 모양과 한 픽셀도 다르지 않다.** 접는 판단은 `lib/dockFit.ts`(순수).
 *
 * 마우스가 창 밖이면 사라진다(시안 R5의 요점). 메뉴나 팝오버가 열려 있거나
 * 도구 줄 안에 키보드 초점이 있으면 그대로 남는다 — 그 판단은 `App`이 한다.
 * 사라질 때도 `opacity: 0`일 뿐이라(`index.css`) **Tab이 도구 줄에 닿는다**.
 *
 * 불투명도는 칩을 누르면 **위로 열리는 팝오버** 안의 슬라이더다
 * (범위 10~100%, 휠 한 칸 5% — 원본과 같다). 오버레이에서는 칩을 숨긴다(원본과 같다).
 */

const TRACK = 110;
const THUMB = 14;
/**
 * ◐ 팝오버 크기 — 자리 잡기에 측정이 필요 없게 고정. 시안 Pin ③: **폭 236**,
 * 안쪽 10 12, 줄 간격 10. 높이는 [오버레이 줄 32][hairline 1][슬라이더 줄 20]
 * + 안쪽 20 + 간격 20 = 93.
 */
const POP_W = 236;
const POP_H = 93;
const POP_GAP = 6;
const SCREEN_MARGIN = 8;

function clamp(value: number): number {
  return Math.min(Math.max(Math.round(value), OPACITY_MIN), OPACITY_MAX);
}

/** 칩 가운데에 맞추고 화면 안으로 당긴다. */
function popLeft(anchor: DOMRect): number {
  const maxLeft = window.innerWidth - POP_W - SCREEN_MARGIN;
  return Math.round(
    Math.min(
      Math.max(anchor.left + anchor.width / 2 - POP_W / 2, SCREEN_MARGIN),
      Math.max(maxLeft, SCREEN_MARGIN)
    )
  );
}

interface Props {
  opacity: number;
  onOpacity: (value: number) => void;
  highlight: number;
  overlay: boolean;
  commands: CommandTable;
  /** 버튼에 대고 팝업 메뉴를 연다 (위로). */
  onOpenMenu: (menu: Menu, el: HTMLElement) => void;
  opacityOpen: boolean;
  onOpacityOpen: (open: boolean) => void;
  /** `⋯` 팝오버 — 열려 있으면 마우스가 밖에 나가도 도구 줄이 남는다(`App`이 판단). */
  moreOpen: boolean;
  onMoreOpen: (open: boolean) => void;
  /** ☰ 버튼 — `F10`이 이 버튼에 대고 메뉴를 연다(`App`). */
  menuBtnRef: React.RefObject<HTMLButtonElement | null>;
  /**
   * 서식 버튼(B·형광펜·H·표·S)을 쓸 수 있는가. 일반 텍스트 탭에서는 꺼진다
   * (흐리게 + 눌러도 아무 일 없음 — 사용자 결정 3).
   */
  canFormat: boolean;
  /** 눌린 모양 — 커서 위치의 서식 상태(원본 툴바와 같다). */
  bold: boolean;
  strike: boolean;
  heading: number;
  /** 커서 줄이 글머리 기호 항목인가 — 취소선 버튼과 **같은 방식**의 눌린 모양. */
  bullet: boolean;
  penOn: boolean;
  /** 표 버튼 — 8×8 격자 팝업을 이 버튼에 대고 연다. */
  onTable: (el: HTMLElement) => void;
  /** ◐ 팝오버 맨 위 줄의 오버레이 스위치. */
  onOverlay: (on: boolean) => void;
}

export default function ToolDock({
  opacity,
  onOpacity,
  highlight,
  overlay,
  commands,
  onOpenMenu,
  opacityOpen,
  onOpacityOpen,
  moreOpen,
  onMoreOpen,
  menuBtnRef,
  canFormat,
  bold,
  strike,
  heading,
  bullet,
  penOn,
  onTable,
  onOverlay,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const morePopRef = useRef<HTMLDivElement>(null);

  /**
   * 쓸 수 있는 폭. 담는 칸(`.content` — 메모 목록은 이미 빠져 있다)을 지켜본다.
   *
   * **되풀이를 막는 두 가지**: 값이 같으면 상태를 바꾸지 않고(리렌더 없음), 측정은
   * rAF로 한 번만 묶는다. 접힌 뒤의 **줄 폭은 재지 않는다** — 그러면 접기가 자기
   * 결과를 다시 입력으로 먹어 접었다 펴기가 돈다(예전 `Maximum update depth exceeded`).
   */
  const [avail, setAvail] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const box = dockRef.current?.parentElement;
    if (!box) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const next = box.clientWidth - DOCK_MARGIN;
      setAvail((old) => (old === next ? old : next));
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(box);
    measure();
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const { folded } = useMemo(
    () => dockLayout({ avail, opacity, heading, overlay }),
    [avail, opacity, heading, overlay]
  );
  const gone = (item: FoldItem): boolean => folded.includes(item);

  // 창이 넓어져 접힌 것이 없어지면 `⋯` 팝오버도 닫는다(열 손잡이가 사라졌다).
  useEffect(() => {
    if (folded.length === 0 && moreOpen) onMoreOpen(false);
  }, [folded.length, moreOpen, onMoreOpen]);

  // ◐ 팝오버 — 칩 위로 열고 화면 안으로 맞춘다.
  useLayoutEffect(() => {
    if (!opacityOpen) return;
    const chip = chipRef.current;
    const pop = popRef.current;
    if (!chip || !pop) return;
    const r = chip.getBoundingClientRect();
    pop.style.left = `${popLeft(r)}px`;
    pop.style.top = `${Math.round(Math.max(r.top - POP_H - POP_GAP, SCREEN_MARGIN))}px`;
    pop.focus({ preventScroll: true });
  }, [opacityOpen]);

  /**
   * `⋯` 팝오버 — 접힌 것이 몇 개냐에 따라 높이가 달라지므로 **아래쪽을 고정한다**
   * (`bottom`). 그러면 높이를 재지 않아도 버튼 바로 위에 붙는다.
   */
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const btn = moreRef.current;
    const pop = morePopRef.current;
    if (!btn || !pop) return;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${popLeft(r)}px`;
    pop.style.bottom = `${Math.round(
      Math.max(window.innerHeight - r.top + POP_GAP, SCREEN_MARGIN)
    )}px`;
    pop.focus({ preventScroll: true });
  }, [moreOpen, folded.length]);

  const valueFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return OPACITY_MAX;
    const rect = track.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * 100);
  }, []);

  /**
   * 슬라이더(또는 % 숫자) 위에서 휠을 굴리면 5%씩 — 원본과 같다.
   * 전파를 막는 것은 Ctrl+휠 확대가 같이 걸리지 않게 하기 위한 것이다
   * (도구 줄을 휠로 미는 동작은 N2b에서 없어졌다 — 넘치면 접히므로 밀 것이 없다).
   */
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpacity(clamp(opacity + (e.deltaY < 0 ? OPACITY_STEP : -OPACITY_STEP)));
  };

  const fill = (opacity / 100) * TRACK;

  /** 오버레이 스위치 + 불투명도 슬라이더 — ◐ 팝오버와 `⋯` 팝오버가 함께 쓴다. */
  const opacityRows = (withKey: boolean) => (
    <>
      <div className="opacity-row">
        <div className="opacity-row-label">
          <div className="opacity-row-title">{t("overlaySwitch")}</div>
          {withKey && <div className="opacity-row-key">Ctrl+Shift+T</div>}
        </div>
        <button
          className="set-switch"
          type="button"
          role="switch"
          aria-checked={overlay}
          aria-label={t("overlaySwitch")}
          data-on={overlay ? "1" : "0"}
          onClick={() => onOverlay(!overlay)}
        >
          <span className="set-knob" />
        </button>
      </div>

      {/* 슬라이더 줄 — 오버레이가 켜져 있으면 흐리게 + 조작 불가(배경이 완전
          투명이라 쓰지 않는 값이다). 끄면 직전 값이 그대로 돌아온다. */}
      <div className="opacity-row" data-off={overlay ? "1" : "0"}>
        <div className="opacity-row-key">{t("opacity")}</div>
        <div
          className="slider-wrap"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onOpacity(valueFromEvent(e.clientX));
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            onOpacity(valueFromEvent(e.clientX));
          }}
        >
          <div className="slider" ref={trackRef}>
            <div className="slider-fill" style={{ width: `${fill}px` }} />
            <div className="slider-thumb" style={{ left: `${fill - THUMB / 2}px` }} />
          </div>
        </div>
        <div className="opacity-row-key">{opacity}%</div>
      </div>
    </>
  );

  /** 접힌 명령 줄(H ▾ · 표 · 취소선) — 줄 순서는 도구 줄의 순서 그대로다. */
  const foldedRows: React.ReactNode[] = [];
  if (gone("heading")) {
    foldedRows.push(
      <button
        key="heading"
        className="popup-row"
        type="button"
        aria-haspopup="menu"
        disabled={!canFormat}
        onClick={(e) => {
          onMoreOpen(false);
          onOpenMenu(HEADING_MENU, e.currentTarget);
        }}
      >
        <span className="popup-label">{t("dockHeading")}</span>
        <span className="popup-caret">▸</span>
      </button>
    );
  }
  if (gone("bullet")) {
    foldedRows.push(
      <button
        key="bullet"
        className="popup-row"
        type="button"
        aria-pressed={bullet}
        disabled={!canFormat}
        onClick={() => {
          onMoreOpen(false);
          runCommand(commands, "bullet");
        }}
      >
        <span className="popup-label">{t("dockBullet")}</span>
        <span className="popup-key">Ctrl+Shift+8</span>
      </button>
    );
  }
  if (gone("table")) {
    foldedRows.push(
      <button
        key="table"
        className="popup-row"
        type="button"
        disabled={!canFormat}
        onClick={(e) => {
          const el = e.currentTarget;
          onMoreOpen(false);
          onTable(el);
        }}
      >
        <span className="popup-label">{t("btnTable")}</span>
        <span className="popup-key">Ctrl+Shift+L</span>
      </button>
    );
  }
  if (gone("strike")) {
    foldedRows.push(
      <button
        key="strike"
        className="popup-row"
        type="button"
        aria-pressed={strike}
        disabled={!canFormat}
        onClick={() => {
          onMoreOpen(false);
          runCommand(commands, "strike");
        }}
      >
        <span className="popup-label">{t("dockStrike")}</span>
        <span className="popup-key">Ctrl+Shift+X</span>
      </button>
    );
  }

  return (
    <>
      <div className="dock" data-hit ref={dockRef}>
        <button
          className="dock-btn"
          type="button"
          ref={menuBtnRef}
          aria-label={t("dockMenu")}
          aria-haspopup="menu"
          onClick={(e) => onOpenMenu(rootMenu(import.meta.env.DEV), e.currentTarget)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
          </svg>
        </button>

        <div className="dock-sep" />

        <button
          className="dock-btn dock-bold"
          type="button"
          aria-label={t("hintBold")}
          aria-pressed={bold}
          disabled={!canFormat}
          data-on={bold ? "1" : "0"}
          onClick={() => runCommand(commands, "bold")}
        >
          B
        </button>
        <button
          className="dock-btn"
          type="button"
          aria-label={penOn ? t("hintHighlightOn") : t("hlPickTitle")}
          aria-haspopup="menu"
          disabled={!canFormat}
          data-on={penOn ? "1" : "0"}
          onClick={(e) => onOpenMenu(PEN_MENU, e.currentTarget)}
        >
          <span
            className="dock-pen-swatch"
            style={{ background: HIGHLIGHTS[highlight] ?? HIGHLIGHTS[0] }}
          />
        </button>
        {!gone("heading") && (
          <button
            className="dock-btn dock-head"
            type="button"
            aria-label={t("hintH1")}
            aria-haspopup="menu"
            disabled={!canFormat}
            data-on={heading > 0 ? "1" : "0"}
            onClick={(e) => onOpenMenu(HEADING_MENU, e.currentTarget)}
          >
            {heading > 0 ? `H${heading} ▾` : "H ▾"}
          </button>
        )}
        {/* 글머리 기호 — H ▾ 바로 오른쪽(시안 L1). 아이콘은 옆 `B`·`S`처럼 **글자**다
            (`•≡` = 기호 + 줄): 선 아이콘을 쓰면 굵기·크기를 따로 맞춰야 한다. */}
        {!gone("bullet") && (
          <button
            className="dock-btn dock-bullet"
            type="button"
            aria-label={t("btnBullet")}
            aria-pressed={bullet}
            disabled={!canFormat}
            data-on={bullet ? "1" : "0"}
            onClick={() => runCommand(commands, "bullet")}
          >
            •≡
          </button>
        )}
        {!gone("table") && (
          <button
            className="dock-btn"
            type="button"
            aria-label={t("btnTable")}
            disabled={!canFormat}
            onClick={(e) => onTable(e.currentTarget)}
          >
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
              <path d="M2 6.5h12M2 10h12M6.5 2.5v11" />
            </svg>
          </button>
        )}
        {/* 취소선 — 표 바로 오른쪽. 아이콘은 옆 `B`와 같은 **글자**다(`S` + 가운데 선):
            선 아이콘(lucide `Strikethrough`)을 쓰면 B·H와 굵기·크기를 따로 맞춰야 하는데,
            글자로 두면 `.dock-bold`와 같은 규칙이 그대로 적용된다. */}
        {!gone("strike") && (
          <button
            className="dock-btn dock-bold dock-strike"
            type="button"
            aria-label={t("btnStrike")}
            aria-pressed={strike}
            disabled={!canFormat}
            data-on={strike ? "1" : "0"}
            onClick={() => runCommand(commands, "strike")}
          >
            S
          </button>
        )}

        <div className="dock-sep" />

        {!overlay && !gone("opacity") && (
          <button
            className="dock-btn dock-opacity"
            type="button"
            ref={chipRef}
            aria-label={t("hintSlider")}
            aria-haspopup="dialog"
            aria-expanded={opacityOpen}
            onClick={() => onOpacityOpen(!opacityOpen)}
            onWheel={onWheel}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
            </svg>
            <span>{opacity}%</span>
          </button>
        )}
        {/* `⋯` — **접힌 것이 있을 때만** 나온다(시안 N2b: hover 채움으로 눈에 띈다). */}
        {folded.length > 0 && (
          <button
            className="dock-btn dock-more"
            type="button"
            ref={moreRef}
            aria-label={t("dockMore")}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => onMoreOpen(!moreOpen)}
          >
            ⋯
          </button>
        )}
      </div>

      {opacityOpen && !overlay && (
        <div
          className="popup-scrim"
          // 메뉴와 같은 이유로 `data-hit` — 오버레이에서 바깥 클릭이 통과하면
          // 팝오버가 닫히지 않는다.
          data-hit
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onOpacityOpen(false);
          }}
        >
          <div
            className="popup opacity-pop"
            role="dialog"
            aria-label={t("opacity")}
            tabIndex={-1}
            ref={popRef}
            data-hit
            style={{ width: POP_W, height: POP_H }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") onOpacityOpen(false);
              else if (e.key === "ArrowLeft") onOpacity(clamp(opacity - OPACITY_STEP));
              else if (e.key === "ArrowRight") onOpacity(clamp(opacity + OPACITY_STEP));
              else return;
              e.preventDefault();
            }}
            onWheel={onWheel}
          >
            {/* 맨 위 줄 — 오버레이 스위치 (시안 Pin ③). */}
            {opacityRows(true)}
          </div>
        </div>
      )}

      {/* `⋯` 팝오버 — 시안 N2b. 접힌 것만 담는다: 명령 줄 → 오버레이·불투명도.
          줄이 하나도 없는 일은 없다(접힌 것이 있어야 `⋯`가 나온다). */}
      {moreOpen && folded.length > 0 && (
        <div
          className="popup-scrim"
          data-hit
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onMoreOpen(false);
          }}
        >
          <div
            className="popup more-pop"
            role="dialog"
            aria-label={t("dockMore")}
            tabIndex={-1}
            ref={morePopRef}
            data-hit
            style={{ width: POP_W }}
            data-dense={foldedRows.length > 0 ? "1" : "0"}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              onMoreOpen(false);
            }}
            onWheel={gone("opacity") ? onWheel : undefined}
          >
            {foldedRows}
            {foldedRows.length > 0 && gone("opacity") && <div className="more-hairline" />}
            {/* ◐ 접힘 = ◐ 팝오버와 **같은 조작**(오버레이 스위치 + 슬라이더)이 여기 온다.
                줄이 빽빽한 모양(명령 줄이 있을 때)에서는 시안대로 단축키 줄을 뺀다. */}
            {gone("opacity") && opacityRows(foldedRows.length === 0)}
          </div>
        </div>
      )}
    </>
  );
}
