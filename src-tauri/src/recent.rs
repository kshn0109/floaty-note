//! 최근 연 파일 — `%APPDATA%\Inkwell-Tauri\recent.json`.
//!
//! **원본 앱의 자리(`%APPDATA%\Inkwell\`·`HKCU\Software\Inkwell`)는 건드리지 않는다**
//! (MIGRATION_HANDOFF §7). 원본에는 최근 파일 기능 자체가 없다.
//!
//! ## 왜 `settings.json`이 아니라 별도 파일인가
//!
//! 설정은 창마다 자기 값을 들고 있다가 통째로 쓰는 구조(`src/lib/settings.ts`의
//! `raw` + 디바운스)라, 거기 배열을 하나 더하면 **창 A가 들고 있던 낡은 배열이 창 B의
//! 추가를 덮어쓴다**. 최근 파일은 "어느 창에서 열든 모든 창에 바로"여야 하므로
//! 세션 인덱스와 같은 판단을 한다: **쓰는 곳은 Rust 하나**이고, 창은 `경로 하나`만
//! 보내며(`recent_add`), 맨 앞으로 올리고 중복을 지우고 상한을 지키는 일은 여기서 한다.
//! 쓴 뒤에는 **모든 창에** 알린다.
//!
//! 쓰기는 임시 파일 → 제자리 바꿔치기다(`session::write_atomic` — 세션·설정과 같은 규칙).

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::winmgr::Windows;

const FILE_NAME: &str = "recent.json";

/// 목록에 남기는 최대 개수. 메모 목록 패널(폭 168)에 들어갈 만큼이면 되고, Windows
/// 메모장에는 최근 파일 목록이 아예 없어 따를 기준이 없다 — 탐색기의 "최근 항목"이
/// 보통 10개라 10으로 정했다.
const MAX: usize = 10;

/// 최근 파일 목록이 바뀌었다 — 모든 창이 이 값으로 갈아 끼운다.
pub const RECENT_EVENT: &str = "inkwell://recent";

fn file_path() -> Result<PathBuf, String> {
    Ok(crate::session::app_dir()?.join(FILE_NAME))
}

/// Windows의 파일 이름은 대소문자를 구별하지 않고 구분자가 둘이다(`App`의 `samePath`와
/// 같은 규칙 — 같은 파일을 두 줄로 들고 있지 않게 한다).
fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

/// 그 경로를 **맨 앞으로** 올린 새 목록. 같은 파일은 한 줄만 남고 상한을 넘으면 뒤가
/// 잘린다. 순수 함수라 시험이 디스크를 건드리지 않는다.
fn promote(list: &[String], path: &str, cap: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(list.len() + 1);
    out.push(path.to_string());
    for item in list {
        if !same_path(item, path) {
            out.push(item.clone());
        }
    }
    out.truncate(cap);
    out
}

/// 그 경로를 뺀 새 목록(목록에서 빼기 ✕ · 없어진 파일).
fn without(list: &[String], path: &str) -> Vec<String> {
    list.iter()
        .filter(|item| !same_path(item, path))
        .cloned()
        .collect()
}

fn read() -> Vec<String> {
    let Ok(path) = file_path() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    // 깨진 파일은 빈 목록으로 본다 — 최근 파일 때문에 앱이 뜨지 않으면 안 된다.
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .filter(|s| !s.is_empty())
            .take(MAX)
            .collect(),
        _ => Vec::new(),
    }
}

fn write(list: &[String]) -> Result<(), String> {
    let dir = crate::session::app_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("설정 폴더를 만들 수 없습니다: {e}"))?;
    let text =
        serde_json::to_string(list).map_err(|e| format!("최근 파일을 직렬화할 수 없습니다: {e}"))?;
    crate::session::write_atomic(&dir.join(FILE_NAME), &text)
}

/// 바뀐 목록을 **모든 창에** 알린다. 앱 전체 하나뿐인 값이라 보낸 창에도 보낸다
/// (프론트는 받은 값을 되쓰지 않으므로 되울림이 없다).
fn broadcast(app: &AppHandle, list: &[String]) {
    for label in app.state::<Windows>().order() {
        let _ = app.emit_to(label.as_str(), RECENT_EVENT, list.to_vec());
    }
}

#[tauri::command]
pub fn recent_list() -> Vec<String> {
    read()
}

/// 파일을 열거나 저장했다 — 맨 앞으로 올린다.
#[tauri::command]
pub fn recent_add(app: AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    let list = promote(&read(), &path, MAX);
    write(&list)?;
    broadcast(&app, &list);
    Ok(())
}

/// 목록에서 뺀다 — ✕를 눌렀거나, 없어진 파일을 열려다 실패했을 때.
#[tauri::command]
pub fn recent_remove(app: AppHandle, path: String) -> Result<(), String> {
    let list = without(&read(), &path);
    write(&list)?;
    broadcast(&app, &list);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 맨_앞으로_올리고_중복을_지운다() {
        let list = v(&["a.md", "b.md", "c.md"]);
        assert_eq!(promote(&list, "c.md", 10), v(&["c.md", "a.md", "b.md"]));
        assert_eq!(
            promote(&list, "d.md", 10),
            v(&["d.md", "a.md", "b.md", "c.md"])
        );
    }

    #[test]
    fn 같은_파일은_대소문자와_구분자가_달라도_한_줄이다() {
        let list = v(&[r"C:\Notes\a.md", r"C:\Notes\b.md"]);
        let next = promote(&list, "c:/notes/A.MD", 10);
        assert_eq!(next, v(&["c:/notes/A.MD", r"C:\Notes\b.md"]));
    }

    #[test]
    fn 상한을_넘으면_뒤가_잘린다() {
        let list = v(&["1", "2", "3"]);
        assert_eq!(promote(&list, "4", 3), v(&["4", "1", "2"]));
    }

    #[test]
    fn 목록에서_빼기는_그_줄만_지운다() {
        let list = v(&[r"C:\a.md", r"C:\b.md"]);
        assert_eq!(without(&list, "c:/A.MD"), v(&[r"C:\b.md"]));
        // 없는 경로를 빼라고 해도 목록은 그대로다.
        assert_eq!(without(&list, r"C:\zzz.md"), list);
    }
}
