//! 파일 읽기·쓰기 — 원본 `main.cpp`의 `ReadTextFile` / `WriteTextFile`를 그대로 옮긴 것.
//!
//! **왜 Rust 커맨드인가.** 프론트가 파일 시스템 권한(`fs` 플러그인)을 갖지 않게 하려는
//! 것이다. 여기 두 커맨드는 "사용자가 대화상자에서 고른 경로 하나"만 받고, 그 밖의
//! 탐색·목록·삭제는 아예 존재하지 않는다. 관리자 권한도 요구하지 않는다(일반 사용자
//! 권한으로 열리는 파일만 열린다 — 권한이 없으면 오류 카드가 뜬다).
//!
//! 읽기 규칙(원본과 같은 순서):
//!   1. `FF FE`로 시작하면 **UTF-16 LE**(BOM 필수).
//!   2. `EF BB BF`로 시작하면 그 3바이트를 떼고, 나머지가 올바른 UTF-8이면 **UTF-8 (BOM)**.
//!   3. 그 밖에는 올바른 UTF-8이면 **UTF-8**, 아니면 **ANSI**(현재 시스템 코드 페이지).
//!   빈 파일은 UTF-8이다(원본 `len == 0`도 UTF-8로 본다).
//!
//! 줄바꿈은 **정규화하면서 센다**: CRLF·CR·LF가 두 가지 이상 섞여 있으면 `mixed`,
//! 하나도 없으면 `lf`(저장하면 그렇게 될 값). 편집기에는 늘 LF만 넘어간다.
//!
//! 쓰기는 **늘 UTF-8(BOM 없음) + LF 하나**다(원본 규칙, GFM 관례). 같은 폴더의 임시
//! 파일에 쓰고 `fsync` 한 뒤 제자리로 **옮긴다** — 쓰는 중에 죽어도 원래 파일이 남는다.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 원본 `ReadTextFile`의 상한(0x7000000 ≈ 117MB)과 같다. 그보다 큰 파일은 열지 않는다.
const MAX_BYTES: u64 = 0x7000000;

/// 디스크에 실제로 있던 인코딩. 상태 글자에 그대로 나간다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Enc {
    Utf8,
    Utf8Bom,
    /// 프론트의 토큰은 `utf16le`다(`src/lib/file.ts`의 `Encoding`). camelCase 규칙에
    /// 맡기면 `utf16Le`가 나가 **프론트의 어느 가지에도 걸리지 않고** 상태 글자가
    /// UTF-16 파일을 `UTF-8`이라고 적는다. 그래서 이름을 손으로 박는다.
    #[serde(rename = "utf16le")]
    Utf16Le,
    Ansi,
}

/// 디스크에 실제로 있던 줄바꿈.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
    Mixed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    /// 늘 LF로 정규화된 내용. 편집기는 이것만 본다.
    pub text: String,
    pub enc: Enc,
    pub eol: Eol,
    /// 디스크에 있던 바이트 수. 큰 `.md`의 임계값 판단(프론트 `mode.ts`)에 쓴다.
    pub bytes: u64,
}

/// ANSI(시스템 코드 페이지) → 문자열. Windows에서만 진짜 코드 페이지를 쓴다.
#[cfg(windows)]
fn widen_ansi(bytes: &[u8]) -> String {
    use windows_sys::Win32::Globalization::{CP_ACP, MultiByteToWideChar};

    if bytes.is_empty() {
        return String::new();
    }
    let len = bytes.len() as i32;
    // 필요한 길이를 먼저 묻는다(원본 `Widen`과 같은 두 번 호출).
    let need = unsafe { MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0) };
    if need <= 0 {
        return String::new();
    }
    let mut wide = vec![0u16; need as usize];
    unsafe {
        MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), len, wide.as_mut_ptr(), need);
    }
    String::from_utf16_lossy(&wide)
}

/// Windows가 아닌 곳(개발용 빌드)에서는 코드 페이지가 없으므로 Latin-1로 읽는다.
#[cfg(not(windows))]
fn widen_ansi(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

/// 바이트 → (문자열, 인코딩). 순수 함수라 단위 시험이 붙는다.
pub fn decode(bytes: &[u8]) -> (String, Enc) {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return (String::from_utf16_lossy(&units), Enc::Utf16Le);
    }
    let has_bom = bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
    let body = if has_bom { &bytes[3..] } else { bytes };
    match std::str::from_utf8(body) {
        Ok(s) => (
            s.to_string(),
            if has_bom { Enc::Utf8Bom } else { Enc::Utf8 },
        ),
        // UTF-8로 해석이 안 되면 시스템 코드 페이지로 다시 읽는다(원본과 같은 순서).
        // BOM이 있었는데 뒤가 UTF-8이 아닌 파일은 ANSI로 보고, BOM 세 바이트도 되살린다.
        Err(_) => (widen_ansi(bytes), Enc::Ansi),
    }
}

/// CRLF·CR → LF로 바꾸면서 **무엇이 있었는지** 센다(원본과 같은 한 번의 순회).
pub fn normalize_eol(src: &str) -> (String, Eol) {
    let mut out = String::with_capacity(src.len());
    let mut saw_crlf = false;
    let mut saw_lf = false;
    let mut saw_cr = false;
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                    saw_crlf = true;
                } else {
                    saw_cr = true;
                }
                out.push('\n');
            }
            '\n' => {
                saw_lf = true;
                out.push('\n');
            }
            other => out.push(other),
        }
    }
    let kinds = u8::from(saw_crlf) + u8::from(saw_lf) + u8::from(saw_cr);
    let eol = if kinds > 1 {
        Eol::Mixed
    } else if saw_crlf {
        Eol::Crlf
    } else if saw_cr {
        Eol::Cr
    } else {
        // 줄바꿈이 하나도 없는 파일(한 줄, 끝 줄바꿈 없음)은 LF로 보고한다 —
        // 저장하면 실제로 그렇게 되는 값이다(원본 주석).
        Eol::Lf
    };
    (out, eol)
}

/// 사용자가 고른 경로 하나를 읽는다.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("파일이 아닙니다".to_string());
    }
    if meta.len() > MAX_BYTES {
        return Err("파일이 너무 큽니다".to_string());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let (raw, enc) = decode(&bytes);
    let (text, eol) = normalize_eol(&raw);
    Ok(ReadResult {
        text,
        enc,
        eol,
        bytes: meta.len(),
    })
}

/// 같은 폴더의 임시 파일을 제자리로 옮긴다. 대상이 있어도 덮어쓴다.
#[cfg(windows)]
fn replace_file(temp: &Path, dest: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    // `fs::rename`은 Windows에서 대상이 있으면 실패하고, "지우고 옮기기"는 옮기기가
    // 실패했을 때 원래 파일을 잃는다. `MoveFileExW`는 한 번에 바꿔치기한다.
    let wide = |p: &Path| -> Vec<u16> {
        p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    };
    let (from, to) = (wide(temp), wide(dest));
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, dest: &Path) -> Result<(), String> {
    fs::rename(temp, dest).map_err(|e| e.to_string())
}

/// 늘 UTF-8(BOM 없음)로 쓴다. 줄바꿈은 프론트가 이미 LF로만 만들어 보낸다.
#[tauri::command]
pub fn write_text_file(path: String, text: String) -> Result<(), String> {
    let dest = PathBuf::from(&path);
    let dir = dest
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| "경로에 폴더가 없습니다".to_string())?;
    let name = dest
        .file_name()
        .ok_or_else(|| "경로에 파일 이름이 없습니다".to_string())?;
    let mut temp_name = name.to_os_string();
    temp_name.push(".inkwell-tmp");
    let temp = dir.join(temp_name);

    {
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        let result = file
            .write_all(text.as_bytes())
            .and_then(|()| file.sync_all());
        if let Err(e) = result {
            drop(file);
            let _ = fs::remove_file(&temp);
            return Err(e.to_string());
        }
    }
    if let Err(e) = replace_file(&temp, &dest) {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_without_bom() {
        let (text, enc) = decode("안녕 hello".as_bytes());
        assert_eq!(text, "안녕 hello");
        assert_eq!(enc, Enc::Utf8);
    }

    #[test]
    fn utf8_with_bom_drops_the_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("가".as_bytes());
        let (text, enc) = decode(&bytes);
        assert_eq!(text, "가");
        assert_eq!(enc, Enc::Utf8Bom);
    }

    #[test]
    fn utf16_le_needs_a_bom() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "가A".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (text, enc) = decode(&bytes);
        assert_eq!(text, "가A");
        assert_eq!(enc, Enc::Utf16Le);

        // BOM이 없는 UTF-16은 UTF-16으로 보지 않는다(원본과 같다).
        let (_, enc2) = decode(&[0x41, 0x00, 0x42, 0x00]);
        assert_ne!(enc2, Enc::Utf16Le);
    }

    /// 회귀 시험 — 인코딩 토큰은 **프론트의 `Encoding` 타입과 글자까지 같아야 한다**
    /// (`src/lib/file.ts`). 하나라도 어긋나면 `encName`의 `default` 가지로 떨어져
    /// 상태 글자가 엉뚱한 인코딩을 적는다(UTF-16 파일을 `UTF-8`이라고 적은 버그).
    #[test]
    fn encoding_tokens_match_the_frontend() {
        let token = |e: Enc| serde_json::to_string(&e).unwrap();
        assert_eq!(token(Enc::Utf8), "\"utf8\"");
        assert_eq!(token(Enc::Utf8Bom), "\"utf8Bom\"");
        assert_eq!(token(Enc::Utf16Le), "\"utf16le\"");
        assert_eq!(token(Enc::Ansi), "\"ansi\"");
    }

    /// 줄바꿈 토큰도 같은 이유로 못 박는다.
    #[test]
    fn eol_tokens_match_the_frontend() {
        let token = |e: Eol| serde_json::to_string(&e).unwrap();
        assert_eq!(token(Eol::Lf), "\"lf\"");
        assert_eq!(token(Eol::Crlf), "\"crlf\"");
        assert_eq!(token(Eol::Cr), "\"cr\"");
        assert_eq!(token(Eol::Mixed), "\"mixed\"");
    }

    #[test]
    fn invalid_utf8_falls_back_to_ansi() {
        // 0xB0 0xA1은 UTF-8로는 틀린 바이트열이다(CP949에서는 '가').
        let (text, enc) = decode(&[0xB0, 0xA1]);
        assert_eq!(enc, Enc::Ansi);
        assert_eq!(text.chars().count(), 1);
    }

    #[test]
    fn an_empty_file_is_utf8() {
        let (text, enc) = decode(&[]);
        assert_eq!(text, "");
        assert_eq!(enc, Enc::Utf8);
    }

    #[test]
    fn line_endings_are_counted_while_normalising() {
        assert_eq!(normalize_eol("a\nb"), ("a\nb".into(), Eol::Lf));
        assert_eq!(normalize_eol("a\r\nb"), ("a\nb".into(), Eol::Crlf));
        assert_eq!(normalize_eol("a\rb"), ("a\nb".into(), Eol::Cr));
        assert_eq!(normalize_eol("a\r\nb\nc"), ("a\nb\nc".into(), Eol::Mixed));
        assert_eq!(normalize_eol("a\rb\r\nc"), ("a\nb\nc".into(), Eol::Mixed));
        // 줄바꿈이 없으면 LF(저장하면 그렇게 될 값).
        assert_eq!(normalize_eol("one line"), ("one line".into(), Eol::Lf));
    }

    #[test]
    fn writing_is_utf8_without_a_bom_and_replaces_in_place() {
        let dir = std::env::temp_dir().join("inkwell-textfile-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.md");
        let p = path.to_string_lossy().to_string();

        write_text_file(p.clone(), "가\nb\n".to_string()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "가\nb\n".as_bytes());

        // 두 번째 저장도 (대상이 이미 있는데도) 성공하고 임시 파일을 남기지 않는다.
        write_text_file(p.clone(), "second".to_string()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(!dir.join("sample.md.inkwell-tmp").exists());

        let got = read_text_file(p).unwrap();
        assert_eq!(got.text, "second");
        assert_eq!(got.enc, Enc::Utf8);
        assert_eq!(got.eol, Eol::Lf);
        assert_eq!(got.bytes, 6);

        let _ = fs::remove_dir_all(&dir);
    }
}
