//! 클립보드 읽기 — **우클릭 메뉴의 `붙여넣기`가 쓰는 유일한 길.**
//!
//! **왜 Rust인가.** WebView2에서 `navigator.clipboard.readText()`를 부르면 Edge가
//! "클립보드에 복사된 텍스트 및 이미지 보기 — 차단 / 이번만 / 허용" 권한 창을 띄운다.
//! 메모장에는 그런 것이 없고, 사용자가 처음 우클릭하자마자 그 창이 떠서 메뉴를 가렸다.
//! 쓰기(`writeText`)는 묻지 않으므로 복사·잘라내기는 그대로 둔다.
//!
//! `Ctrl+V`는 **이 길을 타지 않는다** — 가로채지 않으므로 WebView2가 평소대로(서식까지)
//! 붙여넣는다. 여기 오는 것은 팝업에 초점이 있어 `execCommand`가 듣지 않는 메뉴 경로뿐이다.
//!
//! Win32를 날것으로 쓴다(`windows-sys`, Win10/11 공통 API):
//! `OpenClipboard` → `GetClipboardData(CF_UNICODETEXT)` → `GlobalLock` → UTF-16 복사.
//! `CF_UNICODETEXT`는 상수 13이다 — `windows-sys`의 어느 모듈에 사는지가 버전마다
//! 흔들려서 값으로 적는다(공개 ABI라 바뀌지 않는다).

/// 클립보드의 글자. 비어 있거나 글자 형식이 없으면 빈 문자열(오류가 아니다 —
/// 붙여넣을 것이 없으면 아무 일도 하지 않는 것이 맞다).
#[cfg(windows)]
#[tauri::command]
pub fn clipboard_read_text() -> String {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    // SAFETY: 아래 전부 읽기 전용이고, 열면 반드시 닫는다(이른 반환마다 닫는다).
    unsafe {
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            return String::new();
        }
        // 창 핸들 없이 열면 "이 스레드"가 소유자가 된다 — 읽기에는 그것으로 충분하다.
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return String::new();
        }
        let handle: HANDLE = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return String::new();
        }
        let ptr = GlobalLock(handle) as *const u16;
        if ptr.is_null() {
            CloseClipboard();
            return String::new();
        }
        // 끝은 NUL이다(CF_UNICODETEXT의 규약). 길이를 먼저 세고 한 번에 옮긴다.
        // **블록 크기를 넘지 않게 센다**: 규약을 안 지킨 앱이 NUL 없는 글을 올리면
        // 끝없이 남의 메모리를 읽게 된다(그쪽이 틀려도 우리가 죽을 수는 없다).
        // `GlobalSize`가 0을 주면(크기를 알 수 없는 핸들) 예전처럼 NUL까지 센다 —
        // 상한을 못 구한 것이 "빈 클립보드"로 보이면 붙여넣기가 조용히 안 되는 쪽이 된다.
        let cap = match GlobalSize(handle) / 2 {
            0 => usize::MAX,
            units => units,
        };
        let mut len = 0usize;
        while len < cap && *ptr.add(len) != 0 {
            len += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
        GlobalUnlock(handle);
        CloseClipboard();
        text
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn clipboard_read_text() -> String {
    String::new()
}
