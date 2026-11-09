/**
 * 예약 창의 **휠 다섯 칸** 계산 (단계 10 · `src/lib/remindPick.ts`).
 *
 * 그리는 쪽(`components/RemindPick.tsx`)에는 날짜 산술이 하나도 없으므로, 원본
 * (`InkwellRemindPick`, `NEXT_SESSION.md` 「끝난 일 ⑦」)이 지키던 규칙은 전부 여기서
 * 지킨다: 월 길이·윤년, 월·년 변경 시 일 자르기, 년의 멈춤과 나머지의 감쌈,
 * 기본값 = 다음 정각, 지난 시각 판정, 그리고 시안이 더한 상대 표현.
 *
 * `now`를 **인자로** 받는 함수들이라 시계를 가짜로 만들 필요가 없다 — 시험이 특정
 * 시각에만 통과하거나 자정에 깨지지 않는다. 실제 알림을 예약하지도, 어떤 파일을
 * 건드리지도 않는다(순수 함수뿐이다).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { setLangMode, setSystemLang } from "../src/lib/i18n";
import {
  FIELD_DIGITS,
  PICK_NOW_TICK_MS,
  commitDigits,
  confirmPick,
  dayDiff,
  daysInMonth,
  digitsFull,
  eraseDigit,
  fieldRange,
  fieldText,
  isDigitKey,
  isLeapYear,
  isPast,
  neighbors,
  nextField,
  nextHour,
  setField,
  typeDigit,
  type Moment,
  PICK_FIELDS,
  pickLine,
  relativeText,
  step,
  toMs,
  yearRange,
} from "../src/lib/remindPick";
import {
  listMomentText,
  momentText,
  reminderDocName,
  sortByDue,
  type Reminder,
} from "../src/lib/reminders";

beforeEach(() => {
  setSystemLang("ko");
  setLangMode("ko");
});

/** 지역 시각 하나 (월은 1~12). */
function at(y: number, mo: number, d: number, h: number, mi: number, s = 0, ms = 0): number {
  return new Date(y, mo - 1, d, h, mi, s, ms).getTime();
}

describe("월 길이와 윤년 (원본 RpDaysInMonth)", () => {
  it("달마다 날 수가 맞다", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("2월은 윤년 규칙 그대로다 (4 · 100 · 400)", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});

describe("월·년을 바꾸면 일을 잘라 맞춘다 (원본: 1/31 → 2월은 28·29)", () => {
  const now = at(2026, 1, 1, 0, 0);

  it("1월 31일에서 2월로 가면 28일이 된다", () => {
    expect(step({ year: 2026, month: 1, day: 31, hour: 9, minute: 0 }, "month", 1, now)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
      hour: 9,
      minute: 0,
    });
  });

  it("윤년이면 29일까지 남는다", () => {
    const leap = at(2024, 1, 1, 0, 0);
    expect(
      step({ year: 2024, month: 1, day: 31, hour: 9, minute: 0 }, "month", 1, leap).day
    ).toBe(29);
  });

  it("2월 29일에서 년을 올리면 28일로 잘린다", () => {
    const leap = at(2024, 1, 1, 0, 0);
    expect(step({ year: 2024, month: 2, day: 29, hour: 9, minute: 0 }, "year", 1, leap)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
      hour: 9,
      minute: 0,
    });
  });

  it("자르기는 **줄이기만** 한다 — 짧은 달에서 긴 달로 가면 그대로다", () => {
    expect(step({ year: 2026, month: 2, day: 28, hour: 9, minute: 0 }, "month", 1, now).day).toBe(
      28
    );
  });
});

describe("년은 멈추고 나머지는 감싼다", () => {
  const now = at(2026, 6, 10, 12, 0);
  const base = { year: 2026, month: 6, day: 10, hour: 12, minute: 0 };

  it("년은 올해~+5년이고 두 끝에서 멈춘다(감싸지 않는다)", () => {
    expect(yearRange(now)).toEqual({ min: 2026, max: 2031 });
    expect(step(base, "year", -1, now).year).toBe(2026);
    expect(step({ ...base, year: 2031 }, "year", 1, now).year).toBe(2031);
    // 멈춘 끝을 넘겨 크게 밀어도 끝에 붙는다(끌기로 한 번에 여러 칸 움직일 때).
    expect(step(base, "year", 20, now).year).toBe(2031);
    expect(step(base, "year", -20, now).year).toBe(2026);
  });

  it("멈춘 쪽의 흐린 값은 비어 있다 — 같은 숫자를 또 적지 않는다", () => {
    expect(neighbors(base, "year", now)).toEqual({ prev: null, next: 2027 });
    expect(neighbors({ ...base, year: 2031 }, "year", now)).toEqual({ prev: 2030, next: null });
    expect(neighbors({ ...base, year: 2028 }, "year", now)).toEqual({ prev: 2027, next: 2029 });
  });

  it("감싸는 칸의 흐린 값은 양쪽에 다 있다", () => {
    expect(neighbors({ ...base, month: 12 }, "month", now)).toEqual({ prev: 11, next: 1 });
    expect(neighbors({ ...base, minute: 0 }, "minute", now)).toEqual({ prev: 59, next: 1 });
  });

  it("월·일·시·분은 감싼다", () => {
    const m = { year: 2026, month: 12, day: 31, hour: 23, minute: 59 };
    expect(step(m, "month", 1, now).month).toBe(1);
    expect(step(m, "day", 1, now).day).toBe(1);
    expect(step(m, "hour", 1, now).hour).toBe(0);
    expect(step(m, "minute", 1, now).minute).toBe(0);
    const z = { year: 2026, month: 1, day: 1, hour: 0, minute: 0 };
    expect(step(z, "month", -1, now).month).toBe(12);
    expect(step(z, "day", -1, now).day).toBe(31);
    expect(step(z, "hour", -1, now).hour).toBe(23);
    expect(step(z, "minute", -1, now).minute).toBe(59);
  });

  it("일의 감싸기는 **그 달의 길이**를 쓴다", () => {
    const feb = { year: 2026, month: 2, day: 28, hour: 0, minute: 0 };
    expect(step(feb, "day", 1, now).day).toBe(1);
    expect(step({ ...feb, year: 2024 }, "day", 1, now).day).toBe(29);
  });

  it("감싸기는 **그 칸만** 바꾼다 — 월이 넘어가며 년이 따라 오르지 않는다(원본과 같다)", () => {
    const m = { year: 2026, month: 12, day: 15, hour: 23, minute: 59 };
    expect(step(m, "month", 1, now)).toEqual({ ...m, month: 1 });
    expect(step(m, "minute", 1, now)).toEqual({ ...m, minute: 0 });
    expect(step(m, "hour", 1, now)).toEqual({ ...m, hour: 0 });
  });

  it("여러 칸을 한 번에 — 끌기가 20px마다 주는 걸음도 같은 길이다", () => {
    const m = { year: 2026, month: 6, day: 10, hour: 22, minute: 30 };
    expect(step(m, "hour", 3, now).hour).toBe(1);
    expect(step(m, "minute", -45, now).minute).toBe(45);
  });

  it("걸음이 0이면 같은 값을 그대로 돌려준다", () => {
    expect(step(base, "day", 0, now)).toBe(base);
  });
});

describe("기본값은 다음 정각", () => {
  it("분·초를 버리고 한 시간 뒤의 정각이다", () => {
    expect(nextHour(at(2026, 11, 8, 14, 37, 42, 500))).toEqual({
      year: 2026,
      month: 11,
      day: 8,
      hour: 15,
      minute: 0,
    });
  });

  it("자정을 넘으면 날짜가 따라간다 — OS에 더하게 하므로 월말·연말도 공짜다", () => {
    expect(nextHour(at(2026, 11, 8, 23, 10))).toEqual({
      year: 2026,
      month: 11,
      day: 9,
      hour: 0,
      minute: 0,
    });
    expect(nextHour(at(2026, 12, 31, 23, 59))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
    });
    // 윤년 2월 29일 → 3월 1일.
    expect(nextHour(at(2024, 2, 29, 23, 30))).toEqual({
      year: 2024,
      month: 3,
      day: 1,
      hour: 0,
      minute: 0,
    });
  });

  it("정각에 열어도 **다음** 정각이다(지금을 고르게 두지 않는다)", () => {
    expect(nextHour(at(2026, 11, 8, 14, 0)).hour).toBe(15);
  });

  it("기본값은 늘 지난 시각이 아니다 — 열자마자 예약 버튼이 꺼져 있지 않다", () => {
    const now = at(2026, 11, 8, 14, 37, 59, 999);
    expect(isPast(nextHour(now), now)).toBe(false);
  });
});

describe("지난 시각 판정", () => {
  const now = at(2026, 11, 8, 14, 37, 30);

  it("지금보다 앞이면 지난 것이고, 뒤면 아니다", () => {
    expect(isPast({ year: 2026, month: 11, day: 8, hour: 14, minute: 0 }, now)).toBe(true);
    // 지금과 같은 분이라도 분의 시작은 이미 지났다.
    expect(isPast({ year: 2026, month: 11, day: 8, hour: 14, minute: 37 }, now)).toBe(true);
    expect(isPast({ year: 2026, month: 11, day: 8, hour: 14, minute: 38 }, now)).toBe(false);
    expect(isPast({ year: 2025, month: 12, day: 31, hour: 23, minute: 59 }, now)).toBe(true);
    expect(isPast({ year: 2031, month: 1, day: 1, hour: 0, minute: 0 }, now)).toBe(false);
  });

  it("고른 시각은 분까지다 — 초·밀리초는 0이다", () => {
    const ms = toMs({ year: 2026, month: 11, day: 8, hour: 15, minute: 0 });
    expect(new Date(ms).getSeconds()).toBe(0);
    expect(new Date(ms).getMilliseconds()).toBe(0);
    expect(momentText(ms)).toBe("2026-11-08 15:00");
  });
});

describe("상대 표현 (시안: `YYYY-MM-DD HH:MM · 내일`)", () => {
  const now = at(2026, 11, 8, 14, 37);

  it("오늘·내일·N일 후", () => {
    expect(relativeText(at(2026, 11, 8, 15, 0), now)).toBe("오늘");
    expect(relativeText(at(2026, 11, 9, 9, 0), now)).toBe("내일");
    expect(relativeText(at(2026, 11, 10, 9, 0), now)).toBe("2일 후");
    expect(relativeText(at(2026, 11, 15, 9, 0), now)).toBe("7일 후");
    expect(relativeText(at(2026, 12, 8, 9, 0), now)).toBe("30일 후");
  });

  it("달력 날짜로 센다 — 23:50에서 10분 뒤는 `내일`이다", () => {
    expect(relativeText(at(2026, 11, 9, 0, 0), at(2026, 11, 8, 23, 50))).toBe("내일");
  });

  it("영어 열도 같은 자리에 숫자를 넣는다", () => {
    setLangMode("en");
    expect(relativeText(at(2026, 11, 8, 15, 0), now)).toBe("Today");
    expect(relativeText(at(2026, 11, 9, 9, 0), now)).toBe("Tomorrow");
    expect(relativeText(at(2026, 11, 10, 9, 0), now)).toBe("In 2 days");
  });

  it("아래 줄 전체는 시안 문구 그대로다", () => {
    expect(pickLine({ year: 2026, month: 11, day: 9, hour: 15, minute: 0 }, now)).toBe(
      "2026-11-09 15:00 · 내일"
    );
  });

  it("날짜 차이는 자정 기준이다", () => {
    expect(dayDiff(at(2026, 11, 8, 23, 59), at(2026, 11, 9, 0, 1))).toBe(1);
    expect(dayDiff(at(2026, 11, 8, 0, 1), at(2026, 11, 8, 23, 59))).toBe(0);
    expect(dayDiff(at(2026, 11, 8, 0, 0), at(2026, 12, 8, 0, 0))).toBe(30);
  });
});

describe("휠 칸의 글자와 순서", () => {
  it("년은 네 자리, 나머지는 0을 채운 두 자리다", () => {
    expect(fieldText("year", 2026)).toBe("2026");
    expect(fieldText("month", 11)).toBe("11");
    expect(fieldText("day", 8)).toBe("08");
    expect(fieldText("hour", 0)).toBe("00");
    expect(fieldText("minute", 5)).toBe("05");
  });

  it("칸은 왼쪽에서 오른쪽 순서다 — ←→·Tab이 이 순서로 움직인다", () => {
    expect(PICK_FIELDS).toEqual(["year", "month", "day", "hour", "minute"]);
  });
});

describe("예약 목록의 줄 (시안: 점 · 내용 · `MM/DD HH:MM · 문서 이름`)", () => {
  function reminder(id: string, due: number): Reminder {
    return {
      id,
      due,
      tabUid: "t1",
      docPath: null,
      tint: "none",
      selStart: 0,
      selEnd: 4,
      text: "글",
    };
  }

  it("둘째 줄의 시각은 월/일 시:분이다", () => {
    expect(listMomentText(at(2026, 11, 8, 15, 0))).toBe("11/08 15:00");
    expect(listMomentText(at(2026, 1, 1, 9, 5))).toBe("01/01 09:05");
  });

  it("문서 이름은 경로의 마지막 조각이고, 없으면 `제목 없음`이다", () => {
    expect(reminderDocName("C:\\notes\\주간 메모.md")).toBe("주간 메모.md");
    expect(reminderDocName("/home/me/할 일.md")).toBe("할 일.md");
    expect(reminderDocName(null)).toBe("제목 없음");
    expect(reminderDocName("")).toBe("제목 없음");
  });

  it("줄은 시각 순이다(같으면 id 순)", () => {
    const a = reminder("r2", at(2026, 11, 9, 9, 0));
    const b = reminder("r3", at(2026, 11, 8, 9, 0));
    const c = reminder("r1", at(2026, 11, 8, 9, 0));
    expect(sortByDue([a, b, c]).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);
    // 원래 배열은 건드리지 않는다 — 상태를 그 자리에서 뒤집으면 React가 못 본다.
    expect([a, b, c].map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
  });
});

describe("숫자 키보드 입력 (사용자 피드백 4 — 칸에 직접 쳐 넣기)", () => {
  const now = at(2026, 11, 8, 14, 30);
  /** 2026-11-08 15:00 — `nextHour(now)`와 같은 시각. */
  const base: Moment = { year: 2026, month: 11, day: 8, hour: 15, minute: 0 };

  it("숫자 패드와 윗줄 숫자 둘 다 숫자로 본다 (같은 `key`가 온다)", () => {
    expect(isDigitKey("0")).toBe(true);
    expect(isDigitKey("9")).toBe(true);
    expect(isDigitKey("a")).toBe(false);
    expect(isDigitKey("")).toBe(false);
    expect(isDigitKey("Backspace")).toBe(false);
    expect(isDigitKey("１")).toBe(false); // 전각 숫자는 아니다
  });

  it("칸을 채우는 자릿수는 년 4 · 나머지 2이고, 다 채웠는지 그걸로 본다", () => {
    expect(FIELD_DIGITS).toEqual({ year: 4, month: 2, day: 2, hour: 2, minute: 2 });
    expect(digitsFull("1", "hour")).toBe(false);
    expect(digitsFull("09", "hour")).toBe(true);
    expect(digitsFull("202", "year")).toBe(false);
    expect(digitsFull("2027", "year")).toBe(true);
  });

  it("치는 중인 숫자는 자릿수만큼 쌓이고, 다 찬 뒤에 또 치면 새로 시작한다", () => {
    expect(typeDigit("", "1", "month")).toBe("1");
    expect(typeDigit("1", "2", "month")).toBe("12");
    // 다 채운 칸에 또 치는 일은 마지막 칸(분)에서만 일어난다 — 그때는 새 값의 시작이다.
    expect(typeDigit("12", "3", "month")).toBe("3");
    expect(typeDigit("202", "7", "year")).toBe("2027");
    expect(typeDigit("1", "x", "month")).toBe("1"); // 숫자가 아니면 그대로
  });

  it("Backspace는 치는 중인 숫자를 한 자리 지운다", () => {
    expect(eraseDigit("20")).toBe("2");
    expect(eraseDigit("2")).toBe("");
    expect(eraseDigit("")).toBe("");
  });

  it("빈 버퍼를 확정하면 값이 그대로다 (아무 일도 없다)", () => {
    expect(commitDigits(base, "hour", "", now)).toEqual(base);
  });

  it("한 자리만 치면 0을 채운 값으로 확정된다 (시 칸에 `9` → 09)", () => {
    expect(commitDigits(base, "hour", "9", now)).toEqual({ ...base, hour: 9 });
    expect(fieldText("hour", 9)).toBe("09");
    expect(commitDigits(base, "minute", "5", now)).toEqual({ ...base, minute: 5 });
  });

  it("칸마다 가질 수 있는 값의 두 끝은 휠이 멈추는 자리와 같다", () => {
    expect(fieldRange(base, "year", now)).toEqual({ min: 2026, max: 2031 });
    expect(fieldRange(base, "month", now)).toEqual({ min: 1, max: 12 });
    expect(fieldRange(base, "hour", now)).toEqual({ min: 0, max: 23 });
    expect(fieldRange(base, "minute", now)).toEqual({ min: 0, max: 59 });
    // 일은 그 달의 길이다 — 2월은 윤년 규칙 그대로.
    expect(fieldRange({ ...base, month: 11 }, "day", now)).toEqual({ min: 1, max: 30 });
    expect(fieldRange({ ...base, month: 2 }, "day", now)).toEqual({ min: 1, max: 28 });
    expect(fieldRange({ ...base, year: 2028, month: 2 }, "day", now)).toEqual({
      min: 1,
      max: 29,
    });
  });

  it("범위 밖은 들어갈 수 있는 값으로 자른다 (월 13 → 12, 시 25 → 23, 분 70 → 59)", () => {
    expect(commitDigits(base, "month", "13", now).month).toBe(12);
    expect(commitDigits(base, "hour", "25", now).hour).toBe(23);
    expect(commitDigits(base, "minute", "70", now).minute).toBe(59);
    // 0은 없는 달·날이다 — 가장 가까운 값은 1이다.
    expect(commitDigits(base, "month", "00", now).month).toBe(1);
    expect(commitDigits(base, "day", "00", now).day).toBe(1);
    // 시·분의 0은 제대로 된 값이다.
    expect(commitDigits(base, "hour", "00", now).hour).toBe(0);
  });

  it("일은 그 달의 마지막 날까지만 — 11월에 32를 치면 30이다", () => {
    expect(commitDigits(base, "day", "32", now).day).toBe(30);
    expect(commitDigits({ ...base, month: 2 }, "day", "31", now).day).toBe(28);
  });

  it("년은 올해~+5년에서 멈춘다 (휠과 같은 규칙)", () => {
    expect(commitDigits(base, "year", "2027", now).year).toBe(2027);
    expect(commitDigits(base, "year", "1999", now).year).toBe(2026);
    expect(commitDigits(base, "year", "2099", now).year).toBe(2031);
    // 한 자리만 치고 멈춘 경우도 같은 두 끝으로 잘린다.
    expect(commitDigits(base, "year", "2", now).year).toBe(2026);
  });

  it("월·년을 쳐서 바꾸면 일을 잘라서 맞춘다 (1/31 → 2월은 28·29)", () => {
    const jan31: Moment = { year: 2027, month: 1, day: 31, hour: 9, minute: 0 };
    expect(setField(jan31, "month", 2, now)).toEqual({ ...jan31, month: 2, day: 28 });
    // 2028은 윤년이다 — 2/29가 살아 있다.
    const feb29: Moment = { year: 2028, month: 2, day: 29, hour: 9, minute: 0 };
    expect(setField(feb29, "year", 2027, now)).toEqual({ ...feb29, year: 2027, day: 28 });
    // 시·분은 일을 건드리지 않는다.
    expect(setField(jan31, "hour", 23, now)).toEqual({ ...jan31, hour: 23 });
  });

  it("다 채운 칸의 다음 칸으로 넘어간다 — 마지막 칸(분)에서는 멈춘다", () => {
    expect(nextField("year")).toBe("month");
    expect(nextField("month")).toBe("day");
    expect(nextField("day")).toBe("hour");
    expect(nextField("hour")).toBe("minute");
    expect(nextField("minute")).toBe(null);
  });

  it("쳐 넣은 시각도 지난 시각 판정을 그대로 받는다", () => {
    // 2026-11-08 14:30에 시 칸에 09를 치면 오늘 09:00 — 이미 지났다.
    const typed = commitDigits(base, "hour", "09", now);
    expect(isPast(typed, now)).toBe(true);
    expect(isPast(commitDigits(base, "hour", "16", now), now)).toBe(false);
  });
});

/*
 * 점검 2026-11-08에서 잡은 버그: `예약` 버튼이 **켜져 보이는데 눌러도 아무 일도
 * 일어나지 않았다.** 버튼이 꺼지는 근거는 그려 둔 `now`로 잰 `isPast`였고(10초마다만
 * 다시 읽었다) 누르는 순간의 판정은 `Date.now()`였다 — 고른 분이 막 지난 뒤 최대
 * 10초 동안 둘이 어긋났고, 그 사이에 누르면 조용히 아무 일도 없었다.
 * 사용자에게는 "알림 기능이 안 된다"로 보인다.
 */
describe("누르는 순간의 판정 (confirmPick)", () => {
  it("아직 오지 않은 시각은 그 시각의 밀리초를 돌려준다", () => {
    const now = at(2026, 11, 8, 14, 37, 30);
    const m: Moment = { year: 2026, month: 11, day: 8, hour: 14, minute: 38 };
    expect(confirmPick(m, now)).toEqual({ ok: true, due: toMs(m) });
  });

  it("고른 분이 **방금** 지났으면 거절하고 그 순간의 `now`를 돌려준다", () => {
    const m: Moment = { year: 2026, month: 11, day: 8, hour: 14, minute: 38 };
    // 14:38:02 — 그리는 쪽의 `now`가 14:37:5x로 낡아 버튼이 켜져 보일 수 있는 그 순간.
    const now = at(2026, 11, 8, 14, 38, 2);
    expect(confirmPick(m, now)).toEqual({ ok: false, now });
    // 돌려받은 `now`를 화면의 `now`로 올리면 경고 줄이 뜨고 버튼이 꺼진다.
    expect(isPast(m, now)).toBe(true);
  });

  it("화면의 `now`는 1초마다 다시 읽는다 — 버튼의 모습과 판정이 어긋나는 창이 1초다", () => {
    expect(PICK_NOW_TICK_MS).toBeLessThanOrEqual(1000);
  });
});
