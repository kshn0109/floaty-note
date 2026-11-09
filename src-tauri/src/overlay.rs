//! 오버레이 모드의 픽셀 단위 클릭 통과.
//!
//! 원본(Win32)은 레이어드 창 + 컬러키로 "컬러키 픽셀은 클릭 통과"를 공짜로 얻었지만,
//! WebView2 자식 창이 올라간 Tauri 창에서는 같은 수법을 쓸 수 없다. 대신 창 전체를
//! `WS_EX_TRANSPARENT`로 켜고 끄는 `set_ignore_cursor_events`를 **커서 위치에 따라**
//! 아주 빠르게 뒤집어 픽셀 단위처럼 보이게 한다.
//!
//! * 프론트(JS)가 "클릭을 잡아야 하는 영역" 사각형 목록을 보낸다
//!   (`set_overlay_hit_rects`). 좌표계는 **창 클라이언트 영역 기준 물리 픽셀** —
//!   JS가 CSS 픽셀에 `window.devicePixelRatio`를 곱해서 보낸다. Tauri의
//!   `inner_position()`도 클라이언트 영역의 물리 좌표라 둘이 바로 맞물린다.
//!   그래서 모니터마다 DPI가 다르거나 125/150%여도 보정이 따로 필요 없다.
//! * 여기서는 오버레이가 켜져 있는 동안만 백그라운드 스레드가 16ms 주기로 커서를 읽어
//!   사각형 안/밖을 판정하고, **상태가 바뀔 때만** `set_ignore_cursor_events`를 부른다.
//!
//! `WM_NCHITTEST` + `HTTRANSPARENT`는 쓰지 않는다 — 그건 같은 프로세스 안에서 히트를
//! 넘길 뿐이라 클릭이 다른 프로세스의 창으로 가지 않는다. 레이어드 colorkey도 WebView2와
//! 맞지 않는다(§6).
//!
//! ## 창마다 독립 (다중 창)
//!
//! 오버레이와 불투명도는 **창의 성질**이다(§5: "이 메모를 다른 앱 위에 어떻게 띄우는가"는
//! 메모 한 장의 성질). 그래서 사각형 목록·켜짐 여부·폴링 스레드가 전부 **라벨마다 하나**다.
//! 공유 상태 하나로 두면 창 A의 사각형으로 창 B의 클릭 통과를 판정한다.
//! 고스트 창(`winmgr::GHOST_LABEL`)은 애초에 `set_overlay`를 부르지 않으므로 여기 들어오지
//! 않는다 — 고스트는 `set_ignore_cursor_events(true)`로 영구 클릭 통과다(`drag.rs`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Window};

/// 폴링 주기. 16ms ≈ 60Hz — 커서가 빠르게 지나가도 한 프레임 안에 따라붙는다.
const POLL_INTERVAL: Duration = Duration::from_millis(16);

/// 오버레이 hover 외곽선의 켜짐/꺼짐을 프론트에 알리는 이벤트 이름.
const HOVER_EVENT: &str = "overlay-hover";

/// 클릭을 잡아야 하는 사각형 하나. 창 클라이언트 좌표, 물리 픽셀.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl HitRect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

#[derive(Default)]
struct Inner {
    rects: Mutex<Vec<HitRect>>,
    active: AtomicBool,
    /// 켜고 끄기를 빨리 반복해도 이전 스레드가 남아 돌지 않게 하는 세대 번호.
    generation: AtomicU64,
}

/// `tauri::Builder::manage`로 등록하는 공유 상태. **창 라벨마다 하나**를 들고 있다.
#[derive(Default)]
pub struct Overlay(Mutex<HashMap<String, Arc<Inner>>>);

impl Overlay {
    /// 그 창의 상태. 없으면 만든다.
    fn of(&self, label: &str) -> Arc<Inner> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        Arc::clone(map.entry(label.to_string()).or_default())
    }

    /// 창이 사라졌다 — 상태를 버리고 폴링 스레드를 은퇴시킨다.
    pub fn forget(&self, label: &str) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(inner) = map.remove(label) {
            inner.active.store(false, Ordering::SeqCst);
            inner.generation.fetch_add(1, Ordering::SeqCst);
        }
    }
}

/// 프론트가 계산한 사각형 목록을 갈아 끼운다.
/// 레이아웃·스크롤·리사이즈·입력·DPI 변경 때마다 다시 호출된다.
#[tauri::command]
pub fn set_overlay_hit_rects(
    rects: Vec<HitRect>,
    window: Window,
    state: tauri::State<'_, Overlay>,
) {
    let inner = state.of(window.label());
    if let Ok(mut slot) = inner.rects.lock() {
        *slot = rects;
    }
}

/// 오버레이 모드를 켜고 끈다. 켜면 항상 맨 위 + 커서 추적 시작,
/// 끄면 원래 창 순서로 돌리고 추적을 멈추고 클릭 통과를 해제한다.
#[tauri::command]
pub fn set_overlay(
    enabled: bool,
    window: Window,
    state: tauri::State<'_, Overlay>,
) -> Result<(), String> {
    let overlay = state.of(window.label());

    // 이전 세대의 추적 스레드를 먼저 은퇴시킨다.
    let generation = overlay.generation.fetch_add(1, Ordering::SeqCst) + 1;
    overlay.active.store(enabled, Ordering::SeqCst);

    window.set_always_on_top(enabled).map_err(|e| e.to_string())?;

    if enabled {
        spawn_tracker(window, overlay, generation);
    } else {
        if let Ok(mut slot) = overlay.rects.lock() {
            slot.clear();
        }
        // 오버레이를 끄면 hover 외곽선도 숨긴다. **그 창에만** 보낸다 — 전체에 보내면
        // 다른 창의 외곽선이 같이 꺼진다.
        let _ = window
            .app_handle()
            .emit_to(window.label(), HOVER_EVENT, false);
        window
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn spawn_tracker(window: Window, overlay: Arc<Inner>, generation: u64) {
    std::thread::spawn(move || {
        let app = window.app_handle().clone();
        let label = window.label().to_string();
        // 오버레이를 켠 직후의 실제 창 상태는 "클릭을 받는" 쪽이다.
        let mut ignoring = false;
        let mut hovering: Option<bool> = None;
        loop {
            if !overlay.active.load(Ordering::SeqCst)
                || overlay.generation.load(Ordering::SeqCst) != generation
            {
                break;
            }
            let probe = probe_cursor(&app, &window, &overlay);

            // hover 외곽선: 포인터가 창 사각형 안이면 켠다(글자 위가 아니어도).
            // 오버레이에서는 빈 곳에 마우스 이벤트가 오지 않으므로 여기서 판정해
            // **바뀔 때만** 프론트로 보낸다.
            if hovering != Some(probe.inside_window) {
                let _ = app.emit_to(label.as_str(), HOVER_EVENT, probe.inside_window);
                hovering = Some(probe.inside_window);
            }

            let want_ignore = !probe.inside_hit;
            if want_ignore != ignoring {
                if window.set_ignore_cursor_events(want_ignore).is_err() {
                    // 창이 사라졌다 — 스레드도 끝낸다.
                    return;
                }
                ignoring = want_ignore;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
        let _ = app.emit_to(label.as_str(), HOVER_EVENT, false);
        let _ = window.set_ignore_cursor_events(false);
    });
}

struct Probe {
    /// 커서가 창 사각형(클라이언트 영역 = 창 전체, decorations 없음) 안인지.
    inside_window: bool,
    /// 커서가 "클릭을 잡아야 하는" 사각형 위인지.
    inside_hit: bool,
}

/// 커서 위치를 한 번 읽어 두 판정을 같이 낸다. 좌표를 못 읽으면 클릭은 **잡는 쪽**으로
/// 답한다(실패가 창을 영구 클릭 통과 상태로 남기는 것보다 안전하다).
fn probe_cursor(app: &AppHandle, window: &Window, overlay: &Inner) -> Probe {
    let fallback = Probe {
        inside_window: false,
        inside_hit: true,
    };
    let Ok(cursor) = app.cursor_position() else {
        return fallback;
    };
    // inner_position: 클라이언트 영역 좌상단의 화면 물리 좌표. 커서도 물리 좌표라
    // 빼기만 하면 클라이언트 물리 좌표가 된다 — 멀티 모니터·혼합 DPI에서도 같다.
    let Ok(origin) = window.inner_position() else {
        return fallback;
    };
    let x = cursor.x - f64::from(origin.x);
    let y = cursor.y - f64::from(origin.y);

    let inside_window = match window.inner_size() {
        Ok(size) => x >= 0.0 && y >= 0.0 && x < f64::from(size.width) && y < f64::from(size.height),
        Err(_) => false,
    };
    let inside_hit = match overlay.rects.lock() {
        Ok(rects) => rects.iter().any(|r| r.contains(x, y)),
        Err(_) => true,
    };
    Probe {
        inside_window,
        inside_hit,
    }
}
