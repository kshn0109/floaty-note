import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { t, tf } from "../lib/i18n";
import { TINT_DOTS } from "../lib/palette";
import { listMomentText, reminderDocName, sortByDue, type Reminder } from "../lib/reminders";
import { placeBox, SCREEN_MARGIN, type Anchor, type Placement } from "./Popup";

/**
 * 예약 목록 — 승인된 시안 `Reminder.dc.html`의 오른쪽 열.
 *
 * 수치는 시안 그대로: 카드 360 · 패딩 5 · r12 · bar · 1px hairline, 머리 22(11px dim)에
 * `예약된 알림 N`, 줄 44 · r8 · 패딩 0 6 0 10 · 간격 10 — 탭 색 점 8 + 내용(12px 한 줄,
 * 넘치면 …) + `MM/DD HH:MM · 문서 이름`(11px dim) + **가리킨 줄에만** ✕ 24 r10 field 채움.
 * 색 없는 탭의 점은 1px dim 테두리만 있는 빈 동그라미다(시안 셋째 줄).
 *
 * 동작은 시안 글 그대로: **줄 클릭 = 그 문서·범위로 이동**(토스트를 누른 것과 같은 길),
 * ✕나 Del로 취소, **마지막 하나가 사라지면 닫힘**(그 판정은 `App`이 — 목록은 예약이
 * 하나라도 있을 때만 그려진다), 시각 순.
 */

const CARD_W = 360;
const PAD = 5;
const BORDER = 1;
const HEAD_H = 22;
const ROW_H = 44;

/** 줄 수에 따른 카드 높이. 화면을 넘길 만큼 많으면 줄 영역이 스크롤한다. */
function listHeight(count: number): number {
  const full = 2 * (PAD + BORDER) + HEAD_H + ROW_H * count;
  const room = window.innerHeight - 2 * SCREEN_MARGIN;
  return Math.min(full, Math.max(room, 2 * (PAD + BORDER) + HEAD_H + ROW_H));
}

interface Props {
  anchor: Anchor;
  placement: Placement;
  items: readonly Reminder[];
  /** 줄 클릭 — 토스트 클릭과 **같은** 되살리기 경로로 보낸다. */
  onOpen: (r: Reminder) => void;
  onCancel: (r: Reminder) => void;
  onClose: () => void;
}

export default function RemindList({ anchor, placement, items, onOpen, onCancel, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(-1);

  useLayoutEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  const rows = useMemo(() => sortByDue(items), [items]);
  const height = listHeight(rows.length);
  const position = placeBox(anchor, CARD_W, height, placement);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // 줄이 하나도 없는 목록은 `App`이 그리지 않지만(마지막 하나가 사라지면 닫힌다),
    // 나눗셈이 NaN이 되는 길을 열어 두지는 않는다.
    if (rows.length === 0) {
      if (e.key === "Escape") onClose();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        setFocus((at) => (at + 1) % rows.length);
        break;
      case "ArrowUp":
        setFocus((at) => (at <= 0 ? rows.length - 1 : at - 1));
        break;
      case "Home":
        setFocus(0);
        break;
      case "End":
        setFocus(rows.length - 1);
        break;
      case "Enter":
      case " ":
        if (focus >= 0 && rows[focus]) onOpen(rows[focus]);
        break;
      case "Delete":
        if (focus >= 0 && rows[focus]) onCancel(rows[focus]);
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
        className="popup remind-list"
        role="dialog"
        aria-label={t("remindListTitle")}
        tabIndex={-1}
        ref={cardRef}
        data-hit
        style={{ left: position.left, top: position.top, width: CARD_W, height }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="remind-list-head">{tf("remindListCountFmt", rows.length)}</div>
        <div className="remind-list-rows">
          {rows.map((r, index) => (
            <div
              className="remind-row"
              role="button"
              tabIndex={-1}
              key={r.id}
              data-focus={focus === index ? "1" : "0"}
              onPointerEnter={() => setFocus(index)}
              onClick={() => onOpen(r)}
            >
              <span
                className="remind-dot"
                data-none={r.tint === "none" ? "1" : "0"}
                style={r.tint === "none" ? undefined : { background: TINT_DOTS[r.tint] }}
              />
              <div className="remind-row-body">
                <div className="remind-row-text">{r.text}</div>
                <div className="remind-row-meta">
                  {`${listMomentText(r.due)} · ${reminderDocName(r.docPath)}`}
                </div>
              </div>
              <button
                className="remind-x"
                type="button"
                tabIndex={-1}
                aria-label={t("dlgBtnCancel")}
                onClick={(e) => {
                  // ✕는 그 줄을 **취소**한다 — 줄 클릭(이동)으로 번지면 안 된다.
                  e.stopPropagation();
                  onCancel(r);
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
