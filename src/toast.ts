/**
 * 알림 토스트 카드의 페이지 — 승인된 시안 **T2**.
 *
 * **왜 `index.html`이 아닌 자기 페이지인가** (`ghost.html`과 같은 이유):
 *   * 카드 하나를 그리려고 React·ProseMirror·CodeMirror를 올릴 수 없다.
 *   * 토스트는 **창이 하나도 없을 때도** 떠야 한다(트레이 상주 — §7). 메인 창에 붙은
 *     DOM이면 그 창이 닫히는 순간 카드도 사라진다.
 *
 * 색은 `toast.css` → `palette.css`에서 오고, 어느 팔레트를 칠할지는 `lib/theme`의
 * `paletteName`이 정한다 — 창 본체와 **같은 함수**다(테마 규칙이 두 곳에 생기지 않는다).
 *
 * 높이는 Rust가 모른다(글꼴·언어·줄바꿈을 재야 안다). 그래서 창을 먼저 만들고,
 * 이 페이지가 카드 높이를 재서 `toast_ready`로 알리면 Rust가 창 크기를 맞추고
 * 오른쪽 아래에 쌓아 보여 준다.
 */

import { invoke } from "@tauri-apps/api/core";

import { setSystemLang, t, tf, type Lang } from "./lib/i18n";
import * as store from "./lib/settings";
import { paletteName } from "./lib/theme";
import { leave, toastTick, TOAST_LIFE_MS, TOAST_TICK_MS, type ToastLife, type ToastPayload } from "./lib/toast";
import { missedPrefix } from "./lib/reminders";

import "./toast.css";
import { blockReloadKeys } from "./lib/timestamp";

const card = document.getElementById("card");
const band = document.getElementById("band");
const bodyEl = document.getElementById("body");
const footerEl = document.getElementById("footer");
const closeBtn = document.getElementById("close");

/** `오후 3:00` — 시각 형식은 사용자 지역의 것이다(원본 `GetTimeFormatEx`와 같은 판단). */
function clockText(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function paint(payload: ToastPayload): void {
  if (!bodyEl || !footerEl) return;
  bodyEl.textContent = "";
  if (payload.missedAt !== null) {
    // 시안 T3 열의 문구를 T2 본문 앞에 dim으로(지시).
    const span = document.createElement("span");
    span.className = "missed";
    span.textContent = missedPrefix(payload.missedAt);
    bodyEl.append(span, document.createTextNode(" "));
  }
  bodyEl.append(
    document.createTextNode(payload.kind === "notice" ? t("trayNoticeBody") : payload.body)
  );
  footerEl.textContent = tf("toastFooterFmt", clockText(Date.now()));
}

/** 카드 높이를 재서 Rust에 알린다 — Rust가 창 크기를 맞추고 자리를 잡아 보여 준다. */
function report(): void {
  if (!card) return;
  // 폰트가 늦게 붙으면 높이가 달라진다. 두 번째 보고는 Rust가 같은 창에 다시 적용한다.
  const height = Math.ceil(card.getBoundingClientRect().height);
  void invoke("toast_ready", { height }).catch(() => undefined);
}

void (async () => {
  // 언어 — 창 본체와 같다: **항상 자동**(Windows 표시 언어).
  const [settings, sys] = await Promise.all([
    store.load(),
    invoke<string>("system_language").catch(() => "en"),
  ]);
  setSystemLang(sys === "ko" ? "ko" : ("en" as Lang));

  let payload: ToastPayload | null = null;
  try {
    payload = (await invoke<ToastPayload | null>("toast_payload")) ?? null;
  } catch {
    payload = null;
  }
  if (payload === null) {
    // 내용을 모르는 카드는 보여 줄 것이 없다. 창을 치우면 Rust가 상주 종료를 다시 본다.
    void invoke("toast_dismiss").catch(() => undefined);
    return;
  }

  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = paletteName(settings.theme, payload.tint, osDark);
  if (band) band.style.background = "var(--cap)";
  paint(payload);

  report();
  // 글꼴이 늦게 올라와 줄 수가 달라지는 경우. 한 번 더 재면 그 뒤로는 바뀌지 않는다.
  if (document.fonts?.ready) void document.fonts.ready.then(report).catch(() => undefined);

  // --- 8초 후 닫힘, 마우스를 올리면 정지 (원본과 같은 규칙) ---
  let life: ToastLife = { dueAt: Date.now() + TOAST_LIFE_MS, hot: false };
  const timer = window.setInterval(() => {
    const step = toastTick(life, Date.now());
    life = { ...life, dueAt: step.dueAt };
    if (step.close) {
      window.clearInterval(timer);
      void invoke("toast_dismiss").catch(() => undefined);
    }
  }, TOAST_TICK_MS);

  document.body.addEventListener("pointerenter", () => {
    life = { ...life, hot: true };
  });
  document.body.addEventListener("pointerleave", () => {
    life = leave(Date.now());
  });

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    window.clearInterval(timer);
    void invoke("toast_dismiss").catch(() => undefined);
  });

  // 본문 클릭 — 그 문서 탭을 열고 알림 범위를 선택해 그 창을 앞으로(지시 4).
  // 창이 하나도 없으면 Rust가 창을 만들고 세션을 복원한다. 카드는 Rust가 치운다
  // (여기서 먼저 치우면 "창 없음 · 예약 없음 · 카드 없음"이 되어 프로세스가 먼저 끝난다 —
  //  원본 ⑯ 단계 2가 순서를 뒤집어 고친 그 버그다).
  document.body.addEventListener("click", () => {
    window.clearInterval(timer);
    void invoke("reminder_open").catch(() => undefined);
  });
})();

// F5·Ctrl+R로 이 창이 새로 고쳐지면 알림 카드가 사라진다.
blockReloadKeys();
