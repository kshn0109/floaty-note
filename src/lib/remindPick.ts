/**
 * 알림 예약 창의 **휠 다섯 칸 계산** — 년/월/일/시/분(단계 10).
 *
 * 그리는 쪽(`components/RemindPick.tsx`)에는 날짜 산술이 하나도 없다. 원본
 * (`InkwellRemindPick` · `RpDaysInMonth`, `NEXT_SESSION.md` 「끝난 일 ⑦」)이 지키던
 * 규칙이 전부 여기 순수 함수로 있고 `scripts/reminders.test.ts`가 지킨다:
 *
 *   * 위로 끌기 · ↑는 값을 **키운다**. 화면에는 위에 앞 값, 아래에 뒤 값이 놓인다
 *     (승인 시안: 2025 / **2026** / 2027). **마우스 휠만은 아래로 = 나중**이다
 *     (사용자 결정 2026-11-09 — 원본의 "휠 위로 = 나중"이 반대로 느껴진다는 보고.
 *     Windows 11 시간 선택기도 아래로 굴리면 다음 값).
 *   * 월 길이·윤년을 반영하고, **월·년을 바꾸면 일을 잘라서 맞춘다**(1/31 → 2월은 28·29).
 *   * **년은 올해~+5년에서 멈춘다**(감싸지 않는다). 월·일·시·분은 감싼다.
 *   * 기본값 = **다음 정각**.
 *
 * 왜 `Date`에 한 시간을 더해서 다음 정각을 구하는가: 원본 주석 그대로 "OS에 한 시간을
 * 더하게 해서 자정·월말·DST를 직접 계산하지 않는다". 우리 쪽 `Date`도 지역 시각으로
 * 같은 일을 한다.
 */

import { momentText } from "./reminders";
import { t, tf } from "./i18n";
import type { StrId } from "./i18n";

/** 칸 다섯 개 — 왼쪽에서 오른쪽 순서다(←→·Tab이 이 순서로 움직인다). */
export const PICK_FIELDS = ["year", "month", "day", "hour", "minute"] as const;
export type PickField = (typeof PICK_FIELDS)[number];

/** 칸 머리말(11px dim) — 시안의 `년 월 일 시 분`. */
export const FIELD_LABEL: Record<PickField, StrId> = {
  year: "remindYear",
  month: "remindMonth",
  day: "remindDay",
  hour: "remindHour",
  minute: "remindMinute",
};

/** 년 휠이 올라갈 수 있는 끝 — 올해 + 5년(원본과 같다). */
export const YEAR_SPAN = 5;

/** 지역 시각의 년/월/일/시/분. 월은 **1~12**다(`Date`의 0~11이 아니다). */
export interface Moment {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** 그 달의 날 수 — 원본 `RpDaysInMonth`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_DAYS[month - 1] ?? 30;
}

/** 월·년이 바뀐 뒤 **일을 잘라서** 맞춘다(1/31 → 2월은 28·29). */
export function clampDay(m: Moment): Moment {
  const max = daysInMonth(m.year, m.month);
  return m.day <= max ? m : { ...m, day: max };
}

/** `0 <= n < len`으로 감싼다(음수도). */
function wrap(n: number, len: number): number {
  return ((n % len) + len) % len;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** 년 휠의 멈추는 두 끝 — `now`의 해부터 +5년. */
export function yearRange(now: number): { min: number; max: number } {
  const min = new Date(now).getFullYear();
  return { min, max: min + YEAR_SPAN };
}

/** 기본값 = **다음 정각**. 시각 하나에 한 시간을 더하고 분·초를 0으로 내린다. */
export function nextHour(now: number): Moment {
  const d = new Date(now + 3_600_000);
  d.setMinutes(0, 0, 0);
  return fromDate(d);
}

export function fromDate(d: Date): Moment {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/** 지역 시각 → epoch 밀리초. 초·밀리초는 0이다(분까지만 고르므로). */
export function toMs(m: Moment): number {
  return new Date(m.year, m.month - 1, m.day, m.hour, m.minute, 0, 0).getTime();
}

/**
 * 이미 지난 시각인가 — 같은 분이라도 **지금보다 앞이면** 지난 것이다.
 * 참이면 시안의 경고 줄이 뜨고 `예약` 버튼이 꺼진다.
 */
export function isPast(m: Moment, now: number): boolean {
  return toMs(m) <= now;
}

export function fieldValue(m: Moment, field: PickField): number {
  return m[field];
}

/**
 * 그리는 쪽이 `지금`을 다시 읽는 주기 — **1초**.
 *
 * 예전에는 10초였고 그것이 버그였다(점검 2026-11-08): `예약` 버튼이 꺼지는 근거는
 * 그려 둔 `now`로 잰 `isPast`인데, 누르는 순간의 판정은 `Date.now()`였다. 그래서 고른
 * 분이 막 지난 뒤 최대 10초 동안 **버튼은 켜져 보이는데 눌러도 아무 일도 일어나지
 * 않았다** — 사용자에게는 "알림 기능이 안 된다"로 보인다. 1초면 `예약` 버튼의 모습과
 * 실제 판정이 어긋나는 창이 1초로 줄고, 아래 `confirmPick`이 그 1초도 메운다.
 */
export const PICK_NOW_TICK_MS = 1000;

/**
 * `예약`을 누른 **그 순간**의 판정. 지난 시각이면 거절하면서 그때의 `now`를 돌려준다 —
 * 그리는 쪽은 그 값을 화면의 `now`로 올려 **경고 줄을 띄우고 버튼을 끈다**. 조용히
 * 아무것도 하지 않는 길을 남기지 않는 것이 요점이다.
 */
export type ConfirmPick = { ok: true; due: number } | { ok: false; now: number };

export function confirmPick(m: Moment, now: number): ConfirmPick {
  return isPast(m, now) ? { ok: false, now } : { ok: true, due: toMs(m) };
}

/** 칸에 보이는 글자 — 년은 네 자리, 나머지는 **0 채운 두 자리**(원본과 같다). */
export function fieldText(field: PickField, value: number): string {
  return field === "year" ? String(value) : String(value).padStart(2, "0");
}

/**
 * 한 칸을 `delta`만큼 움직인 새 시각. **아무것도 바뀌지 않으면 같은 값이 돌아온다**
 * (년이 두 끝에 닿았을 때) — 부르는 쪽은 그걸로 앞뒤 값을 숨길지 정한다.
 */
export function step(m: Moment, field: PickField, delta: number, now: number): Moment {
  if (delta === 0) return m;
  switch (field) {
    case "year": {
      const { min, max } = yearRange(now);
      return clampDay({ ...m, year: clamp(m.year + delta, min, max) });
    }
    case "month":
      return clampDay({ ...m, month: wrap(m.month - 1 + delta, 12) + 1 });
    case "day":
      return { ...m, day: wrap(m.day - 1 + delta, daysInMonth(m.year, m.month)) + 1 };
    case "hour":
      return { ...m, hour: wrap(m.hour + delta, 24) };
    default:
      return { ...m, minute: wrap(m.minute + delta, 60) };
  }
}

/* ---------------------------------------------------------------------------
   숫자 키보드 입력 (사용자 피드백 4)

   초점이 있는 칸에 숫자를 치면 그 칸 값이 바뀐다. 칸을 다 채우면(년 4자리, 나머지
   2자리) 바로 확정되고 다음 칸으로 넘어간다 — Windows의 시:분 입력과 같은 느낌이다.
   한 자리만 치고 멈추면 그리는 쪽이 짧은 시간 뒤 `commitDigits`를 불러 확정한다
   (시 칸에 `9` → `09`).

   **범위 밖은 자른다**(무시하지 않는다): 월 13 → 12, 일 32 → 그 달의 마지막 날,
   시 25 → 23, 분 70 → 59, 월·일 0 → 1, 년은 올해~+5년. 휠이 두 끝에서 멈추는 것과
   같은 값이라 "휠로 갈 수 있는 곳"과 "쳐서 갈 수 있는 곳"이 같다. 월·년을 쳐서 바꾸면
   `clampDay`가 일을 잘라 맞춘다(1/31 → 2월은 28·29) — 휠과 같은 규칙이다.
   --------------------------------------------------------------------------- */

/** 칸을 다 채우는 자릿수 — 년 4, 나머지 2(화면 글자와 같다). */
export const FIELD_DIGITS: Record<PickField, number> = {
  year: 4,
  month: 2,
  day: 2,
  hour: 2,
  minute: 2,
};

/** 칸이 가질 수 있는 값의 두 끝. 일은 그 달의 길이, 년은 올해~+5년. */
export function fieldRange(
  m: Moment,
  field: PickField,
  now: number
): { min: number; max: number } {
  switch (field) {
    case "year":
      return yearRange(now);
    case "month":
      return { min: 1, max: 12 };
    case "day":
      return { min: 1, max: daysInMonth(m.year, m.month) };
    case "hour":
      return { min: 0, max: 23 };
    default:
      return { min: 0, max: 59 };
  }
}

/** 칸에 값을 **직접** 넣는다(숫자 입력의 유일한 입구). 범위 밖은 잘라서 받는다. */
export function setField(m: Moment, field: PickField, value: number, now: number): Moment {
  const { min, max } = fieldRange(m, field, now);
  const v = clamp(Math.trunc(value), min, max);
  switch (field) {
    case "year":
      return clampDay({ ...m, year: v });
    case "month":
      return clampDay({ ...m, month: v });
    case "day":
      return { ...m, day: v };
    case "hour":
      return { ...m, hour: v };
    default:
      return { ...m, minute: v };
  }
}

/** 숫자가 눌렸는가 — 숫자 패드와 윗줄 숫자가 같은 `key`를 준다. */
export function isDigitKey(key: string): boolean {
  return key.length === 1 && key >= "0" && key <= "9";
}

/**
 * 치는 중인 숫자에 한 글자 더하기. 칸을 이미 다 채운 뒤에 또 치면 **새로 시작한다**
 * (마지막 칸 = 분에서만 일어난다 — 다른 칸은 다 채우는 순간 다음 칸으로 넘어간다).
 */
export function typeDigit(buffer: string, key: string, field: PickField): string {
  if (!isDigitKey(key)) return buffer;
  return buffer.length >= FIELD_DIGITS[field] ? key : buffer + key;
}

/** Backspace — 치는 중인 마지막 숫자를 지운다(값은 아직 건드리지 않았다). */
export function eraseDigit(buffer: string): string {
  return buffer.slice(0, -1);
}

/** 치는 중인 숫자를 칸에 **확정**한다. 빈 버퍼면 아무 일도 없다. */
export function commitDigits(
  m: Moment,
  field: PickField,
  buffer: string,
  now: number
): Moment {
  if (buffer === "") return m;
  const value = Number.parseInt(buffer, 10);
  if (!Number.isFinite(value)) return m;
  return setField(m, field, value, now);
}

/** 칸을 다 채웠는가 — 그러면 그리는 쪽이 확정하고 다음 칸으로 넘어간다. */
export function digitsFull(buffer: string, field: PickField): boolean {
  return buffer.length >= FIELD_DIGITS[field];
}

/** 이 칸 **다음** 칸(마지막 칸이면 `null`). 자동으로 넘어갈 자리다. */
export function nextField(field: PickField): PickField | null {
  const at = PICK_FIELDS.indexOf(field);
  return at >= 0 && at < PICK_FIELDS.length - 1 ? PICK_FIELDS[at + 1] : null;
}

/**
 * 가운데 값 위·아래에 흐리게 놓이는 **앞뒤 값**. 년이 끝에 닿으면 그쪽은 `null`이고
 * 시안의 그 자리는 빈칸이 된다 — 같은 숫자를 또 적으면 멈춘 것이 거짓말이 된다.
 */
export function neighbors(
  m: Moment,
  field: PickField,
  now: number
): { prev: number | null; next: number | null } {
  const down = step(m, field, -1, now);
  const up = step(m, field, 1, now);
  return {
    prev: down[field] === m[field] ? null : down[field],
    next: up[field] === m[field] ? null : up[field],
  };
}

/**
 * 버튼 위 한 줄의 꼬리 — `내일`·`오늘`·`3일 후`.
 *
 * **원본에 없던 문구**다(원본은 `2026-11-06 01:00`만 찍었다). 승인된 시안이
 * `YYYY-MM-DD HH:MM · 상대 표현`을 요구하므로 i18n 표에 세 행을 더했다. 기준은
 * **달력 날짜 차이**(시각 차이가 아니다): 23:50에 다음 정각을 고르면 0:00이고,
 * 그건 "10분 뒤"가 아니라 사용자가 보기에 **내일**이다.
 */
export function relativeText(ms: number, now: number): string {
  const days = dayDiff(now, ms);
  if (days <= 0) return t("remindRelToday");
  if (days === 1) return t("remindRelTomorrow");
  return tf("remindRelDaysFmt", days);
}

/** 두 시각 사이의 **달력 날짜** 차이(지역 자정 기준). */
export function dayDiff(from: number, to: number): number {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  // 하루를 밀리초로 나눈다 — DST가 섞인 구간에서 23·25시간짜리 날이 나오므로
  // 반올림으로 하루 단위에 맞춘다(시간 차이가 아니라 날짜 차이를 세는 것이다).
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** 버튼 위 한 줄 전체 — `2026-11-08 15:00 · 내일`(시안 문구 그대로). */
export function pickLine(m: Moment, now: number): string {
  const ms = toMs(m);
  return `${momentText(ms)} · ${relativeText(ms, now)}`;
}
