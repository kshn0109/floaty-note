//! Windows **종료·로그오프·재시작**(`WM_QUERYENDSESSION` / `WM_ENDSESSION`).
//!
//! **왜 필요한가.** tao(0.37)는 `WM_QUERYENDSESSION`을 아예 처리하지 않고
//! (`event_loop.rs`에 "We don't process `WM_QUERYENDSESSION` yet"라는 주석과 함께
//! 주석 처리돼 있다) `DefWindowProcW`로 흘려보낸다 — 그래서 Windows 종료 때 창에는
//! `WM_CLOSE`가 오지 않고 `onCloseRequested`도 돌지 않는다. 그다음 `WM_ENDSESSION`은
//! tao의 **숨은 창**(`Tao Thread Event Target` — 보이지 않지만 최상위 창이라 세션
//! 종료 메시지를 받는다)에서 `std::process::exit(0)`로 이어진다. 결과:
//!
//!   * 종료가 저장 확인 대화상자에 막히지는 않는다(묻는 길 자체가 돌지 않는다).
//!   * 그러나 **세션을 쓸 틈도 없다** — 프론트의 디바운스 쓰기(1.5초) 뒤에 친 글은
//!     사라진다. 원본 Win32 버전은 `WM_QUERYENDSESSION`에서 직접 세션을 썼다.
//!
//! **그래서 하는 일 셋.**
//!   1. `WM_QUERYENDSESSION`을 받으면 "세션 종료 중" 깃발을 세우고(`session_ending`)
//!      모든 메인 창에 `SESSION_ENDING_EVENT`를 보낸다 — 프론트는 그걸 받아 **묻지 않고**
//!      곧바로 세션을 쓰고 `session_ending_flushed`로 알린다. 깃발은 그 뒤에 들어오는
//!      닫기 요청을 `trigger: "app"`처럼(= 묻지 않게) 다루는 데도 쓴다.
//!   2. 메시지는 흘려보낸다(`TRUE`) — 종료를 막지 않는다(메모장과 같다).
//!   3. `WM_ENDSESSION`에서는 tao의 `exit(0)`로 넘어가기 **전에** 그 쓰기가 끝날
//!      때까지 짧게(최대 2초) 메시지를 돌리며 기다린다. 메시지를 돌려야 하는 이유:
//!      WebView2에서 오는 IPC(= 세션 쓰기 커맨드)가 메인 스레드의 메시지 큐로 들어온다
//!      — 그냥 블록하면 영원히 못 받는다.
//!
//! **구현 수단.** `SetWindowLongPtrW(GWLP_WNDPROC)`로 창 프로시저를 앞에 끼운다
//! (comctl32의 `SetWindowSubclass`를 쓰면 `Win32_UI_Shell` 기능이 더 필요하다).
//! `windows-sys`의 날것 FFI만 쓰고 **Win10/11 공통 API**뿐이다 — Win11 전용은 없다.
//! `WM_ENDSESSION`은 프로세스의 **모든** 최상위 창에 가고 **어느 창이 먼저 받는지는
//! 정해져 있지 않다**. 그래서 깃발을 세우는 순간 `EnumThreadWindows`로 그 스레드의
//! 창을 모두 끼워 둔다 — tao의 숨은 창이 먼저 받으면 기다림 없이 `exit(0)`로 들어가
//! 쓰기가 끊기고, 알림 카드·고스트 창도 같은 길이다.

//!
//! ## 예외 — `새 세션` 설정에서 저장 안 된 글이 있으면 **묻는다**
//!
//! 사용자 결정(2026-11-12): `이전 세션 복원`이면 지금처럼 묻지 않고 보관하지만,
//! `새 세션 시작 및 저장되지 않은 변경 내용 삭제`로 쓰는데 **보이는 미저장 탭이
//! 하나라도** 있으면 메모장처럼 묻는다 — 그 설정에서는 종료가 곧 "버림"이라 묻지 않고
//! 지나가면 글이 정말 사라진다.
//!
//! `WM_QUERYENDSESSION`은 **동기적으로** 답해야 하므로(이벤트를 보내고 프론트의 답을
//! 기다릴 수 없다) 프론트가 상태가 바뀔 때마다 창별로 `set_shutdown_prompt(needed)`로
//! "이 창은 물어야 한다"를 미리 보고해 둔다. 메시지가 오면 그 깃발만 보고 Windows 표준
//! 방식대로:
//!
//!   1. `ShutdownBlockReasonCreate`로 **이유를 등록**한다 — Windows의 "이 앱이 종료를
//!      막고 있습니다" 화면에 그 문구가 뜬다(Win10/11 공통).
//!   2. 그 창을 앞으로 올리고 `SESSION_ENDING_ASK_EVENT`를 보낸다 — 프론트는 평소
//!      `새 세션` 닫기(`askThenDiscard`: 탭마다 저장/저장 안 함/취소)를 그대로 돌린다.
//!   3. **`FALSE`를 돌려준다** — 종료가 보류되고 Windows가 사용자에게 선택을 준다.
//!      `ENDING` 깃발은 세우지 않는다(종료가 진행되는 것이 아니다).
//!
//! 사용자가 다 답하면 프론트가 `session_ending_answered`로 알리고 거기서
//! `ShutdownBlockReasonDestroy`를 부른다. Windows가 "그래도 다시 시작"을 고르면
//! `WM_ENDSESSION(TRUE)`가 오고, 그때는 **묻지 않고** 기존 길(= `새 세션`이면 버림)로
//! 끝낸다. 같은 물음이 짧게 여러 번 올 수 있어 묻는 중이면 다시 띄우지 않는다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Windows가 세션을 끝내려 한다(종료·로그오프·재시작) — 묻지 말고 보관하고 닫으라.
/// 페이로드는 `true`(종료 중) / `false`(취소됐다).
pub const SESSION_ENDING_EVENT: &str = "inkwell://session-ending";
/// 종료를 **보류**했다 — 평소 `새 세션` 닫기처럼 탭마다 묻고, 끝나면
/// `session_ending_answered`로 알려라.
pub const SESSION_ENDING_ASK_EVENT: &str = "inkwell://session-ending-ask";

/// `WM_QUERYENDSESSION`을 받았는가. 닫기 판정이 **동기적으로** 물어볼 수 있어야 해서
/// 깃발로 둔다(이벤트가 프론트에 닿기 전에 닫기 요청이 먼저 올 수 있다).
static ENDING: AtomicBool = AtomicBool::new(false);
/// 프론트가 세션 쓰기를 끝냈다고 알렸는가(`WM_ENDSESSION`의 기다림이 보는 값).
static FLUSHED: AtomicBool = AtomicBool::new(false);

/// 창별 "종료 때 물어야 한다"(`새 세션` + 보이는 미저장 탭 ≥ 1). 창은 많아야 몇 개라
/// 벡터로 충분하고 `Vec::new()`가 const라 락을 그냥 둘 수 있다(`HashMap::new`는 아니다).
static PROMPT: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());

/// 지금 Windows 세션이 끝나는 중인가 — 닫기 판정(`closing.ts`)이 묻는다.
#[tauri::command]
pub fn session_ending() -> bool {
    ENDING.load(Ordering::SeqCst)
}

/// 프론트가 세션 쓰기를 끝냈다. `WM_ENDSESSION`에서 기다리던 쪽이 이 값을 본다.
#[tauri::command]
pub fn session_ending_flushed() {
    FLUSHED.store(true, Ordering::SeqCst);
}

/// 이 창은 Windows 종료 때 **물어야 하는가**. 프론트가 상태가 바뀔 때마다(미저장 변화 ·
/// 탭 추가·닫기 · 시작 설정 변경 · 창 생성) 보고한다 — `WM_QUERYENDSESSION`이 기다릴
/// 틈 없이 동기적으로 봐야 하는 값이다.
#[tauri::command]
pub fn set_shutdown_prompt(window: tauri::Window, needed: bool) {
    let label = window.label().to_string();
    let mut flags = PROMPT.lock().unwrap_or_else(|e| e.into_inner());
    match flags.iter_mut().find(|(l, _)| *l == label) {
        Some(slot) => slot.1 = needed,
        None => flags.push((label, needed)),
    }
}

/// 그 창을 목록에서 뺀다 — 창이 사라졌다(`WindowEvent::Destroyed`).
///
/// 묻던 창이 닫힌 것이기도 하다(`새 세션`의 닫기는 창을 부순다) — 그래서 "답했다"로도
/// 센다. 프론트의 `session_ending_answered`는 창이 부서진 뒤에는 닿지 못한다.
pub fn forget(label: &str) {
    {
        let mut flags = PROMPT.lock().unwrap_or_else(|e| e.into_inner());
        flags.retain(|(l, _)| l != label);
    }
    #[cfg(windows)]
    win::answered(label);
}

/// 어느 창에 물어야 하는가 — **살아 있는 창**의 깃발만 본다(순수 함수: 시험용).
///
/// 돌려주는 순서는 보고된 순서 그대로다: 첫 창이 종료 보류 이유를 등록하고 앞으로
/// 올라가는 창이며, 나머지 창도 함께 묻는다(설정은 앱 전역이라 사실상 전부 같은 모드다).
pub fn labels_to_ask(flags: &[(String, bool)], live: &[String]) -> Vec<String> {
    flags
        .iter()
        .filter(|(label, needed)| *needed && live.iter().any(|l| l == label))
        .map(|(label, _)| label.clone())
        .collect()
}

/// 종료 보류 이유에 적을 문구 — 영어 UI면 영어로(`settings::ui_language`).
fn block_reason() -> &'static str {
    if crate::settings::ui_language() == "ko" {
        "저장되지 않은 변경 내용이 있습니다"
    } else {
        "You have unsaved changes"
    }
}

/// 프론트가 묻기를 끝냈다(저장·버림·취소 어느 쪽이든) — 종료 보류 이유를 지운다.
/// 모든 창이 답했을 때만 지운다(창이 여럿이면 각자 답한다).
#[tauri::command]
pub fn session_ending_answered(window: tauri::Window) {
    #[cfg(windows)]
    win::answered(window.label());
    #[cfg(not(windows))]
    let _ = window;
}

/// 이 창에 종료 메시지 가로채기를 끼운다 — 창마다 한 번(`window_boot`).
#[cfg(windows)]
pub fn install(window: &tauri::Window) {
    use tauri::Manager;
    let _ = win::APP.set(window.app_handle().clone());
    if let Ok(handle) = window.hwnd() {
        win::subclass(handle.0 as isize);
    }
}

#[cfg(not(windows))]
pub fn install(window: &tauri::Window) {
    let _ = window;
}

#[cfg(windows)]
mod win {
    use super::{
        block_reason, labels_to_ask, ENDING, FLUSHED, PROMPT, SESSION_ENDING_ASK_EVENT,
        SESSION_ENDING_EVENT,
    };
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Shutdown::{
        ShutdownBlockReasonCreate, ShutdownBlockReasonDestroy,
    };
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, DispatchMessageW, EnumThreadWindows, GWLP_WNDPROC, MSG,
        PM_REMOVE, PeekMessageW, SetForegroundWindow, SetWindowLongPtrW, TranslateMessage,
        WM_ENDSESSION, WM_QUERYENDSESSION, WNDPROC,
    };

    pub(super) static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /// 끼워 둔 창과 **원래** 프로시저(`(hwnd, proc)`, 둘 다 `isize`로 들고 있다).
    /// 창은 많아야 몇 개라 벡터로 충분하고, `Vec::new()`가 const라 락을 그냥 둘 수 있다.
    static HOOKED: Mutex<Vec<(isize, isize)>> = Mutex::new(Vec::new());
    /// `WM_ENDSESSION`을 기다리는 창이 이미 있는가(다른 창이 그 사이에 tao의
    /// `exit(0)`로 들어가지 않게 막는 깃발).
    static WAITING: AtomicBool = AtomicBool::new(false);
    /// 아직 답하지 않은 창(종료를 보류하고 묻는 중). 비어 있지 않으면 **묻는 중**이고,
    /// 그때 다시 오는 `WM_QUERYENDSESSION`은 대화상자를 또 띄우지 않고 `FALSE`만 준다.
    static ASKING: Mutex<Vec<String>> = Mutex::new(Vec::new());
    /// 종료 보류 이유를 등록해 둔 창(0이면 없다) — `ShutdownBlockReasonDestroy`가 쓴다.
    static BLOCKED: AtomicIsize = AtomicIsize::new(0);

    pub(super) fn subclass(hwnd: isize) {
        if hwnd == 0 {
            return;
        }
        let mut hooked = HOOKED.lock().unwrap_or_else(|e| e.into_inner());
        if hooked.iter().any(|(h, _)| *h == hwnd) {
            return;
        }
        // SAFETY: 살아 있는 창 핸들에 우리 프로시저를 끼우고 원래 것을 보관한다.
        // 되돌리지 않는다 — 프로세스가 끝날 때까지 쓰는 가로채기다.
        // 함수 항목을 바로 정수로 캐스팅하면 경고가 난다 — 함수 포인터로 한 번 묶는다.
        let proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT = hook;
        let prev =
            unsafe { SetWindowLongPtrW(hwnd as *mut c_void, GWLP_WNDPROC, proc as usize as isize) };
        if prev == 0 {
            return;
        }
        hooked.push((hwnd, prev));
    }

    fn prev_proc(hwnd: isize) -> WNDPROC {
        let found = {
            let hooked = HOOKED.lock().unwrap_or_else(|e| e.into_inner());
            hooked.iter().find(|(h, _)| *h == hwnd).map(|(_, p)| *p)
        };
        // SAFETY: `SetWindowLongPtrW`가 돌려준 값은 창 프로시저 포인터다.
        found.map(|p| unsafe { std::mem::transmute::<isize, WNDPROC>(p) }).flatten()
    }

    unsafe extern "system" fn hook(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            // 세션을 끝내도 되겠냐는 물음.
            //
            //   * `새 세션` + 미저장 탭이 있는 창이 있으면 **막는다**(`FALSE`): 이유를
            //     등록하고 그 창을 앞으로 올려 묻는다. 깃발은 세우지 않는다.
            //   * 이미 묻는 중이면 대화상자를 또 띄우지 않고 `FALSE`만 준다.
            //   * 그 밖에는 전처럼 흘려보낸다(`TRUE`) — 묻지 않고 보관하고 끝낸다.
            WM_QUERYENDSESSION => {
                if !ENDING.load(Ordering::SeqCst) {
                    if asking() {
                        return 0;
                    }
                    if ask() {
                        return 0;
                    }
                }
                begin();
            }
            WM_ENDSESSION => {
                if wparam != 0 {
                    // "그래도 다시 시작"을 골랐다(또는 애초에 막지 않았다) — 묻기를
                    // 접고 기존 길로 끝낸다(`새 세션`이면 버린다).
                    unblock();
                    begin();
                    if WAITING.swap(true, Ordering::SeqCst) {
                        // 다른 창이 이미 세션 쓰기를 기다리는 중이다. 여기서 아래로
                        // 넘기면 tao가 `exit(0)`를 불러 그 쓰기가 끊긴다.
                        return 0;
                    }
                    wait_for_flush();
                    WAITING.store(false, Ordering::SeqCst);
                } else {
                    // 종료가 취소됐다 — 평소 규칙으로 돌아간다.
                    unblock();
                    ENDING.store(false, Ordering::SeqCst);
                    FLUSHED.store(false, Ordering::SeqCst);
                    notify(false);
                }
            }
            _ => {}
        }
        match prev_proc(hwnd as isize) {
            // SAFETY: 원래 프로시저에 받은 그대로 넘긴다.
            Some(prev) => unsafe {
                CallWindowProcW(Some(prev), hwnd, msg, wparam, lparam)
            },
            None => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    /// 깃발을 세우고(**한 번만**) 창을 전부 끼운 뒤 프론트에 알린다.
    fn begin() {
        if ENDING.swap(true, Ordering::SeqCst) {
            return;
        }
        FLUSHED.store(false, Ordering::SeqCst);
        hook_thread_windows();
        notify(true);
        #[cfg(debug_assertions)]
        eprintln!("[Inkwell] WM_QUERYENDSESSION — 세션 종료 중(묻지 않는다)");
    }

    /// 지금 묻는 중인가(답을 기다리는 창이 남아 있다).
    fn asking() -> bool {
        !ASKING.lock().unwrap_or_else(|e| e.into_inner()).is_empty()
    }

    /// 종료를 **보류하고 묻는다**. 물을 창이 없으면 `false`(그러면 전처럼 흘려보낸다).
    ///
    /// 첫 창에 `ShutdownBlockReasonCreate`로 이유를 등록하고 그 창을 앞으로 올린 뒤,
    /// 물어야 하는 모든 창에 `SESSION_ENDING_ASK_EVENT`를 보낸다.
    fn ask() -> bool {
        use tauri::{Emitter, Manager};
        let Some(app) = APP.get() else { return false };
        let live = app.state::<crate::winmgr::Windows>().order();
        let labels = {
            let flags = PROMPT.lock().unwrap_or_else(|e| e.into_inner());
            labels_to_ask(&flags, &live)
        };
        let Some(first) = labels.first() else { return false };

        if let Some(win) = app.get_webview_window(first) {
            if let Ok(handle) = win.hwnd() {
                let hwnd = handle.0 as *mut c_void;
                let mut reason: Vec<u16> = block_reason().encode_utf16().collect();
                reason.push(0);
                // SAFETY: 살아 있는 창 핸들과 NUL로 끝나는 UTF-16 문자열. 둘 다 Win10/11
                // 공통 API이고 권한도 필요 없다.
                unsafe {
                    ShutdownBlockReasonCreate(hwnd, reason.as_ptr());
                    SetForegroundWindow(hwnd);
                }
                BLOCKED.store(hwnd as isize, Ordering::SeqCst);
            }
            let _ = win.unminimize();
            let _ = win.set_focus();
        }

        {
            let mut asking = ASKING.lock().unwrap_or_else(|e| e.into_inner());
            *asking = labels.clone();
        }
        for label in &labels {
            let _ = app.emit_to(label.as_str(), SESSION_ENDING_ASK_EVENT, true);
        }
        #[cfg(debug_assertions)]
        eprintln!("[Inkwell] WM_QUERYENDSESSION — 미저장 변경이 있어 종료를 보류하고 묻는다({labels:?})");
        true
    }

    /// 그 창이 답했다 — 모두 답했으면 종료 보류 이유를 지운다.
    pub(super) fn answered(label: &str) {
        let left = {
            let mut asking = ASKING.lock().unwrap_or_else(|e| e.into_inner());
            asking.retain(|l| l != label);
            asking.len()
        };
        if left == 0 {
            unblock();
        }
    }

    /// 등록해 둔 종료 보류 이유를 지우고 묻기를 접는다(여러 번 불려도 괜찮다).
    fn unblock() {
        ASKING.lock().unwrap_or_else(|e| e.into_inner()).clear();
        let hwnd = BLOCKED.swap(0, Ordering::SeqCst);
        if hwnd != 0 {
            // SAFETY: 우리가 `ShutdownBlockReasonCreate`를 부른 그 창 핸들이다.
            unsafe {
                ShutdownBlockReasonDestroy(hwnd as *mut c_void);
            }
        }
    }

    /// 이 스레드의 창을 모두 끼운다(알림 카드·고스트까지) — 이유는 모듈 주석.
    fn hook_thread_windows() {
        unsafe extern "system" fn each(hwnd: HWND, _: LPARAM) -> windows_sys::core::BOOL {
            subclass(hwnd as isize);
            1
        }
        // SAFETY: 콜백은 이 프로세스의 창만 받는다.
        unsafe {
            EnumThreadWindows(GetCurrentThreadId(), Some(each), 0);
        }
    }

    fn notify(ending: bool) {
        let Some(app) = APP.get() else { return };
        use tauri::{Emitter, Manager};
        for label in app.state::<crate::winmgr::Windows>().order() {
            let _ = app.emit_to(label.as_str(), SESSION_ENDING_EVENT, ending);
        }
    }

    /// 프론트의 세션 쓰기가 끝날 때까지 메시지를 돌리며 기다린다(최대 2초).
    ///
    /// Windows는 `WM_ENDSESSION` 처리에 시간을 무한히 주지 않으므로(기본 5초대)
    /// 상한을 두고, 못 기다렸으면 그냥 넘어간다 — 그때도 디바운스로 써 둔 직전
    /// 세션은 디스크에 멀쩡히 있다(쓰기는 임시 파일 → rename이다).
    fn wait_for_flush() {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(2000);
        while !FLUSHED.load(Ordering::SeqCst) {
            if Instant::now() >= deadline {
                break;
            }
            pump();
            std::thread::sleep(Duration::from_millis(5));
        }
        // 마지막 응답까지 비워 준다.
        pump();
        #[cfg(debug_assertions)]
        eprintln!(
            "[Inkwell] 세션 종료: 쓰기 대기 {}ms (끝났나={})",
            start.elapsed().as_millis(),
            FLUSHED.load(Ordering::SeqCst)
        );
    }

    /// 큐에 쌓인 메시지를 한 바퀴 돌린다. 종료 메시지는 **버린다** — 이미 우리가
    /// 처리하는 중이고, 여기서 다시 넘기면 tao의 `exit(0)`로 들어간다.
    fn pump() {
        // SAFETY: 메시지 루프 한 바퀴. 메인 스레드에서만 불린다(창 프로시저 안).
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUERYENDSESSION || msg.message == WM_ENDSESSION {
                    continue;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::labels_to_ask;

    fn flags(pairs: &[(&str, bool)]) -> Vec<(String, bool)> {
        pairs.iter().map(|(l, n)| ((*l).to_string(), *n)).collect()
    }

    fn live(labels: &[&str]) -> Vec<String> {
        labels.iter().map(|l| (*l).to_string()).collect()
    }

    #[test]
    fn 물을_창이_없으면_비어_있다() {
        assert!(labels_to_ask(&flags(&[("main", false)]), &live(&["main"])).is_empty());
        assert!(labels_to_ask(&[], &live(&["main"])).is_empty());
    }

    #[test]
    fn 깃발이_선_창만_보고된_순서로_나온다() {
        let f = flags(&[("main", true), ("win2", false), ("win3", true)]);
        assert_eq!(
            labels_to_ask(&f, &live(&["main", "win2", "win3"])),
            vec!["main".to_string(), "win3".to_string()]
        );
    }

    #[test]
    fn 사라진_창의_깃발은_무시한다() {
        // 창이 닫혔는데 보고가 남아 있으면 종료를 영원히 막는다.
        let f = flags(&[("win9", true), ("main", true)]);
        assert_eq!(labels_to_ask(&f, &live(&["main"])), vec!["main".to_string()]);
        assert!(labels_to_ask(&f, &live(&[])).is_empty());
    }
}
