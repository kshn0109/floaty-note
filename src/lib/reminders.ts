/**
 * 알림 — 예약·목록·발생(§4, §5의 「예외 — 알림이 걸린 탭」).
 *
 * **저장과 스케줄러는 Rust 하나다**(`src-tauri/src/reminders.rs`). 이유는
 * MIGRATION_HANDOFF §7의 한 줄 그대로다: "알림이 두 번 울리거나 `reminders.tsv`를
 * 덮어쓰지 않게 프로세스는 하나." 창이 여럿이면 프론트는 여럿이고, 창마다 1초 타이머를
 * 돌리면 알림이 창 수만큼 울린다. 그래서 이 파일에는 **커맨드를 부르는 얇은 함수**와
 * **순수한 계산**만 있다.
 *
 * 저장 위치는 `%APPDATA%\Inkwell-Tauri\reminders.tsv`다. **원본 앱의
 * `%APPDATA%\Inkwell\reminders.tsv`는 건드리지 않는다** — Win32 Inkwell이 아직 사용자
 * PC에서 돌아가므로 둘이 같은 파일을 쓰면 사용자의 실제 알림이 날아간다(§7).
 *
 * ## 예약 창과 예약 목록 화면 (단계 10)
 *
 * 년/월/일/시/분 휠 피커는 `components/RemindPick.tsx`, 목록은
 * `components/RemindList.tsx`이고 **날짜 산술은 그 둘에 없다** — `lib/remindPick.ts`의
 * 순수 함수다. 두 화면이 쓰는 입구는 아래 `addReminder`/`cancelReminder`와 창이 이미
 * 들고 있는 알림 상태(`REMINDERS_EVENT`)뿐이다.
 */

import { invoke } from "@tauri-apps/api/core";

import { leafOf } from "./file";
import { t, tf } from "./i18n";
import type { Tab } from "./tabs";
import type { Tint } from "./theme";

/** 알림 하나. Rust의 `Reminder`와 1:1(camelCase로 직렬화). */
export interface Reminder {
  /** 이 실행 밖에서도 뜻이 있는 이름(파일에 그대로 들어간다). */
  id: string;
  /**
   * 울릴 시각 — **epoch 밀리초(UTC)**.
   *
   * 원본은 FILETIME(1601년부터 100ns)을 썼다. 우리 파일은 우리가 정하므로 웹 쪽과
   * Rust 쪽이 **변환 없이 같은 숫자를 보는** epoch 밀리초로 바꿨다. 원본이 FILETIME을
   * 고른 이유(절대 시각이라 재부팅·재시작을 넘어 비교·직렬화된다)는 그대로 지킨다 —
   * 바꾼 것은 기준점뿐이다. `GetTickCount64`로 되돌아가는 일은 없어야 한다.
   */
  due: number;
  /**
   * 이 알림이 걸린 탭(`Tab.uid`). **§5가 추가하라고 한 칸**이다: 알림이 걸린 탭을
   * `저장 안 함`으로 닫아도 버리지 않고 숨겨서 보관하고, 그 토스트를 누를 때만
   * 되살리려면 알림이 탭을 가리켜야 한다.
   */
  tabUid: string;
  /** 그 탭의 파일 경로. 제목 없는 탭은 `null`(원본은 빈 문자열). */
  docPath: string | null;
  /** 그 탭의 메모지 색 — 토스트가 그 탭의 종이색으로 뜬다(지시 3). */
  tint: Tint;
  /** 그 문서 안의 선택 범위. 토스트를 누르면 이 범위를 다시 선택한다. */
  selStart: number;
  selEnd: number;
  /** 토스트가 말할 글 = 선택한 글(한 줄로 눌러 160자에서 자른 것). */
  text: string;
}

/** 예약을 넣을 때 주는 것. `id`는 Rust가 발급한다. */
export type ReminderRequest = Omit<Reminder, "id">;

/**
 * Rust가 모든 창에 알리는 알림 상태.
 *
 * `held`가 따로 있는 이유: 알림이 **울린 순간** 예약 목록에서 빠지지만(원본과 같다)
 * 그 토스트를 누르면 숨은 탭이 되살아나야 한다. 그래서 "아직 치우면 안 되는 탭"은
 * `대기 중인 알림 ∪ 화면에 떠 있는 토스트`가 가리키는 탭이고, 그 계산은 둘 다 아는
 * Rust가 한다.
 */
export interface ReminderState {
  pending: Reminder[];
  /** 아직 치우면 안 되는 탭들의 `uid`. */
  held: string[];
}

/** 알림 상태가 바뀌었다(예약·취소·발생·토스트 닫힘) — Rust `reminders::REMINDERS_EVENT`. */
export const REMINDERS_EVENT = "inkwell://reminders";
/** 토스트를 눌렀다 — 그 문서·범위를 열어라. Rust `reminders::REVEAL_EVENT`. */
export const REMINDER_REVEAL_EVENT = "inkwell://reminder-reveal";

/** 토스트 클릭이 요구하는 것. Rust가 그 탭을 가진 창에 보낸다. */
export interface RevealRequest {
  tabUid: string;
  docPath: string | null;
  selStart: number;
  selEnd: number;
  text: string;
}

/** 알림이 들고 가는 글의 길이 상한(원본 `kReminderTextMax`). */
export const REMINDER_TEXT_MAX = 160;

/**
 * 여러 줄 선택을 **한 단락으로** 누른다(원본 `ReminderFlatten`). 토스트는 흘깃 보는
 * 카드이고 목록은 한 줄이라, 줄바꿈·탭·연속 공백은 공백 하나가 된다. 상한을 넘으면
 * `…`를 붙여 자른다 — 자른 표시가 있어야 토스트 클릭이 되살릴 범위를 찾을 때
 * "앞부분으로 검색한다"는 판단이 설 수 있다.
 */
export function flattenText(input: string, cap = REMINDER_TEXT_MAX): string {
  let out = "";
  let space = false;
  // **코드 포인트로** 센다. Rust 쪽(`reminders::flatten`)이 `chars().count()`로 세므로
  // UTF-16 길이로 재면 이모지가 섞인 선택에서 두 쪽의 결과가 달라지고, 그러면 토스트
  // 클릭이 "범위의 글이 그대로 읽히는가"를 비교할 때 늘 어긋난다.
  let count = 0;
  for (const ch of input) {
    // 제어 문자는 네모로 보이므로 공백으로 눌러 버린다(원본과 같은 처리).
    const c = ch === "\r" || ch === "\n" || ch === "\t" || ch.charCodeAt(0) < 0x20 ? " " : ch;
    if (c === " ") {
      if (out === "") continue;
      space = true;
      continue;
    }
    if (space) {
      out += " ";
      space = false;
      count += 1;
    }
    out += c;
    count += 1;
    if (count >= cap) {
      out += "…";
      break;
    }
  }
  return out;
}

/** 알림 글로 본문을 찾을 때 쓰는 앞부분의 길이 상한(원본과 같은 40자). */
const NEEDLE_MAX = 40;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 눌러 둔 알림 글(`flattenText`의 결과)로 **원문**에서 그 자리를 찾는다 — 토스트를 누를 때
 * "글이 움직였을 뿐"인 흔한 경우를 되살리는 **한 자리**.
 *
 * 그냥 `indexOf`로는 안 된다: 저장된 글은 줄바꿈·탭·연속 공백이 **공백 하나로 눌린** 것이라
 * 여러 줄 선택이면 원문에 그런 문자열이 아예 없다(점검 2026-11-12에서 잡은 버그 — 카드를
 * 눌러도 아무 데도 선택되지 않았다). 그래서 공백으로 쪼갠 조각을 `\s+`로 이어 찾는다.
 *
 * 규칙:
 *   * `…`(상한에서 잘린 표시) 뒤는 버린다 — 잘린 마지막 조각은 **앞부분으로** 맞는다.
 *   * 앞 40자까지만 쓴다(원본과 같다. 뒤가 고쳐졌어도 앞이 남아 있으면 찾는다).
 *     조각 가운데서 자르지 않으려고 **조각 단위**로 센다.
 *   * 못 찾으면 `null` — 부르는 쪽은 **아무 데도 선택하지 않는다**(엉뚱한 자리를 선택해
 *     주는 것이 가장 나쁜 답이다).
 */
export function findFlattened(text: string, needle: string): { from: number; to: number } | null {
  let n = needle;
  const cut = n.indexOf("…");
  if (cut >= 0) n = n.slice(0, cut);
  const all = n.split(/\s+/).filter((p) => p !== "");
  if (all.length === 0) return null;
  const parts: string[] = [];
  let len = 0;
  for (const p of all) {
    // 첫 조각은 길어도 넣는다 — 공백이 없는 글(한국어·일본어)은 통째로 한 조각이다.
    if (parts.length > 0 && len + 1 + p.length > NEEDLE_MAX) break;
    len += (parts.length > 0 ? 1 : 0) + p.length;
    parts.push(p);
  }
  // 조각이 하나뿐인데 상한을 넘으면(공백이 없는 글) 거기서 앞 40자를 쓴다 — 원본이
  // `needle.slice(0, 40)`으로 하던 그 일이다. 코드 포인트로 세어 서러게이트를 쪼개지 않는다.
  if (parts.length === 1) {
    const cps = Array.from(parts[0]);
    if (cps.length > NEEDLE_MAX) parts[0] = cps.slice(0, NEEDLE_MAX).join("");
  }
  const m = new RegExp(parts.map(escapeRegExp).join("\\s+")).exec(text);
  if (m === null) return null;
  return { from: m.index, to: m.index + m[0].length };
}

/**
 * `2026-11-05 15:30` — 숫자만 쓰는 **두 언어에서 같은 토큰**(상태 글자의 `UTF-8`·`LF`와
 * 같은 규칙, 원본 `ReminderMomentText`). 사용자의 **지역 시각**이다.
 */
export function momentText(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(
    d.getMinutes()
  )}`;
}

/**
 * 예약 목록 줄의 둘째 줄 앞 조각 — `11/08 15:00`. 목록은 44px 한 줄이라 년을 적을
 * 자리가 없고, 같은 해가 아닌 예약도 **시각 순**으로 줄을 서므로 순서는 읽힌다
 * (시안 문구 그대로). 여기도 숫자만이라 두 언어에서 같은 토큰이다.
 */
export function listMomentText(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 목록 줄의 문서 이름 — 경로의 마지막 조각, 제목 없는 탭은 `제목 없음`. */
export function reminderDocName(docPath: string | null): string {
  return docPath === null || docPath === "" ? t("tabUntitled") : leafOf(docPath);
}

/** 시각 순(같으면 넣은 순서 = id 순). 예약 목록이 줄을 세우는 **한 자리**. */
export function sortByDue(list: readonly Reminder[]): Reminder[] {
  return [...list].sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
}

/**
 * 상태 글자 왼쪽의 `알림 예약됨 — 시각`(지시 8, 원본 `kStrRemindSetFmt`). 예약이 둘
 * 이상이면 **가장 이른 것**을 쓰고 `(+n)`을 붙인다 — 원본 바닥 바와 같다.
 * 예약이 없으면 빈 문자열.
 */
export function reminderStatusText(pending: readonly Reminder[]): string {
  if (pending.length === 0) return "";
  let next = pending[0];
  for (const r of pending) if (r.due < next.due) next = r;
  const head = tf("remindSetFmt", momentText(next.due));
  return pending.length > 1 ? `${head} (+${pending.length - 1})` : head;
}

/**
 * 알림이 걸린 탭을 버리기 전 두 번째 확인 카드의 dim 둘째 줄 — `2026-11-05 15:30 · "회의"`
 * (승인된 시안 `DiscardReminder.dc.html` ②). 시각은 예약 상태 글자·토스트와 **같은**
 * `momentText`이고, 가운뎃점 구분은 예약 목록 줄과 같다. 글은 알림에 저장된 발췌다
 * (`flattenText`로 이미 한 줄로 눌려 있다).
 */
export function reminderDiscardDetail(r: Pick<Reminder, "due" | "text">): string {
  return `${momentText(r.due)} · "${r.text}"`;
}

/** 놓친 알림의 본문 앞에 붙는 dim 조각 — `(놓침 2026-11-05 15:30)`. */
export function missedPrefix(ms: number): string {
  return tf("toastMissedPrefixFmt", momentText(ms));
}

/** 선택이 없을 때 `알림 예약…`이 하는 말(원본 `kStrRemindNoSelection`). */
export function noSelectionText(): string {
  return t("remindNoSelection");
}

/**
 * 알림 상태가 바뀌었을 때 탭 목록을 맞춘다 — §5의 예외를 지키는 **한 자리**.
 *
 *   * `Tab.reminder`는 그 탭을 가리키는 **대기 중인** 알림의 id(없으면 `null`).
 *     메뉴의 `예약된 알림` 활성과 숨김 판단이 이 값을 본다.
 *   * **숨은 탭**은 `held`에 없으면 치운다. `held`는 "대기 중인 알림 ∪ 떠 있는 토스트"가
 *     가리키는 탭이므로, 알림이 울리고 그 토스트가 닫힌(또는 눌린) 다음에야 치워진다 —
 *     §5의 "알림이 끝나면 정리"가 바로 이 순간이다.
 *   * 보이는 탭은 절대 치우지 않는다. 숨김은 `저장 안 함`으로 닫힌 탭의 상태이고,
 *     보이는 탭은 사용자가 보고 있는 문서다.
 *
 * 돌려주는 `dropped`는 **편집기를 버려야 하는 탭 id**다(`dropHost`).
 *
 * `dropHidden`이 `false`면 숨은 탭을 **하나도 치우지 않는다**(`Tab.reminder`만 맞춘다).
 * 창이 막 뜬 동안 쓰는 길이다: 카드 클릭으로 복원된 창은 `reminder_take_reveal`의 답을
 * 받기 전까지 "이 숨은 탭을 되살려야 하는가"를 모르고, 그 사이에 도착한 `held=[]`를
 * 믿으면 **되살릴 탭을 치워 버린다**(점검 2026-11-12). 모를 때는 지키는 쪽이다.
 */
export function reconcileReminderTabs(
  tabs: readonly Tab[],
  state: ReminderState,
  dropHidden = true
): { tabs: Tab[]; dropped: number[] } {
  const held = new Set(state.held);
  const dropped: number[] = [];
  const next: Tab[] = [];
  for (const tab of tabs) {
    if (dropHidden && tab.hidden && !held.has(tab.uid)) {
      dropped.push(tab.id);
      continue;
    }
    const mine = state.pending.find((r) => r.tabUid === tab.uid) ?? null;
    const id = mine === null ? null : mine.id;
    next.push(tab.reminder === id ? tab : { ...tab, reminder: id });
  }
  return { tabs: next, dropped };
}

/**
 * 숨은 탭이 **하나도 안 보이게** 됐을 때 창을 닫아도 되는가. `저장 안 함`으로 닫은
 * 알림 탭만 남은 창은 보일 것이 없으므로 닫힌다(§5: 마지막 탭을 닫으면 창이 닫힌다) —
 * 그래도 세션에는 숨은 탭이 남아 다음 실행에 숨은 채로 돌아온다.
 */
export function onlyHiddenLeft(tabs: readonly Tab[]): boolean {
  return tabs.length > 0 && tabs.every((tab) => tab.hidden);
}

// ---------------------------------------------------------------------------
// Rust 커맨드 — 저장과 스케줄은 전부 저쪽이다
// ---------------------------------------------------------------------------

function sane(value: unknown): ReminderState {
  if (!value || typeof value !== "object") return { pending: [], held: [] };
  const v = value as Partial<ReminderState>;
  return {
    pending: Array.isArray(v.pending) ? v.pending : [],
    held: Array.isArray(v.held) ? v.held : [],
  };
}

/** 예약 하나를 넣는다. 돌려받은 `Reminder`에 Rust가 발급한 `id`가 들어 있다. */
export async function addReminder(req: ReminderRequest): Promise<Reminder | null> {
  try {
    return await invoke<Reminder>("reminder_add", { req });
  } catch (err) {
    console.error("[Inkwell] 알림을 예약할 수 없습니다:", err);
    return null;
  }
}

/** 예약 하나를 취소한다. 그 id가 없었으면 `false`. */
export async function cancelReminder(id: string): Promise<boolean> {
  try {
    return await invoke<boolean>("reminder_cancel", { id });
  } catch {
    return false;
  }
}

/** 지금 상태(대기 목록 + 치우면 안 되는 탭). */
export async function reminderState(): Promise<ReminderState> {
  try {
    return sane(await invoke<unknown>("reminder_state"));
  } catch {
    return { pending: [], held: [] };
  }
}

/**
 * 창이 뜨기 **전에** 눌린 토스트가 남겨 둔 요청을 가져온다(두 번 읽히지 않게 꺼내 간다).
 * 트레이에 상주하던 중 토스트를 누르면 창이 그때 만들어지므로, 이벤트만으로는 리스너가
 * 붙기 전에 사라진다 — `ghost_paint`·`take_cli_files`와 같은 두 길 구조다.
 */
export async function takeReveal(): Promise<RevealRequest | null> {
  try {
    return (await invoke<RevealRequest | null>("reminder_take_reveal")) ?? null;
  } catch {
    return null;
  }
}

/** 개발 빌드에서 토스트 모양을 바로 보기 위한 길(지시 검증 방법). 배포 UI에는 없다. */
export async function previewToast(missed: boolean): Promise<void> {
  try {
    await invoke("toast_preview", { missed });
  } catch (err) {
    console.error("[Inkwell] 토스트 미리보기 실패:", err);
  }
}
