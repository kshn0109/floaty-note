//! 설치된 글꼴 가족 이름 — 설정 › 모양 › `글꼴` 드롭다운(시안 G1)이 쓴다.
//!
//! `EnumFontFamiliesExW`는 Win10/11 공통이고 **관리자 권한이 필요 없다**. 화면 DC를
//! 빌려 글꼴만 열거하고 바로 돌려준다(새 crate 없이 이미 쓰는 `windows-sys`만).
//!
//! 여기서는 **날목록**을 그대로 돌려준다 — `@`(세로쓰기) 걸러내기·중복 제거·가나다순은
//! TS 쪽 순수 함수(`src/lib/fonts.ts`의 `cleanFontList`)가 하고 거기에 시험이 붙어 있다.

#[cfg(windows)]
#[tauri::command]
pub fn system_fonts() -> Vec<String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LPARAM;
    use windows_sys::Win32::Graphics::Gdi::{
        DEFAULT_CHARSET, EnumFontFamiliesExW, GetDC, LOGFONTW, ReleaseDC, TEXTMETRICW,
    };

    /// GDI가 글꼴 하나마다 부르는 콜백. `param`은 아래에서 넘긴 `Vec<String>`이다.
    /// 1을 돌려주면 계속 센다(0이면 멈춘다).
    unsafe extern "system" fn collect(
        logfont: *const LOGFONTW,
        _metric: *const TEXTMETRICW,
        _kind: u32,
        param: LPARAM,
    ) -> i32 {
        // SAFETY: `param`은 `EnumFontFamiliesExW`에 넘긴 그 `Vec<String>`의 포인터이고,
        // 열거가 끝날 때까지 살아 있다(아래 `out`은 이 호출보다 오래 산다).
        let out = unsafe { &mut *(param as *mut Vec<String>) };
        // SAFETY: GDI가 유효한 `LOGFONTW`를 준다. 아니면 아무것도 담지 않는다.
        if let Some(lf) = unsafe { logfont.as_ref() } {
            let face = &lf.lfFaceName;
            let len = face.iter().position(|&c| c == 0).unwrap_or(face.len());
            let name = String::from_utf16_lossy(&face[..len]);
            if !name.is_empty() {
                out.push(name);
            }
        }
        1
    }

    let mut out: Vec<String> = Vec::new();
    // SAFETY: 화면 DC(`GetDC(NULL)`)를 빌려 글꼴만 열거하고 같은 창 핸들로 돌려준다.
    // `lfCharSet = DEFAULT_CHARSET`이면 **모든 문자 집합의 가족 전부**가 한 번씩 온다.
    unsafe {
        let hdc = GetDC(null_mut());
        if hdc.is_null() {
            return out;
        }
        let mut lf: LOGFONTW = core::mem::zeroed();
        lf.lfCharSet = DEFAULT_CHARSET;
        EnumFontFamiliesExW(
            hdc,
            &lf,
            Some(collect),
            (&mut out) as *mut Vec<String> as LPARAM,
            0,
        );
        ReleaseDC(null_mut(), hdc);
    }
    out
}

#[cfg(not(windows))]
#[tauri::command]
pub fn system_fonts() -> Vec<String> {
    Vec::new()
}
