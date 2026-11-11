//! 시스템 메뉴의 명령과 OS UI 언어 — Win32를 그대로 쓴다.
//!
//! **왜 Tauri API가 아니라 `WM_SYSCOMMAND`인가.** 시스템 메뉴의 여섯 항목 중
//! `이동`·`크기 조정`은 Windows 자신의 **키보드 이동/크기 루프**다(방향키로 창을
//! 옮기고 Enter로 확정, Esc로 취소). Tauri에는 그 루프를 시작하는 API가 없고,
//! 포인터 드래그(`start_dragging`)로는 키보드 조작이 재현되지 않는다. 원본도 이 여섯
//! 개를 `GetSystemMenu` 대신 직접 그린 팝업으로 바꾸면서 동작만은 `WM_SYSCOMMAND`로
//! **보내서**(post) Windows에 맡겼다 — 똑같이 한다.
//!
//! 최소화·최대화·복원·닫기도 같은 길로 보낸다. 섞어 쓰면 "메뉴에서 누른 최대화"와
//! "제목 줄 버튼으로 누른 최대화"가 서로 다른 경로를 타게 되고, 나중에 닫기 확인
//! 대화상자를 붙일 때 한쪽만 거치는 사고가 난다.
//!
//! `windows-sys`를 쓰는 이유: 날것 FFI 선언뿐이라 버전이 올라가도 시그니처가 흔들리지
//! 않는다(`windows` 크레이트의 `Param`/`Option<HWND>` 변화에 끌려다니지 않는다).
//! Win10/11 공통 API만 쓴다 — `PostMessageW`, `GetUserDefaultUILanguage`.

use serde::Deserialize;

/// 시스템 메뉴의 여섯 항목. 프론트(`menus.ts`)의 `SysCommand`와 1:1.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SysCommand {
    Restore,
    Move,
    Size,
    Minimize,
    Maximize,
    Close,
}

#[cfg(windows)]
#[tauri::command]
pub fn sys_command(command: SysCommand, window: tauri::Window) -> Result<(), String> {
    use std::ffi::c_void;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        PostMessageW, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE,
        WM_SYSCOMMAND,
    };

    let sc = match command {
        SysCommand::Restore => SC_RESTORE,
        SysCommand::Move => SC_MOVE,
        SysCommand::Size => SC_SIZE,
        SysCommand::Minimize => SC_MINIMIZE,
        SysCommand::Maximize => SC_MAXIMIZE,
        SysCommand::Close => SC_CLOSE,
    };

    let handle = window.hwnd().map_err(|e| e.to_string())?;
    // `windows` 크레이트의 HWND를 이름으로 끌어오지 않고 값만 꺼낸다 — tauri가 쓰는
    // 버전과 우리가 쓰는 버전이 달라도 깨지지 않게.
    let hwnd = handle.0 as isize as *mut c_void;

    // SAFETY: 살아 있는 창 핸들에 메시지를 **보내기만** 한다(send가 아니라 post이므로
    // 현재 스레드가 Windows의 모달 이동/크기 루프 안에서 멈추지 않는다).
    let ok = unsafe { PostMessageW(hwnd, WM_SYSCOMMAND, sc as usize, 0) };
    if ok == 0 {
        return Err("WM_SYSCOMMAND를 보낼 수 없습니다".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn sys_command(command: SysCommand, window: tauri::Window) -> Result<(), String> {
    let _ = (command, window);
    Err("시스템 메뉴는 Windows에서만 동작합니다".to_string())
}

/// 점검용 UI 언어 바꿔치기 — **디버그 빌드에만 있다**(`session::data_dir_override`와 같은 규칙).
///
/// `INKWELL_LANG=en`(또는 `ko`)이면 Windows 표시 언어 대신 그 값을 쓴다. 홍보용 화면을
/// 찍거나 번역을 눈으로 확인할 때 쓰는 길이고, 릴리스 빌드에서는 이 함수 자체가 사라지므로
/// 환경변수를 넣어도 아무 일이 없다 — 언제나 `GetUserDefaultUILanguage()`다.
#[cfg(all(windows, debug_assertions))]
fn lang_override() -> Option<&'static str> {
    match std::env::var("INKWELL_LANG").ok()?.as_str() {
        "en" => Some("en"),
        "ko" => Some("ko"),
        _ => None,
    }
}

/// OS의 UI 언어를 우리가 내보내는 언어로 줄인 값 — `"ko"` 아니면 `"en"`.
///
/// 원본 `UiLangFromSystem()`과 같은 판정이다. `navigator.language`는 WebView2의
/// 언어 협상 결과라 OS의 **표시 언어**와 어긋날 수 있으므로 Win32에 직접 묻는다.
/// 우리가 안 내보내는 언어는 전부 영어 — 그게 기본값의 핵심이다.
#[cfg(windows)]
#[tauri::command]
pub fn system_language() -> &'static str {
    use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;

    #[cfg(debug_assertions)]
    if let Some(lang) = lang_override() {
        return lang;
    }

    const LANG_KOREAN: u16 = 0x12;
    // SAFETY: 인자 없는 순수 조회 함수.
    let id = unsafe { GetUserDefaultUILanguage() };
    if id & 0x3FF == LANG_KOREAN {
        "ko"
    } else {
        "en"
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn system_language() -> &'static str {
    "en"
}

/// 시간 + 날짜 한 줄 — **Windows 11 메모장의 `편집 › 시간/날짜`(F5)와 같은 글자.**
///
/// 메모장이 쓰는 것은 사용자 로캘의 **짧은 시간**(초 없음) + 공백 + **짧은 날짜**다
/// (한국어 기준 `오후 11:30 2026-11-09`). 브라우저의 `Intl`로는 이 글자가 안 나온다
/// (`2026. 11. 9.`처럼 다르게 찍힌다) — 그래서 Windows에 직접 물어본다.
///
/// `LOCALE_NAME_USER_DEFAULT`는 헤더에서 `NULL`이라 널 포인터를 넘긴다. 형식 문자열도
/// 널이면 그 로캘의 기본 형식이고, 시간/날짜를 넘기지 않으면 **지금**이다.
/// Win10/11 공통 API이고 관리자 권한도 필요 없다.
#[cfg(windows)]
#[tauri::command]
pub fn time_date_stamp() -> Result<String, String> {
    use std::ptr::null;
    use windows_sys::Win32::Globalization::{
        GetDateFormatEx, GetTimeFormatEx, DATE_SHORTDATE, TIME_NOSECONDS,
    };

    /// 반환값은 **끝의 NUL까지 센 글자 수**다. 그 한 칸을 떼고 문자열로 만든다.
    fn text(buf: &[u16], len: i32) -> String {
        if len <= 1 {
            return String::new();
        }
        let n = ((len as usize) - 1).min(buf.len());
        String::from_utf16_lossy(&buf[..n])
    }

    let mut time = [0u16; 128];
    let mut date = [0u16; 128];

    // SAFETY: 버퍼와 그 길이를 짝으로 넘기고, 로캘·형식·시각은 모두 기본값(널)이다.
    // 두 함수 모두 버퍼를 넘치게 쓰지 않고 길이만 돌려준다.
    let tn = unsafe {
        GetTimeFormatEx(
            null(),
            TIME_NOSECONDS,
            null(),
            null(),
            time.as_mut_ptr(),
            time.len() as i32,
        )
    };
    let dn = unsafe {
        GetDateFormatEx(
            null(),
            DATE_SHORTDATE,
            null(),
            null(),
            date.as_mut_ptr(),
            date.len() as i32,
            null(),
        )
    };
    if tn <= 1 || dn <= 1 {
        return Err("시간/날짜 형식을 읽을 수 없습니다".to_string());
    }
    Ok(format!("{} {}", text(&time, tn), text(&date, dn)))
}

#[cfg(not(windows))]
#[tauri::command]
pub fn time_date_stamp() -> Result<String, String> {
    Err("Windows 전용".to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::time_date_stamp;

    /// 글자가 **두 토막**(시간 + 날짜)으로 나오고 숫자가 들어 있는지만 본다 —
    /// 형식 자체는 그 컴퓨터의 로캘 설정이라 값을 박아 둘 수 없다.
    #[test]
    fn stamp_has_time_and_date() {
        let s = time_date_stamp().expect("Windows 형식 조회");
        assert!(s.contains(' '), "시간과 날짜 사이에 공백이 있어야 한다: {s}");
        assert!(s.chars().any(|c| c.is_ascii_digit()), "숫자가 있어야 한다: {s}");
        assert!(!s.starts_with(' '), "시간이 비어 있다: {s}");
        assert!(!s.ends_with(' '), "날짜가 비어 있다: {s}");
    }
}
