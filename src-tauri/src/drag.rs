//! 탭 떼어내기의 **고스트 탭**과 전역 커서 추적 (§5, 시안 TD의 떠다니는 칩).
//!
//! ## 왜 별도 창인가
//!
//! 고스트는 **창 밖에서도** 커서를 따라다녀야 한다. HTML5 drag & drop은 창(프로세스)
//! 경계를 넘지 못하고, DOM 요소는 자기 창의 사각형을 벗어날 수 없다. 그래서 고스트는
//! 작은 투명·항상 맨 위·포커스를 받지 않는 **자기 창**이다(원본 Win32 설계의
//! `InkwellGhost`와 같은 자리).
//!
//! ## 왜 Rust가 커서를 읽는가
//!
//! 끌고 있는 창의 포인터 이벤트로 고스트를 옮기면 움직임 한 번마다 IPC 왕복이 생겨
//! 고스트가 커서를 뒤따라온다. 여기서는 `overlay.rs`와 같은 방식으로 16ms마다 커서를
//! 읽어 **Rust가 직접** 고스트 창을 옮기고, 끌고 있는 창에는 좌표만 알린다
//! (그 창은 그 좌표로 "어디에 놓이는가"를 판정한다 — 판정은 `src/lib/tearoff.ts`).
//!
//! ## 끌기가 끝나는 판정은 프론트가 한다
//!
//! 버튼이 떨어진 순간은 포인터 캡처가 붙은 창의 `pointerup`이 가장 정확하다. 여기서
//! `GetAsyncKeyState`로 한 번 더 읽지 않는 이유는, 두 곳이 같은 사건을 판정하면
//! "두 번 놓기"를 막는 코드가 필요해지고 그 코드가 틀리면 탭이 복제되기 때문이다.
//!
//! ## 고스트 창은 한 번만 만들고 재사용한다
//!
//! WebView2 창 하나를 만드는 데 눈에 보이는 시간이 들기 때문에, **처음 떼어낼 때** 만들고
//! 그 뒤로는 끌기가 끝날 때 화면 밖으로 치워 둔다(숨기지 않는다 — `show()`는 Windows에서
//! 창을 활성화해 끌고 있는 창의 포인터 캡처를 끊을 수 있다).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};

use crate::winmgr::GHOST_LABEL;

/// 고스트 페이지가 그릴 값(이름·색)을 받는 이벤트. 모양은 프론트가 정한다.
pub const GHOST_PAINT_EVENT: &str = "inkwell://ghost-paint";
/// 끌고 있는 창에 커서 위치(화면 물리 픽셀)를 알리는 이벤트.
pub const DRAG_MOVE_EVENT: &str = "inkwell://drag-move";

/// 폴링 주기 — `overlay.rs`와 같은 16ms(≈60Hz).
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// 끌기가 끝났을 때 고스트를 치워 두는 자리. 어느 모니터에도 없는 좌표다.
const PARK: i32 = -32000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostSpec {
    /// 고스트 창 크기(물리 픽셀) — 끌고 있는 알약의 크기 그대로.
    pub w: u32,
    pub h: u32,
    /// 누른 자리의 **알약 안 상대 좌표**(물리 픽셀). 커서 아래 그 자리에 그대로 떠 있게 한다.
    pub grab_x: i32,
    pub grab_y: i32,
    /// 고스트 페이지가 그릴 값(이름·미저장·색 점·팔레트 색).
    pub paint: Value,
}

#[derive(Default)]
struct Inner {
    generation: AtomicU64,
    active: AtomicBool,
    /// 마지막으로 보낸 그림 값. 고스트 페이지가 뜨자마자 한 번 가져간다(이벤트가
    /// 리스너보다 먼저 가면 사라지기 때문).
    paint: Mutex<Option<Value>>,
}

#[derive(Default, Clone)]
pub struct Drag(Arc<Inner>);

/// 고스트 창을 만들거나 이미 있는 것을 돌려준다.
async fn ensure_ghost(app: &AppHandle, source: &str) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(GHOST_LABEL) {
        return Ok(win);
    }
    let builder = WebviewWindowBuilder::new(app, GHOST_LABEL, WebviewUrl::App("ghost.html".into()));
    #[cfg(debug_assertions)]
    let builder = crate::session::with_webview_data_dir(builder);
    let win = builder
        .title("Floaty Note")
        .inner_size(160.0, 26.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .position(f64::from(PARK), f64::from(PARK))
        .build()
        .map_err(|e| format!("고스트 창을 만들 수 없습니다: {e}"))?;
    // 마우스는 절대 받지 않는다 — 고스트가 자기 자신을 드롭 대상으로 가로채지 않게
    // (원본 설계 R14가 `WindowFromPoint`로 겪을까 걱정한 그 문제를 아예 없앤다).
    let _ = win.set_ignore_cursor_events(true);
    // `focused(false)`로 만들었지만, 혹시 활성화를 가져갔으면 되돌린다 —
    // 끌고 있는 창이 포인터 캡처를 잃으면 끌기가 그 자리에서 끊긴다.
    if let Some(src) = app.get_webview_window(source) {
        if !src.is_focused().unwrap_or(true) {
            let _ = src.set_focus();
        }
    }
    Ok(win)
}

/// 끌기 시작 — 고스트를 커서 아래에 세우고 커서 추적을 켠다.
#[tauri::command]
pub async fn drag_begin(app: AppHandle, window: Window, spec: GhostSpec) -> Result<(), String> {
    let source = window.label().to_string();
    let ghost = ensure_ghost(&app, &source).await?;

    {
        let state = app.state::<Drag>();
        if let Ok(mut slot) = state.0.paint.lock() {
            *slot = Some(spec.paint.clone());
        }
    }
    let _ = app.emit_to(GHOST_LABEL, GHOST_PAINT_EVENT, spec.paint.clone());
    let _ = ghost.set_size(PhysicalSize::new(spec.w.max(1), spec.h.max(1)));
    if let Ok(c) = app.cursor_position() {
        let _ = ghost.set_position(PhysicalPosition::new(
            c.x.round() as i32 - spec.grab_x,
            c.y.round() as i32 - spec.grab_y,
        ));
    }

    let drag = app.state::<Drag>().inner().clone();
    let generation = drag.0.generation.fetch_add(1, Ordering::SeqCst) + 1;
    drag.0.active.store(true, Ordering::SeqCst);
    spawn_tracker(app.clone(), source, ghost, drag, generation, spec);
    Ok(())
}

/// 끌기 끝(놓았거나 Esc). 추적을 멈추고 고스트를 화면 밖으로 치운다.
#[tauri::command]
pub fn drag_end(state: tauri::State<'_, Drag>) {
    state.0.active.store(false, Ordering::SeqCst);
    state.0.generation.fetch_add(1, Ordering::SeqCst);
}

/// 고스트 페이지가 뜨자마자 한 번 묻는다 — 리스너를 붙이기 전에 간 그림 값을 받는다.
#[tauri::command]
pub fn ghost_paint(state: tauri::State<'_, Drag>) -> Option<Value> {
    state.0.paint.lock().ok().and_then(|slot| slot.clone())
}

fn spawn_tracker(
    app: AppHandle,
    source: String,
    ghost: WebviewWindow,
    drag: Drag,
    generation: u64,
    spec: GhostSpec,
) {
    std::thread::spawn(move || {
        let mut last = (i32::MIN, i32::MIN);
        loop {
            if !drag.0.active.load(Ordering::SeqCst)
                || drag.0.generation.load(Ordering::SeqCst) != generation
            {
                break;
            }
            if let Ok(c) = app.cursor_position() {
                let x = c.x.round() as i32;
                let y = c.y.round() as i32;
                if (x, y) != last {
                    last = (x, y);
                    if ghost
                        .set_position(PhysicalPosition::new(x - spec.grab_x, y - spec.grab_y))
                        .is_err()
                    {
                        // 고스트가 사라졌다(앱이 닫히는 중) — 스레드도 끝낸다.
                        return;
                    }
                    let _ = app.emit_to(source.as_str(), DRAG_MOVE_EVENT, [x, y]);
                }
            }
            std::thread::sleep(POLL_INTERVAL);
        }
        let _ = ghost.set_position(PhysicalPosition::new(PARK, PARK));
    });
}
