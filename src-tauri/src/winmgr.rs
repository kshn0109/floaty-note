//! 다중 창 — 창 목록 · 역할 · 탭 이전 · 놓을 자리(§5, MIGRATION_HANDOFF §7).
//!
//! **프로세스는 하나**다(§7). 창 N개는 모두 같은 프로세스의 WebviewWindow이고 전부
//! `index.html`(= 같은 `App`)을 띄운다. 그래서 창마다 자기 탭 목록·오버레이·불투명도를
//! 갖고, 테마·언어·설정은 한곳(`settings.json`)에 저장된 뒤 모든 창에 번져 나간다.
//!
//! 원본 Win32 설계(`NEXT_SESSION.md`「설계: 다중 창」)의 **보이지 않는 앱 창**에 해당하는
//! 자리가 여기다: 창이 몇 개든 "마지막으로 활성이던 창"·"탭이 도착할 창"·"놓을 자리"를
//! 아는 곳이 하나여야 하고, 그것을 창 하나에 매달면 그 창이 닫힐 때 답이 사라진다.
//!
//! ## 창이 자기 정체를 묻는 길 — `window_boot`
//!
//! 모든 창의 `App`은 **맨 처음 `window_boot`을 부른다.** 돌아오는 값이 그 창이 무엇인지
//! 말해 준다:
//!
//!   primary  앱이 시작할 때의 첫 창. **이 창만** 세션 파일을 읽고, 자기 것 하나를 쓰고
//!            나머지 창 기록을 `window_create`로 실제 창으로 만든다.
//!   restore  그 기록을 되살리기 위해 만들어진 창. `record`가 들어 있다.
//!   fresh    새 창(Ctrl+Shift+N) 또는 탭을 떼어내 만든 창. `empty`가 참이면 **빈 탭을
//!            만들지 않는다** — 떼어낸 탭이 곧 도착한다(원본의 `suppressFirstTab`).
//!
//! `boot`이 돌아올 때 그 창은 **ready**로 표시되고, 그 전에 도착한 탭 이전 꾸러미는
//! `arrivals`에 담겨 함께 돌아온다. 리스너를 붙인 **뒤에** `boot`을 부르므로 이전
//! 꾸러미가 사이로 빠지는 틈이 없다(이벤트로만 보내면 창이 뜨기 전에 사라진다).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};

/// `tauri.conf.json`이 만드는 첫 창의 라벨.
pub const MAIN_LABEL: &str = "main";
/// 떼어내기 고스트 탭의 창 라벨. **메인 창이 아니다** — 세션·오버레이·드롭 대상 어디에도
/// 끼지 않는다(지시 6: 고스트는 클릭 통과 대상에서 제외).
pub const GHOST_LABEL: &str = "inkwell-ghost";

/// 탭 하나가 그 창에 도착했다.
pub const TAB_ARRIVE_EVENT: &str = "inkwell://tab-arrive";
/// 끌고 있는 탭이 들어갈 자리를 그 창의 탭 줄에 표시하라(`null`이면 지워라).
pub const DROP_MARK_EVENT: &str = "inkwell://drop-mark";
/// 다른 창이 설정을 바꿨다 — 테마·언어·보기 토글을 즉시 따라가라.
pub const SETTINGS_EVENT: &str = "inkwell://settings";
/// `끝내기` — 모든 창이 자기 닫기 규칙(§5)을 돌린다.
pub const CLOSE_REQUEST_EVENT: &str = "inkwell://close-request";
/// **모든 창의 메모 목록**이 바뀌었다 — 창마다 `다른 창` 묶음을 다시 그린다.
pub const NOTES_EVENT: &str = "inkwell://notes";
/// 그 창의 그 탭을 활성으로 만들어라(메모 목록에서 다른 창의 메모를 눌렀을 때).
pub const ACTIVATE_TAB_EVENT: &str = "inkwell://activate-tab";

/// 이 라벨이 **메인 창**(`App`을 그리는 창)인가.
///
/// 고스트 탭과 **알림 토스트 카드**는 아니다. 토스트를 창으로 세면 "창이 하나도 없다"가
/// 영원히 거짓이 되어 트레이 상주 종료 판단이 멈춘다(MIGRATION_HANDOFF §7).
pub fn is_main_label(label: &str) -> bool {
    label != GHOST_LABEL && !crate::toast::is_toast_label(label)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Primary,
    Restore,
    Fresh,
}

/// 물리 픽셀 바깥 사각형. 세션이 저장하는 것과 같은 좌표계다.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// 창 하나를 만들 때 정해지는 것. `window_boot`이 그대로 돌려준다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSpec {
    pub role: Role,
    /// `restore`일 때 되살릴 세션 기록(모양은 프론트의 `SessionWindow`).
    #[serde(default)]
    pub record: Option<Value>,
    /// `fresh`일 때 첫 탭이 물려받을 메모지 색(§5: 새 탭은 현재 탭 색을 물려받는다).
    #[serde(default)]
    pub tint: Option<String>,
    /// 참이면 빈 탭을 만들지 않는다(떼어낸 탭이 곧 도착한다).
    #[serde(default)]
    pub empty: bool,
    #[serde(default)]
    pub rect: Option<Rect>,
    #[serde(default)]
    pub maximized: bool,
}

impl WindowSpec {
    fn fresh(label: &str) -> Self {
        WindowSpec {
            role: if label == MAIN_LABEL {
                Role::Primary
            } else {
                Role::Fresh
            },
            record: None,
            tint: None,
            empty: false,
            rect: None,
            maximized: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    pub label: String,
    pub role: Role,
    pub record: Option<Value>,
    pub tint: Option<String>,
    pub empty: bool,
    /// `boot`보다 먼저 도착한 탭 이전 꾸러미들(순서 그대로).
    pub arrivals: Vec<Value>,
}

#[derive(Default)]
struct Inner {
    /// 살아 있는 메인 창, **만든 순서**. 세션의 창 순서가 이것이다.
    order: Vec<String>,
    /// 마지막으로 활성이던 메인 창 — 단일 인스턴스·전역 단축키·`끝내기`가 본다.
    last_active: Option<String>,
    /// 라벨을 발급하는 번호. 세션 안에서는 쓰이지 않는다(창 정체는 기록의 `id`다).
    next: u32,
    specs: HashMap<String, WindowSpec>,
    ready: HashSet<String>,
    arrivals: HashMap<String, Vec<Value>>,
    /// 라벨 → 그 창의 탭 줄(놓을 자리). 모양은 프론트가 정한다(`lib/tearoff.ts`).
    zones: HashMap<String, Value>,
    /// 라벨 → **그 창의 메모 요약**(uid·이름·색·미저장·경로). 모양은 프론트가 정한다
    /// (`lib/noteList.ts`의 `WindowNotes`). 숨긴 탭은 프론트가 빼고 보낸다.
    ///
    /// 세션 기록(`session.rs`의 `live`)을 다시 쓰지 않는 이유는 둘이다: 세션 쓰기는
    /// 1.5초 디바운스에 **`시작할 때 = 새 세션`이면 아예 쓰지 않으므로**(그 모드에서는
    /// 목록이 영원히 비어 있다), 그리고 세션 기록에는 미저장 글 전체가 함께 가므로
    /// 탭 이름 하나 바뀔 때마다 보낼 것이 아니다. 그래서 **가벼운 별도 채널**이다.
    notes: HashMap<String, Value>,
}

#[derive(Default)]
pub struct Windows(Mutex<Inner>);

fn lock(state: &Windows) -> MutexGuard<'_, Inner> {
    // 독이 올라도 앱을 죽이지 않는다 — 창 목록이 조금 어긋나는 것이 앱이 사라지는 것보다 낫다.
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

impl Windows {
    /// 창을 목록에 올린다(`tauri.conf.json`이 만든 첫 창도 여기로 온다).
    pub fn register(&self, label: &str) {
        if !is_main_label(label) {
            return;
        }
        let mut inner = lock(self);
        if !inner.order.iter().any(|l| l == label) {
            inner.order.push(label.to_string());
        }
        if inner.last_active.is_none() {
            inner.last_active = Some(label.to_string());
        }
    }

    /// 창이 사라졌다. **`last_active`는 지우지 않는다** — 다른 창의 `WA_ACTIVE`가
    /// 먼저 올 수도, 나중에 올 수도 있어 지우면 "마지막 활성 창"이 null로 남는다
    /// (원본 설계의 R4와 같은 판단).
    pub fn forget(&self, label: &str) {
        let mut inner = lock(self);
        inner.order.retain(|l| l != label);
        inner.ready.remove(label);
        inner.arrivals.remove(label);
        inner.zones.remove(label);
        inner.notes.remove(label);
        inner.specs.remove(label);
        if inner.last_active.as_deref() == Some(label) {
            inner.last_active = inner.order.last().cloned();
        }
    }

    pub fn set_active(&self, label: &str) {
        if !is_main_label(label) {
            return;
        }
        lock(self).last_active = Some(label.to_string());
    }

    /// 마지막으로 활성이던 창. 사라진 창을 가리키면 살아 있는 마지막 창으로 떨어진다.
    pub fn last_active(&self) -> Option<String> {
        let inner = lock(self);
        match &inner.last_active {
            Some(l) if inner.order.iter().any(|o| o == l) => Some(l.clone()),
            _ => inner.order.last().cloned(),
        }
    }

    /// 살아 있는 메인 창을 만든 순서대로.
    pub fn order(&self) -> Vec<String> {
        lock(self).order.clone()
    }

    /// 그 창의 메모 요약을 갈아 끼운다.
    pub fn put_notes(&self, label: &str, summary: Value) {
        if !is_main_label(label) {
            return;
        }
        lock(self).notes.insert(label.to_string(), summary);
    }

    /// 모든 창의 메모 요약을 **창 목록 순서대로**. 아직 요약을 보내지 않은 창은 빠진다
    /// (뜨는 중인 창이 빈 묶음으로 깜빡이지 않게).
    pub fn notes(&self) -> Vec<Value> {
        let inner = lock(self);
        inner
            .order
            .iter()
            .filter_map(|label| inner.notes.get(label).cloned())
            .collect()
    }
}

/// 살아 있는 메인 창의 수(고스트는 세지 않는다).
pub fn main_window_count(app: &AppHandle) -> usize {
    app.webview_windows()
        .keys()
        .filter(|l| is_main_label(l))
        .count()
}

/// 라벨로 창을 집어 온다. 고스트는 돌려주지 않는다.
fn main_window(app: &AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    if !is_main_label(label) {
        return None;
    }
    app.get_webview_window(label)
}

/// 포커스를 줄 창 — 마지막 활성 창 → 지금 포커스를 들고 있는 창 → `main` → 아무거나.
pub fn target_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let state = app.state::<Windows>();
    if let Some(win) = state.last_active().and_then(|l| main_window(app, &l)) {
        return Some(win);
    }
    app.webview_windows()
        .into_iter()
        .filter(|(l, _)| is_main_label(l))
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(_, w)| w)
        .or_else(|| main_window(app, MAIN_LABEL))
        .or_else(|| {
            app.webview_windows()
                .into_iter()
                .find(|(l, _)| is_main_label(l))
                .map(|(_, w)| w)
        })
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

/// 창이 자기 정체를 묻는다. **`App`의 첫 커맨드**이고 한 창에 한 번이다.
#[tauri::command]
pub fn window_boot(window: Window, state: tauri::State<'_, Windows>) -> BootInfo {
    let label = window.label().to_string();
    // Windows 종료·로그오프를 받는 가로채기를 이 창에 끼운다(창마다 한 번 · 멱등).
    // 여기 두는 이유: `window_boot`은 **창마다 꼭 한 번** 불리는 첫 커맨드다.
    if is_main_label(&label) {
        crate::shutdown::install(&window);
    }
    let mut inner = lock(&state);
    if is_main_label(&label) && !inner.order.iter().any(|l| l == &label) {
        inner.order.push(label.clone());
    }
    inner.ready.insert(label.clone());
    if inner.last_active.is_none() {
        inner.last_active = Some(label.clone());
    }
    let spec = inner
        .specs
        .remove(&label)
        .unwrap_or_else(|| WindowSpec::fresh(&label));
    let arrivals = inner.arrivals.remove(&label).unwrap_or_default();
    BootInfo {
        label,
        role: spec.role,
        record: spec.record,
        tint: spec.tint,
        empty: spec.empty,
        arrivals,
    }
}

/// 창 하나를 새로 만든다 — `새 창`(Ctrl+Shift+N) · 세션 복원 · 탭 떼어내기가 쓴다.
///
/// **`async`인 이유**: 창 만들기는 메인 스레드에서 돌아야 하고, 동기 커맨드는 그
/// 스레드를 붙잡고 있어 교착한다(Tauri 문서의 그 자리다).
///
/// 숨긴 채로 만들어 기하를 맞춘 **뒤에** 보여 준다. 그래야 떼어낸 창이 엉뚱한 자리에서
/// 한 프레임 깜빡이지 않는다.
#[tauri::command]
pub async fn window_create(app: AppHandle, spec: WindowSpec) -> Result<String, String> {
    let label = {
        let state = app.state::<Windows>();
        let mut inner = lock(&state);
        inner.next += 1;
        let label = format!("win{}", inner.next);
        inner.order.push(label.clone());
        inner.specs.insert(label.clone(), spec.clone());
        label
    };

    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()));
    #[cfg(debug_assertions)]
    let builder = crate::session::with_webview_data_dir(builder);
    let built = builder
        .title("Floaty Note")
        .inner_size(840.0, 520.0)
        // 최소 크기를 두지 않는다(사용자 요청): Windows가 허용하는 만큼 작게 줄일 수
        // 있고, 좁아질 때 깨지지 않는 일은 화면 쪽(`index.css`의 좁은 창 규칙)이 한다.
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .visible(false)
        .build();

    let win = match built {
        Ok(win) => win,
        Err(err) => {
            let state = app.state::<Windows>();
            lock(&state).order.retain(|l| l != &label);
            lock(&state).specs.remove(&label);
            return Err(format!("창을 만들 수 없습니다: {err}"));
        }
    };

    if let Some(r) = spec.rect {
        let _ = win.set_size(tauri::PhysicalSize::new(r.w, r.h));
        let _ = win.set_position(tauri::PhysicalPosition::new(r.x, r.y));
    }
    let _ = win.show();
    if spec.maximized {
        let _ = win.maximize();
    }
    let _ = win.set_focus();
    Ok(label)
}

/// 그 창을 앞으로 올린다(탭을 합친 뒤 받는 창을 올릴 때).
#[tauri::command]
pub fn window_focus(app: AppHandle, label: String) {
    if let Some(win) = main_window(&app, &label) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// 탭 하나를 다른 창으로 넘긴다. 받는 창이 아직 뜨지 않았으면 **담아 두고**
/// 그 창의 `window_boot`이 가져간다(이벤트로만 보내면 사이로 빠진다).
#[tauri::command]
pub fn tab_transfer(app: AppHandle, target: String, payload: Value) -> Result<(), String> {
    if !is_main_label(&target) {
        return Err("고스트 창에는 탭을 넘길 수 없습니다".into());
    }
    let ready = {
        let state = app.state::<Windows>();
        let mut inner = lock(&state);
        if inner.ready.contains(&target) {
            true
        } else {
            inner
                .arrivals
                .entry(target.clone())
                .or_default()
                .push(payload.clone());
            false
        }
    };
    if ready {
        app.emit_to(target.as_str(), TAB_ARRIVE_EVENT, payload)
            .map_err(|e| format!("탭을 넘길 수 없습니다: {e}"))?;
    }
    Ok(())
}

/// 그 창의 탭 줄(놓을 자리)을 갈아 끼운다. 창이 움직이거나 탭이 바뀔 때마다 다시 온다.
#[tauri::command]
pub fn window_set_drop_zone(window: Window, zone: Value, state: tauri::State<'_, Windows>) {
    let label = window.label().to_string();
    if !is_main_label(&label) {
        return;
    }
    lock(&state).zones.insert(label, zone);
}

/// 모든 창의 탭 줄. 끌기를 시작할 때 한 번 가져가고, 끄는 중에는 창이 움직이지 않는다.
/// **끄는 창이 가장 최근 활성 순서**로 정렬돼 있어 겹친 창의 우선순위가 결정적이다.
#[tauri::command]
pub fn window_drop_zones(state: tauri::State<'_, Windows>) -> Vec<Value> {
    let inner = lock(&state);
    let mut labels: Vec<String> = inner.order.clone();
    // 마지막 활성 창을 맨 앞으로 — 탭 줄이 겹치면 그 창이 이긴다.
    if let Some(active) = &inner.last_active {
        if let Some(at) = labels.iter().position(|l| l == active) {
            let found = labels.remove(at);
            labels.insert(0, found);
        }
    }
    labels
        .into_iter()
        .filter_map(|l| inner.zones.get(&l).cloned())
        .collect()
}

/// 끌고 있는 탭이 들어갈 자리를 그 창의 탭 줄에 표시하게 한다.
#[tauri::command]
pub fn window_mark_drop(app: AppHandle, target: Option<String>, index: Option<i64>) {
    let labels: Vec<String> = app.state::<Windows>().order();
    for label in labels {
        let at = if Some(&label) == target.as_ref() {
            index
        } else {
            None
        };
        // 표시를 지우는 쪽도 보내야 한다 — 대상이 바뀌면 이전 창의 선이 남는다.
        let _ = app.emit_to(label.as_str(), DROP_MARK_EVENT, at);
    }
}

/// `끝내기` — 모든 창이 자기 닫기 규칙을 돌린다(§5).
#[tauri::command]
pub fn app_close_all(app: AppHandle) {
    for label in app.state::<Windows>().order() {
        let _ = app.emit_to(label.as_str(), CLOSE_REQUEST_EVENT, ());
    }
}

// ---------------------------------------------------------------------------
// 창 간 메모 목록 — 창마다 자기 요약만 보내고, 여기서 모아 **모든 창에** 알린다
// ---------------------------------------------------------------------------

/// 이 창의 메모 요약을 올리고 모든 창에 알린다. 탭이 바뀔 때마다(프론트에서 디바운스)
/// 온다. 쓰는 주체가 창마다라도 **모으는 곳이 하나**이므로 창별로 다른 답이 나올 수 없다
/// (`session.rs`의 인덱스 조립과 같은 판단).
#[tauri::command]
pub fn window_put_tabs(app: AppHandle, window: Window, mut summary: Value) {
    let label = window.label().to_string();
    if !is_main_label(&label) {
        return;
    }
    // 라벨은 **보낸 창의 것으로 덮는다**: 프론트가 보내는 값은 `window_boot`이 돌아오기
    // 전에는 기본값(`main`)일 수 있고, 그 라벨로 `window_activate_tab`을 부르면 엉뚱한
    // 창이 앞으로 온다. 라벨의 진실은 커맨드를 받은 이 자리에만 있다.
    if let Some(map) = summary.as_object_mut() {
        map.insert("label".into(), Value::String(label.clone()));
    }
    app.state::<Windows>().put_notes(&label, summary);
    broadcast_notes(&app);
}

/// 모든 창의 메모 요약을 창 목록 순서대로 모아 **모든 창에** 보낸다.
///
/// 보낸 창에도 보낸다(설정과 다른 점이다): 받는 값은 "모든 창의 목록"이라 보낸 창에게도
/// 새 정보이고, 프론트는 이 값을 받아 **쓰지 않으므로** 되울림이 생길 수 없다.
pub fn broadcast_notes(app: &AppHandle) {
    let list = app.state::<Windows>().notes();
    for label in app.state::<Windows>().order() {
        let _ = app.emit_to(label.as_str(), NOTES_EVENT, list.clone());
    }
}

/// 다른 창의 메모를 눌렀다 — **그 창을 앞으로 가져오고 그 탭을 활성으로** 한다
/// (사용자 결정: 메모는 원래 창에 그대로 남는다). 탭을 넘기지 않으므로 `tab_transfer`와
/// 다른 길이고, 창 포커스와 탭 전환이 한 커맨드 안에 있어 순서가 흔들리지 않는다.
#[tauri::command]
pub fn window_activate_tab(app: AppHandle, label: String, uid: String) {
    if let Some(win) = main_window(&app, &label) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit_to(label.as_str(), ACTIVATE_TAB_EVENT, uid);
    }
}

/// 설정이 바뀌었다 — **보낸 창을 빼고** 모든 창에 알린다(지시 1: 설정 저장은 한 곳에서,
/// 반영은 모든 창에 즉시).
pub fn broadcast_settings(app: &AppHandle, from: &str, settings: &Value) {
    for label in app.state::<Windows>().order() {
        if label == from {
            continue;
        }
        let _ = app.emit_to(label.as_str(), SETTINGS_EVENT, settings.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 고스트는_메인_창이_아니다() {
        assert!(is_main_label(MAIN_LABEL));
        assert!(is_main_label("win3"));
        assert!(!is_main_label(GHOST_LABEL));
    }

    #[test]
    fn 창을_잊으면_마지막_활성_창이_살아_있는_창으로_떨어진다() {
        let reg = Windows::default();
        reg.register("main");
        reg.register("win1");
        reg.set_active("win1");
        assert_eq!(reg.last_active().as_deref(), Some("win1"));
        reg.forget("win1");
        // 사라진 창을 가리킨 채로 남지 않는다.
        assert_eq!(reg.last_active().as_deref(), Some("main"));
        assert_eq!(reg.order(), vec!["main".to_string()]);
    }

    #[test]
    fn 메모_요약은_창_순서를_지키고_닫힌_창의_것은_사라진다() {
        let reg = Windows::default();
        reg.register("main");
        reg.register("win1");
        reg.put_notes("win1", Value::String("w1".into()));
        reg.put_notes("main", Value::String("m".into()));
        // 보낸 순서가 아니라 **창을 만든 순서**다.
        assert_eq!(
            reg.notes(),
            vec![Value::String("m".into()), Value::String("w1".into())]
        );
        reg.forget("win1");
        assert_eq!(reg.notes(), vec![Value::String("m".into())]);
    }

    #[test]
    fn 고스트의_메모_요약은_올라가지_않는다() {
        let reg = Windows::default();
        reg.register("main");
        reg.put_notes(GHOST_LABEL, Value::String("g".into()));
        assert!(reg.notes().is_empty());
    }

    #[test]
    fn 고스트는_창_목록에_들어가지_않는다() {
        let reg = Windows::default();
        reg.register(GHOST_LABEL);
        reg.set_active(GHOST_LABEL);
        assert!(reg.order().is_empty());
        assert_eq!(reg.last_active(), None);
    }
}
