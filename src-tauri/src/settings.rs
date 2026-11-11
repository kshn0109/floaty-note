//! 설정 저장소 — `%APPDATA%\Inkwell-Tauri\settings.json`.
//!
//! **원본 앱의 자리는 절대 건드리지 않는다.** Win32 Inkwell은 `%APPDATA%\Inkwell\`과
//! `HKCU\Software\Inkwell`을 쓰고 아직 사용자 PC에서 돌아가는 앱이다. 둘이 서로
//! 덮어쓰면 사용자의 실제 설정과 세션이 날아간다(MIGRATION_HANDOFF §7). 그래서
//! 폴더 이름이 다르고(`Inkwell-Tauri`), 레지스트리는 읽지도 쓰지도 않는다.
//!
//! 쓰기는 **임시 파일 → 제자리 바꿔치기**이고, 세션·알림·최근 파일과 같은 함수
//! (`session::write_atomic`)를 쓴다. 중간에 죽어도 이전 설정 파일이 그대로 남는다
//! (§7의 세션 파일 규칙과 같은 이유).
//!
//! JSON의 **모양은 프론트가 정한다.** Rust는 `serde_json::Value`를 그대로 주고받으므로
//! 항목을 더하거나 이름을 바꿀 때 이 파일을 고칠 일이 없다. 모르는 키는 보존되고,
//! 깨진 파일은 기본값(`null`)으로 읽힌다.

use std::fs;
use std::path::PathBuf;

const FILE_NAME: &str = "settings.json";

/// 세션·알림·최근 파일과 **같은 폴더**다. 자리를 정하는 곳이 두 군데면 하나만 고쳐도
/// 데이터가 둘로 갈라진다(점검용 `INKWELL_DATA_DIR`이 설정만 빠뜨리는 식으로) —
/// 그래서 `session::app_dir()` 하나만 본다.
fn settings_dir() -> Result<PathBuf, String> {
    crate::session::app_dir()
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join(FILE_NAME))
}

/// 저장된 설정. 파일이 없거나 깨졌으면 `null` — 프론트가 기본값을 쓴다.
#[tauri::command]
pub fn load_settings() -> Result<serde_json::Value, String> {
    let path = settings_path()?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(serde_json::Value::Null);
    };
    Ok(serde_json::from_str(&text).unwrap_or(serde_json::Value::Null))
}

/// 임시 파일에 쓰고 fsync한 뒤 제자리로 옮긴다.
///
/// 다중 창: 설정은 **한 파일**이고 쓰는 쪽은 아무 창이나 될 수 있다. 쓴 뒤에 **다른 모든
/// 창에 알려** 테마·언어·보기 토글이 즉시 따라가게 한다(지시 1). 보낸 창에는 보내지 않는다
/// — 자기가 방금 만든 값을 되받아 다시 쓰는 되울림이 생긴다.
#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    window: tauri::Window,
    settings: serde_json::Value,
) -> Result<(), String> {
    let result = write_settings(&settings);
    if result.is_ok() {
        crate::winmgr::broadcast_settings(&app, window.label(), &settings);
    }
    result
}

/// 트레이 메뉴가 쓸 언어 — `"ko"` 아니면 `"en"`.
///
/// **왜 Rust가 언어를 아는가**: 트레이 메뉴는 창이 하나도 없을 때 떠야 하고, 문자열
/// 표(`src/lib/i18n.ts`)는 webview의 것이다. 두 줄(`열기`·`종료`)만 필요하므로 그 둘은
/// `toast.rs`에 둔다.
///
/// 고르는 규칙은 프론트와 같다: **항상 Windows 표시 언어**(사용자 결정 2026-11-09 —
/// 언어 선택 UI를 없앴다). 설정 파일에 옛 `language` 값이 남아 있어도 읽지 않는다.
pub fn ui_language() -> &'static str {
    crate::syscmd::system_language()
}

/// 트레이 상주 안내를 **지금 띄워야 하는가**. 원본 레지스트리 `TrayNoticeShown`과 같은
/// 뜻이고 같은 규칙이다: 한 번만, 영원히. 참을 돌려주면서 깃발을 켜 둔다(읽고 쓰는 것이
/// 한 함수라 "읽었는데 안 켰다"가 생길 수 없다).
///
/// 창이 하나도 없을 때 불리므로 다른 창에 알리지 않는다 — 다음에 창이 뜰 때 파일에서
/// 읽는다.
pub fn mark_tray_notice_shown() -> bool {
    let mut settings = load_settings().unwrap_or(serde_json::Value::Null);
    if settings.get("trayNoticeShown").and_then(serde_json::Value::as_bool) == Some(true) {
        return false;
    }
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    if let Some(map) = settings.as_object_mut() {
        map.insert("trayNoticeShown".into(), serde_json::Value::Bool(true));
    }
    // 못 써도 안내는 띄운다 — 다음 실행에 한 번 더 뜨는 것이 영원히 안 뜨는 것보다 낫다.
    let _ = write_settings(&settings);
    true
}

/// 쓰기 규칙은 세션·알림·최근 파일과 **같은 함수**다(`session::write_atomic`):
/// 임시 파일 → fsync → 제자리로 바꿔치기. 규칙이 두 곳에 있으면 한쪽만 고쳐진다.
fn write_settings(settings: &serde_json::Value) -> Result<(), String> {
    let dir = settings_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("설정 폴더를 만들 수 없습니다: {e}"))?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("설정을 직렬화할 수 없습니다: {e}"))?;
    crate::session::write_atomic(&dir.join(FILE_NAME), &text)
}
