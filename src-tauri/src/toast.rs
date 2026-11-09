//! 알림 토스트 창(시안 **T2**) · 트레이 상주 · **종료 판단** (§4, §7, 지시 3·7).
//!
//! ## 카드 하나 = 창 하나
//!
//! 원본과 같은 구조다. 카드는 **자기 최상위 창**이어야 한다:
//!   * 창이 하나도 없을 때(트레이 상주)도 떠 있어야 한다. 메인 창의 DOM이면 그 창이
//!     닫히는 순간 카드도 사라진다.
//!   * 다른 앱 창 위에 떠야 하고(항상 위), 작업 표시줄에 보이면 안 되고,
//!     **포커스를 빼앗으면 안 된다**(타이핑 중에 글자가 다른 곳으로 가면 안 된다).
//!
//! 페이지는 `toast.html`(React·편집기 없는 경량 페이지)이고, 쓰는 것은 아래 커맨드
//! 넷뿐이다: `toast_payload`(무엇을 그릴까) · `toast_ready`(내 높이는 이만큼) ·
//! `toast_dismiss`(치워 줘) · `reminder_open`(본문을 눌렀어).
//!
//! **높이를 페이지가 재는 이유**: 글꼴·언어·줄바꿈을 재야 알 수 있고, 그걸 아는 것은
//! webview뿐이다. 그래서 창을 **숨긴 채** 만들고, 높이를 받아 크기를 맞춘 뒤 자리를
//! 잡아 보여 준다(원본 `ToastLayout`이 `DrawTextW(DT_CALCRECT)`로 한 일과 같다).
//! 창을 보이는 채로 만들면 엉뚱한 자리에 한 프레임 깜빡인다(`window_create`와 같은 판단).
//!
//! ## 종료 판단은 한 자리다 — `reconsider`
//!
//! §7: "알림 토스트가 사라질 때 트레이 상주 종료 판단을 꼭 다시 할 것(안 하면 영원히
//! 상주)." 그래서 판정은 `reminders::decide` 하나이고, 부르는 자리는 **다섯**이다:
//! 창이 사라졌을 때(`lib.rs`의 `Destroyed`) · 알림이 울렸을 때 · 알림이 취소됐을 때 ·
//! 카드가 닫혔을 때 · 트레이의 `열기`로 창이 돌아왔을 때.

use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};

use crate::reminders::{decide, Reminder, Reminders, Residency, RevealRequest, REVEAL_EVENT};
use crate::winmgr;

/// 위로 쌓이는 카드의 최대 개수(원본 `kToastMax`). 넘으면 가장 오래된 것이 물러난다.
const MAX: usize = 4;
/// 시안 T2의 폭. 높이는 본문에 따라 달라진다.
const WIDTH_DIP: f64 = 300.0;
/// 작업 영역 모서리에서의 여백과 카드 사이 간격(원본 `kToastMarginDip`·`kToastStackGapDip`).
const MARGIN_DIP: f64 = 16.0;
const GAP_DIP: f64 = 8.0;
/// 높이를 못 받았을 때 쓰는 잠정 높이(배너 6 + 안쪽 14·14 + 한 줄 24 + 12 + 16).
const FALLBACK_H_DIP: f64 = 86.0;
/// webview가 어떤 이유로 자기 수명을 못 세는 경우의 **받침**. 카드가 영원히 떠 있으면
/// 프로세스가 영원히 상주한다(원본 `kTrayQuitDelayMs`가 받치던 그 구멍).
const BACKSTOP: Duration = Duration::from_secs(60);

/// 만들어 둔 카드를 **화면 밖에** 두는 자리. 어느 모니터에도 없는 좌표다(`drag.rs`와 같다).
const PARK: i32 = -32000;
const LABEL_PREFIX: &str = "inkwell-toast";
/// 트레이 아이콘의 id. 하나만 있고, 상주를 시작할 때 만들고 끝날 때 지운다.
const TRAY_ID: &str = "inkwell-tray";

/// 토스트 페이지가 받는 것. 프론트의 `ToastPayload`와 1:1(`src/lib/toast.ts`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToastPayload {
    /// `"reminder"` 또는 `"notice"`(트레이 상주 안내).
    pub kind: &'static str,
    pub body: String,
    /// 놓친 알림이면 그 시각(epoch 밀리초).
    pub missed_at: Option<i64>,
    pub tint: String,
}

struct Slot {
    label: String,
    payload: ToastPayload,
    /// 본문 클릭이 되살릴 알림. 안내 카드는 `None`(원본과 같이 창만 돌아온다).
    about: Option<Reminder>,
    /// 창의 물리 픽셀 크기. 높이를 받기 전에는 잠정값이다.
    w: u32,
    h: u32,
}

#[derive(Default)]
struct Inner {
    /// `[0]`이 가장 오래된 카드(원본의 슬롯 배열과 같은 순서).
    slots: Vec<Slot>,
    next: u64,
    /// 창 없이 알림만을 위해 살아 있는 상태인가(원본 `g_trayResident`).
    resident: bool,
}

#[derive(Default)]
pub struct Toasts(Mutex<Inner>);

fn lock(state: &Toasts) -> MutexGuard<'_, Inner> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// 이 라벨이 토스트 카드인가. `winmgr::is_main_label`이 이것을 보고 **창 수에서 뺀다** —
/// 카드를 창으로 세면 "창이 하나도 없다"가 영원히 거짓이 되어 상주 판단이 멈춘다.
pub fn is_toast_label(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

/// 떠 있는 카드가 가리키는 탭들 — §5의 "아직 치우면 안 되는 탭"의 절반.
pub fn held_tabs(app: &AppHandle) -> Vec<String> {
    lock(&app.state::<Toasts>())
        .slots
        .iter()
        .filter_map(|s| s.about.as_ref().map(|r| r.tab_uid.clone()))
        .collect()
}

pub fn live_count(app: &AppHandle) -> usize {
    lock(&app.state::<Toasts>()).slots.len()
}

// ---------------------------------------------------------------------------
// 쌓는 자리 — 순수 계산
// ---------------------------------------------------------------------------

/// 작업 영역의 **오른쪽 아래**에서 위로 쌓는다(Windows가 자기 알림을 두는 자리이고
/// 원본 `ToastRestack`과 같다. `work_*`는 작업 표시줄이 어디 붙어 있든 이미 빠진 값이다).
///
/// `sizes`는 **오래된 것부터**이고 돌려주는 자리도 같은 순서다. 새 카드가 맨 아래에
/// 오고 오래된 것이 위로 밀린다. 위로 넘치면 작업 영역 위에서 멈춘다.
pub fn stack_positions(
    work_x: i32,
    work_y: i32,
    work_w: u32,
    work_h: u32,
    margin: i32,
    gap: i32,
    sizes: &[(u32, u32)],
) -> Vec<(i32, i32)> {
    let mut out = vec![(0, 0); sizes.len()];
    let mut bottom = work_y + work_h as i32 - margin;
    for i in (0..sizes.len()).rev() {
        let (w, h) = sizes[i];
        let mut top = bottom - h as i32;
        if top < work_y {
            top = work_y;
        }
        out[i] = (work_x + work_w as i32 - margin - w as i32, top);
        bottom = top - gap;
    }
    out
}

/// 카드를 띄울 모니터의 작업 영역과 배율. **주 모니터**를 쓴다 — Windows가 자기 알림을
/// 거기 띄우고 원본도 `MONITOR_DEFAULTTOPRIMARY`였다. 모니터를 못 읽으면 `None`이고,
/// 그때는 자리를 잡지 않고 보여 주기만 한다(카드를 안 보여 주는 것보다 낫다).
fn primary_area(app: &AppHandle) -> Option<(i32, i32, u32, u32, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let area = monitor.work_area();
    Some((
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
    ))
}

fn restack(app: &AppHandle) {
    let Some((x, y, w, h, scale)) = primary_area(app) else {
        return;
    };
    let (sizes, labels): (Vec<(u32, u32)>, Vec<String>) = {
        let state = app.state::<Toasts>();
        let inner = lock(&state);
        (
            inner.slots.iter().map(|s| (s.w, s.h)).collect(),
            inner.slots.iter().map(|s| s.label.clone()).collect(),
        )
    };
    let margin = (MARGIN_DIP * scale).round() as i32;
    let gap = (GAP_DIP * scale).round() as i32;
    let spots = stack_positions(x, y, w, h, margin, gap, &sizes);
    for (label, (px, py)) in labels.iter().zip(spots) {
        if let Some(win) = app.get_webview_window(label) {
            let _ = win.set_position(tauri::PhysicalPosition::new(px, py));
            let _ = win.set_always_on_top(true);
        }
    }
}

// ---------------------------------------------------------------------------
// 띄우기
// ---------------------------------------------------------------------------

/// 알림 하나의 카드를 올린다(원본 `ReminderFire`). `missed`는 앱이 꺼져 있던 동안
/// 지나간 알림 — 본문 앞에 `(놓침 시각)`이 dim으로 붙는다(지시 5).
pub fn fire(app: &AppHandle, reminder: &Reminder, missed: bool) {
    let payload = ToastPayload {
        kind: "reminder",
        body: reminder.text.clone(),
        missed_at: if missed { Some(reminder.due) } else { None },
        tint: reminder.tint.clone(),
    };
    show(app, payload, Some(reminder.clone()));
    beep();
    flash_taskbar(app);
}

/// 트레이 상주 안내 — **한 번만** 한다(원본 `TrayNoticeShown`). 원본은 이 안내도
/// 자기 카드로 띄웠고(끝난 일 ⑫), 지시도 "화면이 새로 필요하면 T2를 재사용"이라
/// 같은 카드를 쓴다. 알림이 아니라 앱에 대한 말이므로 누르면 **창만 돌아온다**.
fn notice(app: &AppHandle) {
    show(
        app,
        ToastPayload {
            kind: "notice",
            body: String::new(),
            missed_at: None,
            // 안내는 특정 탭의 것이 아니다 — 창의 기본 테마로 뜬다.
            tint: "none".into(),
        },
        None,
    );
    beep();
}

/// 개발 빌드에서 모양을 바로 보기 위한 길(지시 검증 방법). UI 쪽에서
/// `import.meta.env.DEV`로만 부른다.
#[tauri::command]
pub fn toast_preview(app: AppHandle, missed: bool) {
    let sample = Reminder {
        id: "preview".into(),
        due: crate::reminders::now_ms() - 5 * 60 * 1000,
        tab_uid: String::new(),
        doc_path: None,
        tint: "none".into(),
        sel_start: 0,
        sel_end: 0,
        text: "디자인 리뷰 자료 보내기".into(),
    };
    // 미리보기는 되살릴 문서가 없다 — 누르면 창만 앞으로 온다.
    let payload = ToastPayload {
        kind: "reminder",
        body: sample.text.clone(),
        missed_at: if missed { Some(sample.due) } else { None },
        tint: sample.tint.clone(),
    };
    show(&app, payload, None);
    beep();
}

/// 카드 창 하나를 만든다. **어느 스레드에서 불러도 된다** — 창 만들기는 메인 스레드를
/// 붙잡으면 교착하므로 async 런타임으로 넘긴다(`winmgr::window_create`와 같은 이유).
fn show(app: &AppHandle, payload: ToastPayload, about: Option<Reminder>) {
    /*
     * **슬롯은 여기서, 창보다 먼저, 동기로 등록한다.**
     *
     * 슬롯은 `held_tabs`의 근거이고 `held`는 프론트가 "이 숨은 탭을 아직 치우면 안
     * 된다"를 아는 유일한 길이다(§5). 방금 울린 알림은 `pending`에서 빠지므로, 슬롯이
     * 들어가기 전에 `reminders::broadcast`가 나가면 그 탭은 `pending`에도 `held`에도
     * 없고 프론트가 **숨은 탭을 버린다** — 저장하지 않은 글이 그대로 사라진다
     * (점검 2026-11-08에서 잡은 버그). 등록이 async 런타임 안에 있던 동안은
     * `tick`에서 `fire`를 부른 직후에 방송해도 이 틈이 남았다.
     *
     * 창 만들기만 async 런타임으로 넘긴다 — 그쪽은 메인 스레드를 붙잡으면 교착한다.
     */
    let label = {
        let state = app.state::<Toasts>();
        let mut inner = lock(&state);
        inner.next += 1;
        let label = format!("{LABEL_PREFIX}-{}", inner.next);
        inner.slots.push(Slot {
            label: label.clone(),
            payload,
            about,
            // 배율은 모니터를 물어야 알 수 있어 아래 작업에서 보정한다(잠정값 = 100%).
            w: WIDTH_DIP.round() as u32,
            h: FALLBACK_H_DIP.round() as u32,
        });
        label
    };

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // 넘치면 가장 오래된 카드가 물러난다(원본 `ToastDestroySlot(0)`).
        // 방금 넣은 것도 세고 있으므로 기준이 `> MAX`다.
        let evict = {
            let state = app.state::<Toasts>();
            let inner = lock(&state);
            if inner.slots.len() > MAX {
                inner.slots.first().map(|s| s.label.clone())
            } else {
                None
            }
        };
        if let Some(label) = evict {
            destroy(&app, &label);
        }

        let scale = primary_area(&app).map(|a| a.4).unwrap_or(1.0);
        {
            let state = app.state::<Toasts>();
            let mut inner = lock(&state);
            if let Some(slot) = inner.slots.iter_mut().find(|s| s.label == label) {
                slot.w = (WIDTH_DIP * scale).round() as u32;
                slot.h = (FALLBACK_H_DIP * scale).round() as u32;
            }
        }

        let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("toast.html".into()));
        #[cfg(debug_assertions)]
        let builder = crate::session::with_webview_data_dir(builder);
        let built = builder
            .title("Inkwell")
            .inner_size(WIDTH_DIP, FALLBACK_H_DIP)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            // 작업 표시줄에 보이지 않고, 포커스를 빼앗지 않는다(원본
            // `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`).
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            // **숨기지 않고 화면 밖에서 만든다.** Windows에서 `show()`는 창을 활성화해
            // 타이핑 중인 창의 포커스를 빼앗을 수 있다(`drag.rs`가 고스트를 숨기지 않고
            // 치워 두는 것과 같은 이유). 높이를 받은 뒤 제자리로 옮기기만 한다.
            .position(f64::from(PARK), f64::from(PARK))
            .build();

        if built.is_err() {
            let state = app.state::<Toasts>();
            lock(&state).slots.retain(|s| s.label != label);
            return;
        }

        // 받침: 페이지가 자기 수명을 못 세도 카드는 반드시 사라진다.
        let backstop = app.clone();
        let doomed = label.clone();
        std::thread::spawn(move || {
            std::thread::sleep(BACKSTOP);
            destroy(&backstop, &doomed);
        });
    });
}

/// 창을 부순다. 슬롯 정리와 종료 재판정은 `forget`(창의 `Destroyed` 이벤트)이 한다 —
/// 길이 하나여야 "두 번 치우기"를 막는 코드가 필요 없다.
fn destroy(app: &AppHandle, label: &str) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.destroy();
    } else {
        // 창이 이미 없다면 슬롯만 남아 있을 수 있다.
        forget(app, label);
    }
}

/// 카드 창이 사라졌다 — `lib.rs`의 `Destroyed`가 부른다. **여기서 종료 판정을 다시
/// 돌리는 것이 §7의 그 한 줄이다.**
///
/// 슬롯만 여기서 치우고 나머지(자리 다시 잡기·방송·종료 판정)는 async 런타임으로 넘긴다.
/// 창 이벤트 핸들러는 **이벤트 루프 안**이라, 거기서 창·모니터를 되묻는 호출을 하면
/// 루프가 자기 답을 기다리게 된다(`window_create`가 async인 것과 같은 이유).
pub fn forget(app: &AppHandle, label: &str) {
    let had = {
        let state = app.state::<Toasts>();
        let mut inner = lock(&state);
        let before = inner.slots.len();
        inner.slots.retain(|s| s.label != label);
        before != inner.slots.len()
    };
    if !had {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        restack(&app);
        // 카드가 가리키던 탭이 빠졌으므로 숨은 탭 정리 판단이 달라진다(§5).
        crate::reminders::broadcast(&app);
        reconsider(&app);
    });
}

// ---------------------------------------------------------------------------
// 커맨드 — 토스트 페이지가 쓰는 넷
// ---------------------------------------------------------------------------

/// 이 카드가 무엇을 그릴지. 이벤트가 아니라 **묻는 쪽**인 이유는 `ghost_paint`와 같다:
/// 페이지가 뜨기 전에 보낸 이벤트는 사라진다.
#[tauri::command]
pub fn toast_payload(window: Window, state: tauri::State<'_, Toasts>) -> Option<ToastPayload> {
    let label = window.label();
    lock(&state)
        .slots
        .iter()
        .find(|s| s.label == label)
        .map(|s| s.payload.clone())
}

/// 페이지가 자기 높이를 알려 왔다 — 크기를 맞추고 자리를 잡아 **그때 보여 준다**.
/// 글꼴이 늦게 붙어 두 번 올 수 있고, 두 번째도 같은 길로 다시 적용된다.
/// **`async`인 이유**: 창 크기·자리·모니터를 되묻는 호출이라 동기 커맨드(메인 스레드)
/// 에서 하면 이벤트 루프가 자기 답을 기다린다 — `window_create`와 같은 자리다.
#[tauri::command]
pub async fn toast_ready(app: AppHandle, window: Window, height: f64) {
    let label = window.label().to_string();
    let h = height.max(1.0).min(600.0);
    let scale = window.scale_factor().unwrap_or(1.0);
    {
        let state = app.state::<Toasts>();
        let mut inner = lock(&state);
        let Some(slot) = inner.slots.iter_mut().find(|s| s.label == label) else {
            return;
        };
        slot.w = (WIDTH_DIP * scale).round() as u32;
        slot.h = (h * scale).round() as u32;
    }
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_size(tauri::LogicalSize::new(WIDTH_DIP, h));
    }
    // 자리를 잡는 것이 곧 "보이는 것"이다 — 화면 밖에서 만들어 두었다.
    restack(&app);
}

/// ✕ 또는 8초 경과. 창을 부수면 `Destroyed` → `forget` → 종료 재판정으로 이어진다.
#[tauri::command]
pub async fn toast_dismiss(app: AppHandle, window: Window) {
    let label = window.label().to_string();
    destroy(&app, &label);
}

/// 본문 클릭(지시 4) — 그 문서 탭을 열고 알림 범위를 선택해 그 창을 앞으로.
///
/// **순서가 중요하다.** 창을 먼저 되살리고 카드를 나중에 치운다. 거꾸로 하면
/// `forget`이 "창 없음 · 예약 없음 · 카드 없음"을 보고 프로세스를 끝내 버린다 —
/// 원본 ⑯ 단계 2가 순서를 뒤집어 고친 그 버그다.
#[tauri::command]
pub async fn reminder_open(app: AppHandle, window: Window) {
    let label = window.label().to_string();
    let about = {
        let state = app.state::<Toasts>();
        let inner = lock(&state);
        inner
            .slots
            .iter()
            .find(|s| s.label == label)
            .and_then(|s| s.about.clone())
    };

    let req = about.map(|r| RevealRequest {
        tab_uid: r.tab_uid,
        doc_path: r.doc_path,
        sel_start: r.sel_start,
        sel_end: r.sel_end,
        text: r.text,
    });

    // 그 탭을 **들고 있는 창**이 있으면 그 창이다(세션 기록으로 찾는다). 없으면 마지막
    // 활성 창, 그것도 없으면 창을 하나 만들어 세션을 복원한다(트레이 상주 중의 길).
    let owner = req
        .as_ref()
        .filter(|r| !r.tab_uid.is_empty())
        .and_then(|r| crate::session::window_with_tab(&app, &r.tab_uid));

    if let Some(r) = req.clone() {
        app.state::<Reminders>().put_reveal(r);
    }
    let win = match owner.and_then(|l| app.get_webview_window(&l)) {
        Some(win) => Some(win),
        None => restore_window(&app).await,
    };
    if let Some(win) = win {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        if let Some(r) = req {
            // 창이 이미 살아 있으면 이벤트가 바로 닿는다. 방금 만든 창은 아직 리스너가
            // 없으므로 `reminder_take_reveal`로 가져간다 — 두 길 모두 열어 둔다.
            let _ = app.emit_to(win.label(), REVEAL_EVENT, r);
        }
    }
    destroy(&app, &label);
}

// ---------------------------------------------------------------------------
// 트레이 상주와 종료 판단
// ---------------------------------------------------------------------------

/// 상주할 이유가 아직 있는가 — `RunEvent::ExitRequested`가 묻는다. 창이 전부 닫히면
/// Tauri는 프로세스를 끝내려 하므로, 여기서 참이면 막는다.
pub fn should_stay(app: &AppHandle) -> bool {
    app.state::<Reminders>().count() > 0 || live_count(app) > 0
}

/// **종료 판단 한 자리**(§7). 창·예약·카드 세 숫자만 보고 네 가지 중 하나를 한다.
pub fn reconsider(app: &AppHandle) {
    let windows = winmgr::main_window_count(app);
    let pending = app.state::<Reminders>().count();
    let toasts = live_count(app);
    match decide(windows, pending, toasts) {
        Residency::HasWindow => leave_tray(app),
        Residency::StayInTray => enter_tray(app),
        // 카드를 보여 주고 끝난다. 카드가 닫힐 때 `forget`이 여기로 다시 온다.
        Residency::WaitForToast => {}
        Residency::Quit => {
            leave_tray(app);
            let app = app.clone();
            let _ = app.clone().run_on_main_thread(move || app.exit(0));
        }
    }
}

fn enter_tray(app: &AppHandle) {
    let first = {
        let state = app.state::<Toasts>();
        let mut inner = lock(&state);
        if inner.resident {
            false
        } else {
            inner.resident = true;
            true
        }
    };
    if !first {
        return;
    }
    ensure_tray(app);
    // 처음 트레이로 들어갈 때만 안내(원본 `TrayNoticeShown`).
    if crate::settings::mark_tray_notice_shown() {
        notice(app);
    }
}

fn leave_tray(app: &AppHandle) {
    let was = {
        let state = app.state::<Toasts>();
        let mut inner = lock(&state);
        std::mem::replace(&mut inner.resident, false)
    };
    if !was {
        return;
    }
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let _ = app.remove_tray_by_id(TRAY_ID);
    });
}

/// 트레이 아이콘과 그 메뉴(원본 `kTrayItems` 구성: `Inkwell 열기` · 구분선 · `종료`).
///
/// **왜 문자열이 여기 있는가**: 문자열 표(`src/lib/i18n.ts`)는 webview의 것이고 트레이
/// 메뉴는 창이 하나도 없을 때 떠야 한다. 두 줄뿐이므로 여기 두고, 언어는 설정 파일과
/// Windows 표시 언어에서 읽는다(`settings::ui_language`).
fn ensure_tray(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if app.tray_by_id(TRAY_ID).is_some() {
            return;
        }
        let ko = crate::settings::ui_language() == "ko";
        let open_label = if ko { "Inkwell 열기" } else { "Open Inkwell" };
        let exit_label = if ko { "종료" } else { "Exit" };

        let Ok(open) = tauri::menu::MenuItem::with_id(&app, "tray-open", open_label, true, None::<&str>)
        else {
            return;
        };
        let Ok(sep) = tauri::menu::PredefinedMenuItem::separator(&app) else {
            return;
        };
        let Ok(quit) = tauri::menu::MenuItem::with_id(&app, "tray-exit", exit_label, true, None::<&str>)
        else {
            return;
        };
        let Ok(menu) = tauri::menu::Menu::with_items(&app, &[&open, &sep, &quit]) else {
            return;
        };

        let mut builder = tauri::tray::TrayIconBuilder::with_id(TRAY_ID)
            .tooltip("Inkwell")
            .menu(&menu)
            // 왼쪽 클릭은 창을 되살린다(원본: 아이콘 클릭·더블클릭·`열기` 모두 같은 길).
            // 메뉴는 오른쪽 클릭에만 뜬다.
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "tray-open" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(win) = restore_window(&app).await {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                        reconsider(&app);
                    });
                }
                "tray-exit" => {
                    // 원본 `TrayQuit`: 정말 끝낸다. 세션은 창이 닫힐 때 이미 쓰였고,
                    // 대기 중인 알림은 `reminders.tsv`에 남아 다음 실행에 `(놓침 …)`으로
                    // 돌아온다.
                    let app = app.clone();
                    let _ = app.clone().run_on_main_thread(move || app.exit(0));
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: tauri::tray::MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(win) = restore_window(&app).await {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                        reconsider(&app);
                    });
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        let _ = builder.build(&app);
    });
}

/// 창을 되살린다 — 트레이의 `열기`·아이콘 클릭·토스트 클릭·두 번째 실행이 쓴다.
///
/// 살아 있는 창이 있으면 그 창이다. **하나도 없으면 창을 만든다**: 역할이 `primary`라
/// 그 창의 `App`이 세션 파일을 읽어 복원한다 — 갓 실행한 것과 똑같은 길이다
/// (원본 `AppRestoreWindow`가 `CreateMainWindow` + `SessionRestore`로 한 일).
pub async fn restore_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(win) = winmgr::target_window(app) {
        return Some(win);
    }
    let label = winmgr::window_create(
        app.clone(),
        winmgr::WindowSpec {
            role: winmgr::Role::Primary,
            record: None,
            tint: None,
            empty: false,
            rect: None,
            maximized: false,
        },
    )
    .await
    .ok()?;
    app.get_webview_window(&label)
}

/// 알림 소리. 원본은 `MessageBeep(MB_ICONASTERISK)`(= Windows의 "알림" 소리)를 썼다 —
/// 셸 풍선을 우리 카드로 바꾼 뒤 소리는 직접 내야 했다. 추가 라이브러리가 필요 없다.
#[cfg(windows)]
fn beep() {
    use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
    use windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONASTERISK;
    // SAFETY: 인자 하나짜리 순수 호출.
    unsafe {
        MessageBeep(MB_ICONASTERISK);
    }
}

#[cfg(not(windows))]
fn beep() {}

/// 작업 표시줄 깜빡임 — **열린 창이 있을 때만**(원본 `ReminderFire`). 카드는 화면
/// 구석에 뜨고, 창이 다른 창에 가려져 있을 때 눈이 가는 곳은 작업 표시줄 버튼이다.
#[cfg(windows)]
fn flash_taskbar(app: &AppHandle) {
    use std::ffi::c_void;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FlashWindowEx, FLASHWINFO, FLASHW_ALL, FLASHW_TIMERNOFG,
    };

    let Some(win) = winmgr::target_window(app) else {
        return;
    };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    let Ok(handle) = win.hwnd() else {
        return;
    };
    let info = FLASHWINFO {
        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
        hwnd: handle.0 as isize as *mut c_void,
        dwFlags: FLASHW_ALL | FLASHW_TIMERNOFG,
        uCount: 5,
        dwTimeout: 0,
    };
    // SAFETY: 우리가 채운 구조체를 읽기만 한다. 핸들은 방금 살아 있다고 확인한 창의 것이다.
    unsafe {
        FlashWindowEx(&info);
    }
}

#[cfg(not(windows))]
fn flash_taskbar(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 카드는_오른쪽_아래에서_위로_쌓인다() {
        // 1920×1080에 아래 48px 작업 표시줄, 배율 1.
        let sizes = [(300, 90), (300, 120)];
        let spots = stack_positions(0, 0, 1920, 1032, 16, 8, &sizes);
        // 새 카드([1])가 맨 아래, 오래된 것([0])이 위로 밀린다.
        assert_eq!(spots[1], (1920 - 16 - 300, 1032 - 16 - 120));
        assert_eq!(spots[0], (1920 - 16 - 300, 1032 - 16 - 120 - 8 - 90));
    }

    #[test]
    fn 모니터_원점이_0이_아니어도_맞는다() {
        // 왼쪽에 붙은 둘째 모니터처럼 음수 원점.
        let spots = stack_positions(-1920, -200, 1920, 1000, 16, 8, &[(300, 90)]);
        assert_eq!(spots[0], (-1920 + 1920 - 16 - 300, -200 + 1000 - 16 - 90));
    }

    #[test]
    fn 위로_넘치면_작업_영역_위에서_멈춘다() {
        // 작업 영역보다 높은 카드 둘 — 화면 밖으로 나가지 않는다.
        let spots = stack_positions(0, 0, 800, 200, 16, 8, &[(300, 150), (300, 150)]);
        assert_eq!(spots[0].1, 0);
        assert!(spots[1].1 >= 0);
    }

    #[test]
    fn 토스트_라벨은_창으로_세지_않는다() {
        assert!(is_toast_label("inkwell-toast-1"));
        assert!(!is_toast_label("main"));
        assert!(!is_toast_label("win2"));
        assert!(!crate::winmgr::is_main_label("inkwell-toast-1"));
    }
}
