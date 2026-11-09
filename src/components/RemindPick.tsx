import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { t } from "../lib/i18n";
import {
  FIELD_LABEL,
  PICK_FIELDS,
  PICK_NOW_TICK_MS,
  commitDigits,
  confirmPick,
  digitsFull,
  eraseDigit,
  fieldText,
  isDigitKey,
  isPast,
  neighbors,
  nextField,
  nextHour,
  pickLine,
  step,
  typeDigit,
  type Moment,
  type PickField,
} from "../lib/remindPick";
import { SCREEN_MARGIN, placeFlip, type Anchor } from "./Popup";

/**
 * 알림 예약 창 — 승인된 시안 `Reminder.dc.html`의 왼쪽 두 열(예약 창 · 지난 시각).
 *
 * 수치는 시안 그대로: 카드 340 · 패딩 12 · r12 · bar 배경 · 1px hairline,
 * 위 미리보기 field r8(패딩 9 11 · 13px), 휠 5칸(머리말 11px dim 18 · 앞뒤 값 13px dim 26 ·
 * 선택 값 18px 600 높이 34 · **초점 칸만** hover 채움 r10), 아래 줄
 * `YYYY-MM-DD HH:MM · 상대 표현` 12px dim + `예약`(accent) + `취소`, 사이 간격 10/6.
 * 지난 시각이면 아래 줄이 warn 문구가 되고 `예약`이 꺼진다.
 *
 * **날짜 산술은 여기 없다** — 전부 `lib/remindPick.ts`이고 단위 시험이 지킨다.
 * 이 파일이 하는 일은 그리기와 네 가지 조작(휠 · 위아래 끌기 · 흐린 값 클릭 · ↑↓)을
 * 같은 `step()` 한 군데로 모으는 것뿐이다(원본 `InkwellRemindPick`과 같은 구조).
 */

/** 시안 수치 — 카드와 칸들. */
const CARD_W = 340;
const PAD = 12;
const BORDER = 1;
const PREVIEW_H = 38;
const WHEEL_H = 104; // 머리말 18 + 앞 26 + 선택 34 + 뒤 26
const FOOT_H = 30;
const GAP = 10;
/** 카드 높이는 고정이다 — 자리 계산에 측정이 없다(팝업 가족과 같은 규칙). */
export const CARD_H = 2 * (PAD + BORDER) + PREVIEW_H + GAP + WHEEL_H + GAP + FOOT_H;

/** 칸 폭(바깥 / 선택 값 네모) + 그 칸 **뒤에** 오는 구분 글자. 시안 그대로. */
const COLUMNS: Record<PickField, { w: number; box: number; after: string; gap: number }> = {
  year: { w: 64, box: 56, after: "-", gap: 14 },
  month: { w: 46, box: 40, after: "-", gap: 14 },
  day: { w: 46, box: 40, after: "", gap: 18 },
  hour: { w: 46, box: 40, after: ":", gap: 14 },
  minute: { w: 46, box: 40, after: "", gap: 0 },
};

/** 끌기 — **20px이 한 칸**(원본 `20dip`과 같은 값). */
const DRAG_STEP = 20;

/**
 * 한 자리만 치고 멈췄을 때 **확정까지 기다리는 시간**(사용자 피드백 4: "약 1초").
 * 다음 숫자를 치면 다시 처음부터 센다.
 */
const TYPE_COMMIT_MS = 1000;

interface Props {
  anchor: Anchor;
  /** 미리보기 = 선택한 글(이미 한 줄로 누른 것). */
  text: string;
  onSet: (dueMs: number) => void;
  onClose: () => void;
}

export default function RemindPick({ anchor, text, onSet, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // `지금`은 그려 둔 값이 아니다: 창을 열어 둔 채 시간이 흐르면 고른 시각이 지난 것이
  // 되므로(그리고 년 휠의 아래 끝이 올해다) **1초마다** 다시 읽는다(`PICK_NOW_TICK_MS`).
  // 원본은 매 그림마다 읽었고 그쪽이 맞다 — 10초였을 때 `예약` 버튼이 켜져 보이는데
  // 눌러도 아무 일이 없는 구멍이 있었다.
  const [now, setNow] = useState(() => Date.now());
  const [moment, setMoment] = useState<Moment>(() => nextHour(Date.now()));
  const [focus, setFocus] = useState<PickField>("year");
  /**
   * **치는 중인 숫자**(사용자 피드백 4). 화면에는 바로 반영되고(`view`), 칸을 다 채우거나
   * 1초가 지나면 비워진다 — 비워진 뒤부터는 `09`처럼 0을 채운 글자가 보인다.
   * 날짜 산술과 범위 자르기는 전부 `lib/remindPick.ts`에 있다.
   */
  const [digits, setDigits] = useState("");

  useLayoutEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), PICK_NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  /** 치는 중인 숫자를 값에 확정하고 버퍼를 비운다 — 다른 조작으로 넘어갈 때 먼저 한다. */
  const flush = useCallback(() => {
    if (digits === "") return;
    setMoment((m) => commitDigits(m, focus, digits, Date.now()));
    setDigits("");
  }, [digits, focus]);

  const bump = useCallback(
    (field: PickField, delta: number) => {
      flush();
      setFocus(field);
      setMoment((m) => step(m, field, delta, Date.now()));
    },
    [flush]
  );

  // 한 자리만 치고 멈추면 짧은 시간 뒤 확정된다(시 칸에 `9` → `09`). 다음 숫자를 치면
  // `digits`가 바뀌므로 이 효과가 다시 걸리며 시간을 처음부터 센다.
  useEffect(() => {
    if (digits === "") return undefined;
    const timer = window.setTimeout(() => {
      setMoment((m) => commitDigits(m, focus, digits, Date.now()));
      setDigits("");
    }, TYPE_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [digits, focus]);

  /**
   * 끌기 상태. 한 번 누르고 있는 동안 **기준 시각 하나**에서 걸음 수를 다시 계산한다 —
   * 걸음마다 더하면 손을 되돌렸을 때 처음 값으로 돌아오지 않는다.
   */
  const drag = useRef<{ field: PickField; startY: number; base: Moment; steps: number } | null>(
    null
  );
  /** 끌기로 값이 바뀐 뒤에 따라오는 click은 흐린 값 클릭이 아니다 — 한 번 삼킨다. */
  const dragged = useRef(false);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // 위로 끌면 **나중**이다(원본 `위 = 나중`): 화면 좌표는 아래로 커지므로 뒤집는다.
      const steps = Math.trunc((d.startY - e.clientY) / DRAG_STEP);
      if (steps === d.steps) return;
      d.steps = steps;
      dragged.current = steps !== 0;
      setMoment(step(d.base, d.field, steps, Date.now()));
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  /**
   * 화면이 보는 시각 = 값 + 치는 중인 숫자. 휠·끌기·화살표와 숫자 입력이 **같은 값**을
   * 보게 하는 자리다(버퍼가 비어 있으면 `moment`와 같다).
   */
  const view = commitDigits(moment, focus, digits, now);

  const past = isPast(view, now);
  /**
   * `예약`·Enter. 누르는 **그 순간**으로 다시 판정하고, 지난 시각이면 조용히 끝내지
   * 않는다 — 화면의 `now`를 그 순간으로 올려 경고 줄을 띄우고 버튼을 끈다(그러지
   * 않으면 "버튼이 켜져 있는데 눌러도 아무 일이 없다"가 된다).
   */
  const confirm = () => {
    const m = commitDigits(moment, focus, digits, Date.now());
    const verdict = confirmPick(m, Date.now());
    if (!verdict.ok) {
      setNow(verdict.now);
      return;
    }
    onSet(verdict.due);
  };

  /** 칸을 옮기기 전에 치던 숫자를 확정한다(칸마다 버퍼가 섞이지 않게). */
  const moveFocus = (field: PickField): void => {
    flush();
    setFocus(field);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const at = PICK_FIELDS.indexOf(focus);

    // 숫자 — 숫자 패드와 윗줄 숫자 둘 다. 칸을 다 채우면 확정하고 다음 칸으로 넘어간다
    // (년 4자리, 나머지 2자리). 마지막 칸(분)에서는 그 자리에 남아 새로 치기 시작한다.
    // Ctrl·Alt가 섞인 것은 단축키다(Ctrl+1 등) — 숫자로 받지 않는다.
    if (isDigitKey(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const buffer = typeDigit(digits, e.key, focus);
      if (digitsFull(buffer, focus)) {
        setMoment((m) => commitDigits(m, focus, buffer, Date.now()));
        setDigits("");
        const after = nextField(focus);
        if (after) setFocus(after);
      } else {
        setDigits(buffer);
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Backspace — 치는 중인 숫자를 한 자리 지운다(확정된 값은 건드리지 않는다).
    if (e.key === "Backspace") {
      setDigits((buffer) => eraseDigit(buffer));
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    switch (e.key) {
      case "ArrowUp":
        bump(focus, 1);
        break;
      case "ArrowDown":
        bump(focus, -1);
        break;
      case "ArrowLeft":
        moveFocus(PICK_FIELDS[Math.max(at - 1, 0)]);
        break;
      case "ArrowRight":
        moveFocus(PICK_FIELDS[Math.min(at + 1, PICK_FIELDS.length - 1)]);
        break;
      case "Home":
        moveFocus(PICK_FIELDS[0]);
        break;
      case "End":
        moveFocus(PICK_FIELDS[PICK_FIELDS.length - 1]);
        break;
      case "Tab":
        // 칸 이동이다(원본과 같다) — 카드 밖으로 나가지 않는다.
        moveFocus(
          PICK_FIELDS[
            (at + (e.shiftKey ? -1 : 1) + PICK_FIELDS.length) % PICK_FIELDS.length
          ]
        );
        break;
      case "Enter":
        confirm();
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

  /**
   * 창이 카드보다 좁을 수 있다(최소 창 크기가 없다 — 사용자 피드백 2). 그때는 폭을
   * 창에 맞춰 깎고 휠 다섯 칸이 그 안에서 가로로 스크롤된다. 높이는 `.popup`의
   * `max-height`가 맡는다(`CARD_H`는 자리 계산에 쓰는 값이라 그대로 둔다).
   */
  const width = Math.min(CARD_W, Math.max(window.innerWidth - 2 * SCREEN_MARGIN, 160));
  const position = placeFlip(anchor, width, CARD_H);

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
        className="popup remind-pick"
        role="dialog"
        aria-label={t("remindTitle")}
        tabIndex={-1}
        ref={cardRef}
        data-hit
        style={{ left: position.left, top: position.top, width, height: CARD_H }}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="remind-preview">{text}</div>

        <div className="remind-wheels">
          {PICK_FIELDS.map((field) => {
            const col = COLUMNS[field];
            const { prev, next } = neighbors(view, field, now);
            const side = (value: number | null, delta: number) => (
              <button
                className="remind-side"
                type="button"
                tabIndex={-1}
                disabled={value === null}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  bump(field, delta);
                }}
              >
                {value === null ? "" : fieldText(field, value)}
              </button>
            );
            return (
              <Fragment key={field}>
                <div
                  className="remind-col"
                  style={{ width: col.w }}
                  onWheel={(e) => {
                    if (e.deltaY === 0) return;
                    // 휠을 아래로 = 나중(사용자 보고 2026-11-09: 위로 = 나중은 반대로
                    // 느껴진다). Windows 11 시간 선택기(LoopingSelector)도 아래로 굴리면
                    // 다음 값이다. ↑↓ 키와 끌기는 그대로.
                    bump(field, e.deltaY > 0 ? 1 : -1);
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    // 치던 숫자를 먼저 확정하고, 끌기의 기준도 그 값(`view`)으로 둔다.
                    moveFocus(field);
                    dragged.current = false;
                    drag.current = { field, startY: e.clientY, base: view, steps: 0 };
                  }}
                >
                  <div className="remind-head">{t(FIELD_LABEL[field])}</div>
                  {side(prev, -1)}
                  <div
                    className="remind-value"
                    style={{ width: col.box }}
                    data-focus={focus === field ? "1" : "0"}
                  >
                    {/* 치는 중인 칸은 **친 그대로** 보인다(`9`). 확정되면 `09`가 된다. */}
                    {focus === field && digits !== ""
                      ? digits
                      : fieldText(field, view[field])}
                  </div>
                  {side(next, 1)}
                </div>
                {/* 칸 사이의 `-` `:`와, 날짜와 시각 사이의 빈 18px(시안 그대로). */}
                {col.gap > 0 && (
                  <div className="remind-sepchar" style={{ width: col.gap }}>
                    {col.after}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        <div className="remind-foot">
          <div className="remind-line" data-warn={past ? "1" : "0"}>
            {past ? t("remindPast") : pickLine(view, now)}
          </div>
          <button className="remind-btn" type="button" data-accent="1" disabled={past} onClick={confirm}>
            {t("remindBtnSet")}
          </button>
          <button className="remind-btn" type="button" onClick={onClose}>
            {t("dlgBtnCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
