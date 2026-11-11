import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { t } from "../lib/i18n";
import {
  POPUP_BORDER,
  POPUP_PAD,
  ROW_C,
  ROW_H,
  itemEnabled,
  itemMark,
  itemOffset,
  menuHeight,
  type Action,
  type Choice,
  type Menu,
  type MenuItem,
  type MenuState,
} from "../lib/menus";
import { ariaKeys, tipDelay, tipPosition, type TipAnchor, type TipPos } from "../lib/menuTip";
import { clampZoom } from "../lib/zoom";

/**
 * 팝업 메뉴 — 승인된 시안 `Popups.dc.html` 모양 하나로 전부 그린다
 * (시스템 메뉴, ☰와 그 하위 메뉴, H ▾, 형광펜). 효과(블러·그림자)는 넣지 않는다.
 *
 * 수치는 시안 그대로: 팝업 r12 · 패딩 5 · bar 배경 · 1px hairline,
 * 행 30 · r8 · 패딩 0 10 · 12px, 단축키 11px dim 오른쪽 정렬,
 * 구분선 1px(위아래 여백 4, 좌우 8), 섹션 라벨 22 · 11px dim.
 *
 * **간략 메뉴**(`menu.compact` — 승인된 시안 C2, 사용자 결정 2026-11-09)는 ☰의 하위
 * 메뉴 셋(파일·보기·테마)만 쓴다: 줄 26 · 패딩 0 8 · r7 · 구분선 여백 3 6 · 머리 20이고
 * **단축키 글자를 줄에 그리지 않는다** — 대신 0.6초 머물거나 키보드 초점이 가면
 * 말풍선으로 보여 준다(`lib/menuTip.ts`). 낭독기에는 `aria-keyshortcuts`로 계속 알린다.
 * 메모장 11은 줄에 단축키를 늘 보여 주므로 이것은 **의도된 차이**다(사용자 요청).
 *
 * 시안에 없는데 더한 것 하나: **키보드 초점 테두리**(1px accent, 안쪽).
 * 선택된 행과 초점이 있는 행이 둘 다 hover 채움이라 키보드만으로는 어디 있는지
 * 알 수 없기 때문이다. 다른 장식은 더하지 않았다.
 *
 * 자리 잡기에 측정이 없다. 행 높이가 전부 고정이고 폭을 메뉴가 들고 있으므로
 * (`menus.ts`) 크기를 정확히 계산해서 화면 안으로 맞춘다 — 그려 보고 다시 옮기는
 * 깜빡임이 없다. 말풍선만은 글자 폭을 모르므로 그린 뒤 한 번 재서 자리를 잡는다.
 */

export type Placement = "below" | "above" | "rightOf" | "at";

export interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Position {
  left: number;
  top: number;
}

/** 팝업 가족이 창 가장자리에서 떨어지는 거리. 좁은 창에서 카드 폭을 깎을 때도 쓴다. */
export const SCREEN_MARGIN = 8;
/** 하위 메뉴가 부모 위로 살짝 겹치는 양 (마우스가 틈으로 빠지지 않게). */
const SUB_OVERLAP = 4;
/** 위로 열리는 팝업과 누른 버튼 사이 간격. */
const GAP = 6;

/**
 * 네모 하나를 앵커에 대고 화면 안으로 맞춘 좌표. 메뉴·예약 창·예약 목록이 모두
 * 이 함수를 쓴다 — 크기를 **아는 채로** 계산하므로 그려 보고 다시 옮기는 깜빡임이 없다.
 *
 * `pad`는 `rightOf`에서만 쓴다(하위 메뉴 **자기** 안쪽 여백만큼 올려 첫 줄이 부모
 * 줄과 나란히 오게 한다 — 시안 C2의 `테마`는 여백이 8이다).
 */
export function placeBox(
  anchor: Anchor,
  width: number,
  height: number,
  placement: Placement,
  pad = POPUP_PAD
): Position {
  let left = anchor.left;
  let top = anchor.bottom;

  if (placement === "above") {
    top = anchor.top - height - GAP;
  } else if (placement === "rightOf") {
    left = anchor.right - SUB_OVERLAP;
    top = anchor.top - pad - POPUP_BORDER;
  } else if (placement === "at") {
    top = anchor.top;
  }

  const maxLeft = window.innerWidth - width - SCREEN_MARGIN;
  const maxTop = window.innerHeight - height - SCREEN_MARGIN;
  // 오른쪽으로 넘치는 하위 메뉴는 부모의 왼쪽으로 뒤집는다(Windows와 같다).
  if (placement === "rightOf" && left > maxLeft) {
    left = anchor.left - width + SUB_OVERLAP;
  }
  return {
    left: Math.round(Math.min(Math.max(left, SCREEN_MARGIN), Math.max(maxLeft, SCREEN_MARGIN))),
    top: Math.round(Math.min(Math.max(top, SCREEN_MARGIN), Math.max(maxTop, SCREEN_MARGIN))),
  };
}

/** 메뉴 하나를 앵커에 대고 화면 안으로 맞춘 좌표. */
export function placeMenu(menu: Menu, anchor: Anchor, placement: Placement): Position {
  return placeBox(anchor, menu.width, menuHeight(menu), placement, menu.pad ?? POPUP_PAD);
}

/**
 * 아래로 열되 **아래에 자리가 없으면 위로** 뒤집는다. 편집 영역의 커서에 대고 뜨는
 * 예약 창이 쓴다: 메뉴처럼 그냥 화면 안으로 밀어 넣으면 카드가 커서 위에 덮인다.
 */
export function placeFlip(anchor: Anchor, width: number, height: number): Position {
  const fitsBelow = anchor.bottom + GAP + height + SCREEN_MARGIN <= window.innerHeight;
  const fitsAbove = anchor.top - GAP - height >= SCREEN_MARGIN;
  if (!fitsBelow && fitsAbove) return placeBox(anchor, width, height, "above");
  return placeBox({ ...anchor, bottom: anchor.bottom + GAP }, width, height, "below");
}

function isFocusable(item: MenuItem, state: MenuState): boolean {
  if (item.kind === "sub" || item.kind === "tab") return true;
  if (item.kind === "zoom" || item.kind === "segment" || item.kind === "dots") return true;
  if (item.kind !== "row") return false;
  return itemEnabled(item.act, state);
}

/** 덩어리(세그먼트·색 점) 안에서 지금 고른 칸. 없으면 0. */
function pickedCell(options: readonly Choice[], state: MenuState): number {
  const at = options.findIndex((opt) => {
    const mark = itemMark(opt.act, state);
    return mark !== null && mark.on;
  });
  return at < 0 ? 0 : at;
}

/** 확대/축소 한 줄의 세 칸 — 시안 C2 순서(−, 배율, +). */
const ZOOM_CELLS = [
  { id: "zoomOut", key: "Ctrl+-", label: "menuZoomOut" },
  { id: "zoomReset", key: "Ctrl+0", label: "menuZoomReset" },
  { id: "zoomIn", key: "Ctrl+=", label: "menuZoomIn" },
] as const;

interface Props {
  menu: Menu;
  state: MenuState;
  position: Position;
  onAction: (act: Action) => void;
  /** 메뉴 전체를 닫는다 (행을 고른 뒤에도 전체가 닫힌다 — Windows와 같다). */
  onClose: () => void;
  /** 하위 메뉴일 때: 이것만 닫고 부모로 돌아간다. */
  onCloseSelf?: () => void;
  /** 하위 메뉴는 바깥 클릭 레이어를 다시 깔지 않는다. */
  nested?: boolean;
}

export default function Popup({
  menu,
  state,
  position,
  onAction,
  onClose,
  onCloseSelf,
  nested = false,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(-1);
  /** 덩어리 안의 칸 번호(세그먼트·색 점). 덩어리가 아니면 -1. */
  const [cell, setCell] = useState(-1);
  const [openSub, setOpenSub] = useState<number | null>(null);

  const compact = menu.compact === true;
  const pad = menu.pad ?? POPUP_PAD;

  // --- 단축키 말풍선 (간략 메뉴만) ---
  const [tip, setTip] = useState<{ text: string; anchor: TipAnchor } | null>(null);
  const [tipPos, setTipPos] = useState<TipPos | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  /** 한 번 떠 있은 뒤인가 — 그러면 다른 줄로 옮길 때 기다리지 않는다(시안 C2). */
  const warmRef = useRef(false);
  /** 마지막 초점 이동이 키보드였나 — 키보드면 말풍선을 기다리지 않고 바로 띄운다. */
  const kbRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hideTip = useCallback(() => {
    clearTimer();
    setTip(null);
    setTipPos(null);
  }, []);

  /** 선택자가 가리키는 요소에 대고 말풍선을 띄운다. */
  const showTip = useCallback((sel: string, text: string) => {
    const el = cardRef.current?.querySelector<HTMLElement>(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTip({ text, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
    setTipPos(null);
  }, []);

  const scheduleTip = useCallback(
    (hint: { sel: string; text: string } | null, now: boolean) => {
      if (!compact) return;
      clearTimer();
      if (!hint) {
        setTip(null);
        setTipPos(null);
        return;
      }
      const delay = now ? 0 : tipDelay(warmRef.current);
      if (delay === 0) {
        warmRef.current = true;
        showTip(hint.sel, hint.text);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        warmRef.current = true;
        showTip(hint.sel, hint.text);
      }, delay);
    },
    [compact, showTip]
  );

  useEffect(() => clearTimer, []);

  // 글자 폭을 미리 알 수 없으므로 **그린 뒤 한 번 재서** 창 안으로 맞춘다.
  useLayoutEffect(() => {
    if (!tip) return;
    const el = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos(tipPosition(tip.anchor, r.width, r.height, window.innerWidth, window.innerHeight, SCREEN_MARGIN));
  }, [tip]);

  /** 이 항목(그 안의 칸)에 걸린 말풍선 — 없으면 `null`. */
  const tipHint = useCallback(
    (index: number, at: number): { sel: string; text: string } | null => {
      const item = menu.items[index];
      if (!item) return null;
      if (item.kind === "row") {
        return item.key ? { sel: `[data-index="${index}"]`, text: item.key } : null;
      }
      if (item.kind === "zoom") {
        const z = ZOOM_CELLS[at];
        return z ? { sel: `[data-index="${index}"][data-cell="${at}"]`, text: z.key } : null;
      }
      if (item.kind === "segment") {
        // 머리에 있던 Ctrl+Shift+M은 **세그먼트 전체**에 걸린다(시안 C2).
        return item.key ? { sel: `[data-index="${index}"] .popup-seg`, text: item.key } : null;
      }
      if (item.kind === "dots") {
        const opt = item.options[at];
        return opt
          ? { sel: `[data-index="${index}"][data-cell="${at}"]`, text: t(opt.label) }
          : null;
      }
      return null;
    },
    [menu]
  );

  // --- 초점 ---
  const focusables = menu.items
    .map((item, i) => (isFocusable(item, state) ? i : -1))
    .filter((i) => i >= 0);

  /** 그 항목으로 초점을 옮긴다. 덩어리면 **고른 칸**에서 시작한다. */
  const goto = useCallback(
    (index: number) => {
      const item = menu.items[index];
      setFocus(index);
      if (item && (item.kind === "segment" || item.kind === "dots")) {
        setCell(pickedCell(item.options, state));
      } else {
        setCell(-1);
      }
      setOpenSub(null);
    },
    [menu, state]
  );

  const step = useCallback(
    (delta: number) => {
      if (focusables.length === 0) return;
      const at = focusables.indexOf(focus);
      const next =
        at < 0
          ? delta > 0
            ? 0
            : focusables.length - 1
          : (at + delta + focusables.length) % focusables.length;
      goto(focusables[next]);
    },
    [focus, focusables, goto]
  );

  const activate = useCallback(
    (index: number) => {
      const item = menu.items[index];
      if (!item) return;
      if (item.kind === "sub") {
        setFocus(index);
        setCell(-1);
        setOpenSub(index);
        return;
      }
      // 탭 목록(시안 T1) — 고르면 그 탭이 활성이 되고 메뉴는 닫힌다(다른 행과 같다).
      if (item.kind === "tab") {
        onAction({ t: "tab", id: item.id });
        onClose();
        return;
      }
      if (item.kind !== "row" || !itemEnabled(item.act, state)) return;
      onAction(item.act);
      onClose();
    },
    [menu, onAction, onClose, state]
  );

  /**
   * 덩어리의 칸 하나를 고른다 — **메뉴는 닫지 않는다**(설정 카드처럼 즉시 반영,
   * 사용자 지시 3). 확대/축소 −·+·배율도 같은 길이다.
   */
  const pick = useCallback(
    (index: number, at: number) => {
      const item = menu.items[index];
      if (!item) return;
      setFocus(index);
      if (item.kind === "zoom") {
        const z = ZOOM_CELLS[at];
        if (z) onAction({ t: "cmd", id: z.id });
        return;
      }
      if (item.kind !== "segment" && item.kind !== "dots") return;
      const opt = item.options[at];
      if (!opt) return;
      setCell(at);
      onAction(opt.act);
    },
    [menu, onAction]
  );

  /** 덩어리 안에서 ←→ — 옮기면서 **바로 고른다**(Windows 라디오 규칙). */
  const stepCell = useCallback(
    (index: number, delta: number) => {
      const item = menu.items[index];
      if (!item || (item.kind !== "segment" && item.kind !== "dots")) return;
      const n = item.options.length;
      const from = cell < 0 ? pickedCell(item.options, state) : cell;
      pick(index, (from + delta + n) % n);
    },
    [cell, menu, pick, state]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    const item = menu.items[focus];
    const inGroup = item?.kind === "segment" || item?.kind === "dots";
    const inZoom = item?.kind === "zoom";
    kbRef.current = true;

    switch (e.key) {
      case "ArrowDown":
        step(1);
        break;
      case "ArrowUp":
        step(-1);
        break;
      case "Tab":
        // 덩어리 사이 이동은 ↑↓와 Tab 둘 다다(사용자 지시 3).
        step(e.shiftKey ? -1 : 1);
        break;
      case "Home":
        goto(focusables[0] ?? -1);
        break;
      case "End":
        goto(focusables[focusables.length - 1] ?? -1);
        break;
      case "ArrowRight":
        if (inGroup) stepCell(focus, 1);
        else if (inZoom) pick(focus, 2);
        else if (item?.kind === "sub") setOpenSub(focus);
        else return;
        break;
      case "ArrowLeft":
        if (inGroup) stepCell(focus, -1);
        else if (inZoom) pick(focus, 0);
        else if (nested) onCloseSelf?.();
        else return;
        break;
      case "+":
      case "=":
        if (!inZoom) return;
        pick(focus, 2);
        break;
      case "-":
        if (!inZoom) return;
        pick(focus, 0);
        break;
      case "0":
        if (!inZoom) return;
        pick(focus, 1);
        break;
      case "Enter":
      case " ":
        if (inGroup) pick(focus, cell < 0 ? 0 : cell);
        else if (inZoom) pick(focus, 1);
        else if (focus >= 0) activate(focus);
        break;
      case "Escape":
        if (nested && onCloseSelf) onCloseSelf();
        else onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    // 부모 팝업이 같은 키를 또 처리하지 않게.
    e.stopPropagation();
  };

  // 하위 메뉴가 닫히면 초점이 부모로 돌아온다.
  const closeSub = useCallback(() => {
    setOpenSub(null);
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  // 열리면 팝업이 키를 받는다. 스크롤을 건드리지 않게 preventScroll.
  useLayoutEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * 구르는 칸(시안 G1의 글꼴 목록)에서 **보이지 않는 줄로 초점이 가면** 따라 구른다.
   * 키보드만으로 목록 끝까지 갈 수 있어야 한다.
   */
  useEffect(() => {
    if (focus < 0) return;
    const el = cardRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [focus]);

  /** 키보드로 초점이 간 줄은 **기다리지 않고** 말풍선을 보여 준다(시안 C2). */
  useEffect(() => {
    if (!kbRef.current) return;
    if (focus < 0) {
      hideTip();
      return;
    }
    scheduleTip(tipHint(focus, cell < 0 ? -1 : cell), true);
  }, [cell, focus, hideTip, scheduleTip, tipHint]);

  // 열릴 때 **고른 값**이 보이게 — 글꼴이 수백 개면 열자마자 지금 글꼴이 보여야 한다.
  useLayoutEffect(() => {
    const el = cardRef.current?.querySelector<HTMLElement>('.popup-scroll [data-selected="1"]');
    el?.scrollIntoView?.({ block: "center" });
  }, []);

  /** 마우스가 줄 위로 들어왔다 — 초점을 옮기고 말풍선을 **0.6초 뒤** 띄운다. */
  const hoverItem = (index: number, at: number) => {
    kbRef.current = false;
    scheduleTip(tipHint(index, at), false);
  };

  const renderZoom = (index: number) => {
    const focused = focus === index;
    return (
      <div
        className="popup-row popup-zoom"
        role="group"
        aria-label={t("menuZoom")}
        key={`zoom-${index}`}
        data-index={index}
        data-focus={focused ? "1" : "0"}
        onPointerEnter={() => {
          kbRef.current = false;
          setFocus(index);
          setCell(-1);
          setOpenSub(null);
          scheduleTip(null, false);
        }}
      >
        <span className="popup-zoom-label">{t("menuZoom")}</span>
        {ZOOM_CELLS.map((z, i) => (
          <button
            type="button"
            role="menuitem"
            key={z.id}
            className={i === 1 ? "popup-zoom-pct" : "popup-zoom-btn"}
            data-index={index}
            data-cell={i}
            aria-label={t(z.label)}
            aria-keyshortcuts={ariaKeys(z.key)}
            onPointerEnter={() => hoverItem(index, i)}
            onClick={() => pick(index, i)}
          >
            {i === 0 ? "−" : i === 1 ? `${clampZoom(state.zoom)}%` : "+"}
          </button>
        ))}
      </div>
    );
  };

  const renderSegment = (
    index: number,
    item: Extract<MenuItem, { kind: "segment" }>
  ) => (
    <div className="popup-group" key={`seg-${index}`} data-index={index}>
      <div className="popup-group-label">{t(item.label)}</div>
      <div className="popup-seg" role="group" aria-label={t(item.label)}>
        {item.options.map((opt, i) => {
          const on = itemMark(opt.act, state)?.on === true;
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={on}
              key={t(opt.label)}
              className="popup-seg-cell"
              data-cell={i}
              data-on={on ? "1" : "0"}
              data-focus={focus === index && cell === i ? "1" : "0"}
              aria-keyshortcuts={item.key ? ariaKeys(item.key) : undefined}
              onPointerEnter={() => hoverItem(index, i)}
              onClick={() => pick(index, i)}
            >
              {t(opt.label)}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderDots = (index: number, item: Extract<MenuItem, { kind: "dots" }>) => (
    <div className="popup-group" key={`dots-${index}`} data-index={index}>
      <div className="popup-group-label">{t(item.label)}</div>
      <div className="popup-dots" role="group" aria-label={t(item.label)}>
        {item.options.map((opt, i) => {
          const on = itemMark(opt.act, state)?.on === true;
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={on}
              aria-label={t(opt.label)}
              key={t(opt.label)}
              className="popup-dot"
              data-index={index}
              data-cell={i}
              data-none={opt.color === "" ? "1" : "0"}
              data-on={on ? "1" : "0"}
              data-focus={focus === index && cell === i ? "1" : "0"}
              style={opt.color === "" ? undefined : { background: opt.color }}
              onPointerEnter={() => hoverItem(index, i)}
              onClick={() => pick(index, i)}
            />
          );
        })}
      </div>
    </div>
  );

  const renderItem = (item: MenuItem, index: number) => {
    if (item.kind === "sep") return <div className="popup-sep" key={`sep-${index}`} />;
    if (item.kind === "heading") {
      return (
        <div className="popup-heading" key={`head-${index}`}>
          <span className="popup-heading-label">{t(item.label)}</span>
          {item.key && <span>{item.key}</span>}
        </div>
      );
    }
    if (item.kind === "tab") {
      return (
        <button
          className="popup-row popup-tab"
          type="button"
          role="menuitemradio"
          aria-checked={item.active}
          key={`tab-${item.id}`}
          data-index={index}
          data-focus={focus === index ? "1" : "0"}
          // 지금 탭에 `data-selected`를 두면 **열자마자 그 줄이 보이게** 구른다
          // (아래 `popup-scroll [data-selected="1"]` 효과 — 글꼴 목록과 같은 길).
          data-selected={item.active ? "1" : "0"}
          title={item.text}
          onPointerEnter={() => {
            kbRef.current = false;
            setFocus(index);
            setCell(-1);
            setOpenSub(null);
            scheduleTip(null, false);
          }}
          onClick={() => activate(index)}
        >
          <span className="tint-dot" data-empty={item.color === "" ? "1" : undefined} style={item.color === "" ? undefined : { background: item.color }} />
          <span className="popup-label">{item.text}</span>
          {item.dirty && <span className="dirty-dot" />}
          <span className="popup-check">{item.active ? "✓" : ""}</span>
        </button>
      );
    }
    if (item.kind === "zoom") return renderZoom(index);
    if (item.kind === "segment") return renderSegment(index, item);
    if (item.kind === "dots") return renderDots(index, item);
    if (item.kind === "sub") {
      return (
        <button
          className="popup-row"
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSub === index}
          key={`sub-${index}`}
          data-index={index}
          data-focus={focus === index ? "1" : "0"}
          onPointerEnter={() => {
            kbRef.current = false;
            setFocus(index);
            setCell(-1);
            setOpenSub(index);
          }}
          onClick={() => activate(index)}
        >
          <span className="popup-label">{t(item.label)}</span>
          <span className="popup-caret">▸</span>
        </button>
      );
    }

    const enabled = itemEnabled(item.act, state);
    const mark = itemMark(item.act, state);
    // 글자가 그때그때 다른 행(글꼴 이름·크기 숫자)은 `text`를 그대로 쓴다 — 문자열 표에
    // 넣을 수 없는 값이다(시안 G1). 간략 메뉴는 짧은 라벨이 있으면 그쪽을 쓴다.
    const label = compact ? item.short ?? item.label : item.label;
    const text = item.text ?? (label === undefined ? "" : t(label));
    return (
      <button
        className="popup-row"
        type="button"
        role="menuitem"
        key={`row-${index}`}
        data-index={index}
        disabled={!enabled}
        data-focus={focus === index ? "1" : "0"}
        data-selected={mark && mark.kind !== "check" && mark.on ? "1" : "0"}
        aria-keyshortcuts={item.key ? ariaKeys(item.key) : undefined}
        onPointerEnter={() => {
          if (!enabled) return;
          setFocus(index);
          setCell(-1);
          setOpenSub(null);
          hoverItem(index, -1);
        }}
        onClick={() => activate(index)}
      >
        {mark && mark.kind === "radio" && (
          <span
            className="popup-radio"
            data-on={mark.on ? "1" : "0"}
            // 시안 G1의 글꼴 목록에는 이름마다 빈 동그라미가 없다 — **자리만** 비워
            // 라벨 줄을 맞추고(왼쪽 29px), 고른 글꼴 하나만 동그라미가 보인다.
            data-blank={item.text === undefined ? "0" : "1"}
          />
        )}
        {mark && mark.kind === "swatch" && (
          <span
            className="popup-swatch"
            data-none={mark.color === "" ? "1" : "0"}
            style={mark.color === "" ? undefined : { background: mark.color }}
          />
        )}
        {mark && mark.kind === "check" && <span className="popup-check">{mark.on ? "✓" : ""}</span>}
        {/* 글꼴 이름은 **자기 글꼴로** 그린다(시안 G1). */}
        <span className="popup-label" style={item.font ? { fontFamily: item.font } : undefined}>
          {text}
        </span>
        {/* 간략 메뉴는 단축키를 줄에 그리지 않는다 — 말풍선과 aria-keyshortcuts로 알린다. */}
        {!compact && item.key && <span className="popup-key">{item.key}</span>}
      </button>
    );
  };

  // `scrollFrom`부터는 따로 구르는 칸이다(시안 G1: `기본`과 구분선은 제자리).
  const scrollFrom = menu.scrollFrom ?? menu.items.length;
  const subItem = openSub === null ? undefined : menu.items[openSub];
  const sub = subItem?.kind === "sub" ? subItem.menu : null;

  const card = (
    <div
      className="popup"
      role="menu"
      aria-label={t(menu.title)}
      tabIndex={-1}
      ref={cardRef}
      data-hit
      data-compact={compact ? "1" : "0"}
      style={{ left: position.left, top: position.top, width: menu.width, padding: pad }}
      onKeyDown={onKeyDown}
      // 팝업 안에서 눌린 것은 바깥 클릭이 아니다.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      // 메뉴를 떠나면 말풍선이 사라지고 **다시 식는다**(시안 C2).
      onPointerLeave={() => {
        warmRef.current = false;
        hideTip();
      }}
    >
      {menu.items.slice(0, scrollFrom).map((item, i) => renderItem(item, i))}
      {scrollFrom < menu.items.length && (
        <div className="popup-scroll" style={{ maxHeight: menu.scrollH }}>
          {menu.items.slice(scrollFrom).map((item, i) => renderItem(item, scrollFrom + i))}
        </div>
      )}

      {tip && (
        <div
          className="popup-tip"
          ref={tipRef}
          role="presentation"
          style={{
            left: tipPos?.left ?? 0,
            top: tipPos?.top ?? 0,
            visibility: tipPos ? "visible" : "hidden",
          }}
        >
          {tip.text}
        </div>
      )}

      {openSub !== null && sub && (
        <Popup
          menu={sub}
          state={state}
          position={placeMenu(
            sub,
            {
              left: position.left,
              right: position.left + menu.width,
              top: position.top + itemOffset(menu, openSub),
              bottom: position.top + itemOffset(menu, openSub) + (compact ? ROW_C : ROW_H),
            },
            "rightOf"
          )}
          onAction={onAction}
          onClose={onClose}
          onCloseSelf={closeSub}
          nested
        />
      )}
    </div>
  );

  if (nested) return card;

  return (
    <div
      className="popup-scrim"
      // 오버레이 모드에서도 `바깥을 눌러 닫기`가 되려면 메뉴가 열려 있는 동안은 창
      // 전체가 클릭을 잡아야 한다 — 안 그러면 바깥 클릭이 뒤 창으로 통과해 버리고
      // 메뉴는 열린 채로 남는다.
      data-hit
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {card}
    </div>
  );
}

/** 버튼 요소에 대고 메뉴를 열 좌표를 만든다. */
export function anchorOf(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** 마우스 좌표 하나를 앵커로 (우클릭 메뉴). */
export function anchorAt(x: number, y: number): Anchor {
  return { left: x, top: y, right: x, bottom: y };
}

/**
 * **편집 영역의 커서 자리** — 알림 예약 창이 여기에 대고 뜬다(지시 1).
 *
 * 엔진을 묻지 않는다: ProseMirror든 CodeMirror든 글은 contenteditable 안의 진짜
 * DOM이고 `Selection`이 그 자리를 안다. 선택이 여러 줄일 때 **마지막 사각형**을 쓰는
 * 것은 그쪽이 커서(선택 끝)이기 때문이다. 접힌 커서는 사각형이 폭 0이라 그대로 쓴다.
 *
 * 선택을 못 읽으면 편집 영역의 왼쪽 위로 떨어진다 — 카드가 화면 밖에 뜨는 것보다 낫다.
 */
export function caretAnchor(editor: HTMLElement | null): Anchor {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const r = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
  }
  if (editor) {
    const r = editor.getBoundingClientRect();
    return { left: r.left + 32, top: r.top + 18, right: r.left + 32, bottom: r.top + 18 };
  }
  return { left: SCREEN_MARGIN, top: 36, right: SCREEN_MARGIN, bottom: 36 };
}
