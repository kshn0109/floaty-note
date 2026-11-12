/**
 * 알림 — **프론트가 책임지는 계산만**(단계 8).
 *
 * TSV 직렬화·1초 틱의 스케줄 판정·놓친 알림 가르기·카드 쌓기·트레이 상주 종료 판정은
 * **Rust에 있고 `cargo test --lib`가 지킨다**(`src-tauri/src/reminders.rs`,
 * `toast.rs`): 저장과 스케줄러는 프로세스에 하나여야 하므로(MIGRATION_HANDOFF §7) 그
 * 코드가 프론트에 없다. 같은 로직을 양쪽에 두면 둘이 어긋나는 날이 온다.
 *
 * 여기서 보는 것은 프론트에만 있는 넷이다:
 *   * 선택한 글을 한 줄로 누르는 규칙(원본 `ReminderFlatten`)
 *   * 상태 글자의 `알림 예약됨 — 시각`과 `(놓침 시각)` 조각
 *   * **§5의 예외** — 알림 상태를 받아 숨은 탭을 지키고 치우는 판정
 */

import { beforeEach, describe, expect, it } from "vitest";

import { setLangMode, setSystemLang } from "../src/lib/i18n";
import {
  findFlattened,
  flattenText,
  missedPrefix,
  momentText,
  onlyHiddenLeft,
  reconcileReminderTabs,
  reminderDiscardDetail,
  reminderStatusText,
  REMINDER_TEXT_MAX,
  type Reminder,
  type ReminderState,
} from "../src/lib/reminders";
import { leave, toastTick, TOAST_LIFE_MS } from "../src/lib/toast";
import { createTab, shownTabs, type Tab } from "../src/lib/tabs";

function reminder(id: string, due: number, tabUid: string): Reminder {
  return {
    id,
    due,
    tabUid,
    docPath: null,
    tint: "none",
    selStart: 0,
    selEnd: 4,
    text: "회고 쓰기",
  };
}

/** 그 탭을 `저장 안 함`으로 닫은 뒤의 모습 — 숨어 있고 알림을 가리킨다. */
function hiddenTab(uid: string, reminderId: string | null): Tab {
  const tab = createTab("none", null, uid);
  return { ...tab, hidden: true, reminder: reminderId, dirty: true };
}

beforeEach(() => {
  setSystemLang("ko");
  setLangMode("ko");
});

describe("선택한 글 누르기 (원본 ReminderFlatten)", () => {
  it("줄바꿈·탭·연속 공백은 공백 하나가 된다", () => {
    expect(flattenText("  첫 줄\r\n\t둘째   줄  ")).toBe("첫 줄 둘째 줄");
  });

  it("상한을 넘으면 자른 표시가 붙는다", () => {
    const cut = flattenText("가".repeat(300));
    // 토스트 클릭이 "앞부분으로 찾는" 판단을 할 수 있는 근거가 이 `…`다.
    expect(cut.endsWith("…")).toBe(true);
    expect([...cut].length).toBe(REMINDER_TEXT_MAX + 1);
  });

  it("제어 문자는 네모로 보이지 않게 공백이 된다", () => {
    expect(flattenText("표\u0001칸")).toBe("표 칸");
  });

  it("빈 선택은 빈 글이다 — 예약할 것이 없다는 뜻", () => {
    expect(flattenText("   \n\t ")).toBe("");
  });
});

describe("시각 글자", () => {
  it("두 언어에서 같은 숫자 토큰이다", () => {
    const at = new Date(2026, 10, 5, 15, 30).getTime();
    expect(momentText(at)).toBe("2026-11-05 15:30");
    setLangMode("en");
    expect(momentText(at)).toBe("2026-11-05 15:30");
  });

  it("상태 글자는 가장 이른 예약을 쓰고 남은 수를 붙인다", () => {
    const early = new Date(2026, 10, 5, 9, 0).getTime();
    const late = new Date(2026, 10, 6, 9, 0).getTime();
    expect(reminderStatusText([])).toBe("");
    expect(reminderStatusText([reminder("a", late, "t1")])).toBe("알림 예약됨 — 2026-11-06 09:00");
    // 순서가 뒤섞여 있어도 **이른 것**이 보인다.
    expect(reminderStatusText([reminder("a", late, "t1"), reminder("b", early, "t2")])).toBe(
      "알림 예약됨 — 2026-11-05 09:00 (+1)"
    );
  });

  it("놓친 알림의 앞 조각은 dim으로 그릴 수 있게 따로다", () => {
    expect(missedPrefix(new Date(2026, 10, 5, 15, 30).getTime())).toBe("(놓침 2026-11-05 15:30)");
  });

  it("버리기 전 확인 카드의 둘째 줄은 시각 · 알림 글이다", () => {
    const at = new Date(2026, 10, 5, 15, 30).getTime();
    expect(reminderDiscardDetail(reminder("a", at, "t1"))).toBe('2026-11-05 15:30 · "회고 쓰기"');
  });
});

describe("§5의 예외 — 알림이 걸린 탭", () => {
  const state = (pending: Reminder[], held: string[]): ReminderState => ({ pending, held });

  it("대기 중인 알림이 가리키는 탭에 그 id가 들어간다", () => {
    const tabs = [createTab("none", null, "t1"), createTab("none", null, "t2")];
    const got = reconcileReminderTabs(tabs, state([reminder("r1", 1, "t2")], ["t2"]));
    expect(got.tabs[0].reminder).toBeNull();
    expect(got.tabs[1].reminder).toBe("r1");
    expect(got.dropped).toEqual([]);
  });

  it("알림이 남아 있는 동안 숨은 탭은 치워지지 않는다", () => {
    const tabs = [createTab("none", null, "t1"), hiddenTab("t2", "r1")];
    const got = reconcileReminderTabs(tabs, state([reminder("r1", 1, "t2")], ["t2"]));
    expect(got.tabs).toHaveLength(2);
    expect(got.dropped).toEqual([]);
    // 숨은 탭은 어느 탭 줄에도 보이지 않는다.
    expect(shownTabs(got.tabs)).toHaveLength(1);
  });

  it("알림이 울렸지만 카드가 떠 있으면 아직 지킨다 — 그 카드를 누르면 되살아나야 한다", () => {
    const tabs = [createTab("none", null, "t1"), hiddenTab("t2", "r1")];
    // 울린 알림은 대기 목록에서 빠졌고(원본과 같다), `held`에만 남아 있다.
    const got = reconcileReminderTabs(tabs, state([], ["t2"]));
    expect(got.dropped).toEqual([]);
    // 대기 중인 알림이 없으므로 가리키는 id는 비워진다.
    expect(got.tabs[1].reminder).toBeNull();
  });

  it("알림이 끝나면(카드까지 닫히면) 숨은 탭을 치운다", () => {
    const keep = createTab("none", null, "t1");
    const gone = hiddenTab("t2", "r1");
    const got = reconcileReminderTabs([keep, gone], state([], []));
    expect(got.tabs).toHaveLength(1);
    expect(got.tabs[0].uid).toBe("t1");
    // 그 탭의 편집기(문서·실행취소)를 버려야 한다는 답이 함께 온다.
    expect(got.dropped).toEqual([gone.id]);
  });

  it("보이는 탭은 알림이 없어도 절대 치우지 않는다", () => {
    const tabs = [createTab("none", null, "t1")];
    const got = reconcileReminderTabs(tabs, state([], []));
    expect(got.tabs).toHaveLength(1);
    expect(got.dropped).toEqual([]);
  });

  it("바뀔 것이 없으면 같은 탭 객체를 그대로 돌려준다(헛 렌더 방지)", () => {
    const tabs = [createTab("none", null, "t1")];
    const got = reconcileReminderTabs(tabs, state([], []));
    expect(got.tabs[0]).toBe(tabs[0]);
  });

  it("숨은 탭만 남은 창은 보일 것이 없다", () => {
    expect(onlyHiddenLeft([hiddenTab("t1", "r1")])).toBe(true);
    expect(onlyHiddenLeft([hiddenTab("t1", "r1"), createTab("none")])).toBe(false);
    expect(onlyHiddenLeft([])).toBe(false);
  });

  /**
   * 회귀 시험 — 점검(2026-11-08)에서 잡은 버그.
   *
   * 알림이 끝나 숨은 탭이 치워지면 창에 **보일 탭이 하나도 남지 않을 수 있다.** `App`은
   * 그때 창을 닫아야 한다(§5: 마지막 탭을 닫으면 그 창이 닫힌다). 그 판정을 부르지
   * 않았던 동안 탭 줄이 빈 창이 남았고, 그 창에 치는 글은 어느 탭에도 속하지 않아
   * 세션에도 들어가지 않았다. 아래 두 줄이 그 판정의 입력이다.
   */
  it("알림이 끝난 숨은 탭 하나만 있던 창은 **빈 목록**이 되어 닫을 판정에 걸린다", () => {
    const only = hiddenTab("t1", "r1");
    const got = reconcileReminderTabs([only], state([], []));
    expect(got.tabs).toEqual([]);
    expect(got.dropped).toEqual([only.id]);
    // 빈 목록도 보일 탭이 없다 — `App`은 둘 다 창을 닫는 조건으로 본다.
    expect(shownTabs(got.tabs)).toEqual([]);
  });

  /**
   * 회귀 시험 — 점검(2026-11-08)에서 잡은 버그의 **다른 쪽 끝**.
   *
   * Rust의 `state_of`는 `held = 대기 중인 알림 ∪ 떠 있는 카드`를 보낸다. 알림이 울린
   * 직후에는 그 알림이 `pending`에서 빠지므로, **카드가 아직 없는 채로 방송하면**
   * `held`가 비고 이 함수는 숨은 탭을 버린다(= 저장하지 않은 글이 사라진다).
   * 그래서 `toast::show`는 슬롯을 **동기로** 등록하고 `reminders::tick`은 카드를
   * 세운 **뒤에** 방송한다. 이 시험은 그 순서가 왜 필요한지를 못 박는다.
   */
  it("held가 비어 있으면 숨은 탭은 버려진다 — Rust가 카드를 먼저 세워야 하는 이유", () => {
    const only = hiddenTab("t1", "r1");
    expect(reconcileReminderTabs([only], state([], [])).dropped).toEqual([only.id]);
    // 같은 탭이 held에 들어 있으면 남는다 — 순서를 지키면 이쪽이 된다.
    expect(reconcileReminderTabs([only], state([], ["t1"])).dropped).toEqual([]);
  });

  it("아직 붙들린 알림이 있으면 숨은 탭은 남고, 그래도 보일 탭은 없다", () => {
    const only = hiddenTab("t1", "r1");
    const got = reconcileReminderTabs([only], state([], ["t1"]));
    expect(got.dropped).toEqual([]);
    expect(onlyHiddenLeft(got.tabs)).toBe(true);
    expect(shownTabs(got.tabs)).toEqual([]);
  });

  /**
   * 회귀 시험 — 점검(2026-11-12)에서 잡은 버그.
   *
   * 카드를 눌러 복원된 창은 `reminder_take_reveal`의 답을 받기 **전에** 알림 상태를
   * 받는다. 그때 `held`가 비어 있어도 되살릴 탭일 수 있으므로 치우면 안 된다 —
   * 치우면 빈 탭이 열리고 세션 쓰기의 `gc_buffers`가 버퍼 파일까지 지웠다.
   */
  it("되살릴 탭을 아직 모르면(dropHidden=false) 숨은 탭을 하나도 치우지 않는다", () => {
    const only = hiddenTab("t1", "r1");
    const got = reconcileReminderTabs([only], state([], []), false);
    expect(got.dropped).toEqual([]);
    expect(got.tabs).toHaveLength(1);
    expect(got.tabs[0].uid).toBe("t1");
    // 그래도 `Tab.reminder`는 맞춘다 — 대기 중인 알림이 없으므로 `null`이 된다.
    expect(got.tabs[0].reminder).toBeNull();
  });
});

describe("눌린 알림 글로 원문에서 자리 찾기 (findFlattened)", () => {
  it("여러 줄 선택을 찾는다 — 눌린 글은 원문에 그대로 없다", () => {
    const text = "머리말\n첫 줄\n둘째 줄\n꼬리말";
    const needle = flattenText("첫 줄\n둘째 줄");
    expect(needle).toBe("첫 줄 둘째 줄");
    // 그냥 찾으면 없다 — 이것이 카드를 눌러도 아무 데도 선택되지 않았던 이유다.
    expect(text.indexOf(needle)).toBe(-1);
    const hit = findFlattened(text, needle);
    expect(hit).not.toBeNull();
    expect(text.slice(hit!.from, hit!.to)).toBe("첫 줄\n둘째 줄");
  });

  it("탭과 연속 공백도 같은 자리로 본다", () => {
    const hit = findFlattened("앞\n가\t\t나   다\n뒤", "가 나 다");
    expect(hit).not.toBeNull();
    expect(hit).toEqual({ from: 2, to: 10 });
  });

  it("`…`로 잘린 글은 잘린 부분을 빼고 앞부분으로 찾는다", () => {
    const text = "머리말 긴 글의 앞부분 그리고 뒤에 더 많은 글";
    const hit = findFlattened(text, "긴 글의 앞부분…");
    expect(hit).not.toBeNull();
    expect(text.slice(hit!.from, hit!.to)).toBe("긴 글의 앞부분");
  });

  it("정규식 메타문자는 글자 그대로 찾는다", () => {
    const hit = findFlattened("코드 a.*b(c) 끝", "a.*b(c)");
    expect(hit).not.toBeNull();
    expect(hit).toEqual({ from: 3, to: 10 });
    // 메타문자가 살아 있었다면 아래도 맞아 버렸다.
    expect(findFlattened("코드 axxbc 끝", "a.*b(c)")).toBeNull();
  });

  it("못 찾으면 null — 부르는 쪽은 아무 데도 선택하지 않는다", () => {
    expect(findFlattened("전혀 다른 글", "없는 글")).toBeNull();
    expect(findFlattened("아무 글", "")).toBeNull();
    expect(findFlattened("아무 글", "   ")).toBeNull();
    expect(findFlattened("아무 글", "…")).toBeNull();
  });

  it("공백이 없는 긴 글은 앞 40자로 찾는다(원본과 같은 상한)", () => {
    const body = "가".repeat(120);
    const text = `머리말\n${body}\n꼬리말`;
    const hit = findFlattened(text, body);
    expect(hit).not.toBeNull();
    expect(hit!.from).toBe(4);
    expect(hit!.to - hit!.from).toBe(40);
  });
});

describe("카드 수명 — 8초 후 닫힘, 마우스를 올리면 정지", () => {
  it("시각이 지나면 닫는다", () => {
    expect(toastTick({ dueAt: 1_000, hot: false }, 999)).toEqual({ dueAt: 1_000, close: false });
    expect(toastTick({ dueAt: 1_000, hot: false }, 1_000)).toEqual({ dueAt: 1_000, close: true });
  });

  it("포인터가 안에 있으면 카운트다운이 계속 밀린다 — 닫히지 않는다", () => {
    const step = toastTick({ dueAt: 1_000, hot: true }, 5_000);
    expect(step.close).toBe(false);
    expect(step.dueAt).toBe(5_000 + TOAST_LIFE_MS);
  });

  it("포인터가 빠지면 처음부터 다시 센다(읽고 있었으므로)", () => {
    expect(leave(2_000)).toEqual({ dueAt: 2_000 + TOAST_LIFE_MS, hot: false });
  });
});
