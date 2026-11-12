//! 단일 인스턴스 · 명령줄 파일 (§5의 마지막 줄, MIGRATION_HANDOFF §7 "프로세스는 하나").
//!
//! 원본은 `FindWindowW(kAppClass)` + `WM_COPYDATA`로 직접 했고, 이유를 이렇게 적어 두었다:
//! "한 프로세스가 더 생기면 같은 `reminders.tsv`를 읽어 알림을 두 번 울리고 서로의 목록을
//! 덮어쓴다." 세션 파일도 똑같다 — 두 프로세스가 같은 `session.json`을 쓰면 한쪽이 지워진다.
//! 그래서 두 번째 실행은 **넘겨주고 끝난다**: 돌아가던 인스턴스의 마지막 활성 창에 그 파일을
//! 새 탭으로 열게 하고 창을 앞으로 올린다.
//!
//! 파일 연결(.txt/.md "연결 프로그램") 등록 자체는 패키징 단계의 일이라 여기 없다.

use std::path::Path;
use std::sync::Mutex;

use tauri::Emitter;

/// 두 번째 실행이 넘겨준 파일을 프론트에 알리는 이벤트 이름. `src/lib/session.ts`와 1:1.
pub const OPEN_FILES_EVENT: &str = "inkwell://open-files";

/// 첫 실행의 명령줄 파일. 프론트가 뜨기 전에 알 수 있으므로 들고 있다가
/// `take_cli_files`로 건네준다 — 이벤트로 보내면 리스너가 붙기 전에 사라진다.
#[derive(Default)]
pub struct CliFiles(pub Mutex<Vec<String>>);

/// 명령줄에서 **열어야 할 파일**만 고른다.
///
/// `-`로 시작하는 것(스위치)은 버리고, 실제로 존재하는 파일만 남긴다. 개발 중에는
/// Tauri와 WebView2가 자기 인자를 붙이는 일이 있어 "존재하는 파일"이 유일하게 안전한
/// 기준이다 — 없는 경로를 열려다 "읽을 수 없습니다" 카드를 띄우는 것보다 조용히 거르는
/// 편이 맞다(원본 `FileArgument`도 첫 비스위치 인자 하나만 봤다).
pub fn file_args<S: AsRef<str>>(argv: &[S]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .map(|a| a.as_ref())
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .filter(|a| Path::new(a).is_file())
        .map(|a| a.to_string())
        .collect()
}

/// 프론트가 시작할 때 한 번 묻는다. 두 번 읽히지 않게 **꺼내 간다**.
#[tauri::command]
pub fn take_cli_files(state: tauri::State<'_, CliFiles>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut files) => std::mem::take(&mut *files),
        Err(_) => Vec::new(),
    }
}

/// 두 번째 실행이 들어왔을 때. **마지막으로 활성이던 창**을 앞으로 올리고, 파일이 있으면
/// 그 창에만 알린다(§5). 창마다 고유 라벨이라 `emit_to`로 한 창에 보낸다 —
/// `Window::emit`은 전역 방송이라 창이 여럿이면 **모든 창이 같은 파일을 연다**.
pub fn on_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    let Some(window) = crate::winmgr::target_window(app) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    let files = file_args(&argv);
    if !files.is_empty() {
        let _ = app.emit_to(window.label(), OPEN_FILES_EVENT, files);
    }
}

#[cfg(test)]
mod tests {
    use super::file_args;

    #[test]
    fn 스위치와_없는_경로는_버린다() {
        // argv[0]은 실행 파일이라 늘 버린다.
        let exe = std::env::current_exe().expect("current_exe");
        let exe = exe.to_string_lossy().to_string();
        let argv = vec![exe.clone(), "--new".into(), "C:\\없는파일.md".into(), exe.clone()];
        // 남는 것은 "존재하는 파일"인 마지막 인자 하나뿐이다.
        assert_eq!(file_args(&argv), vec![exe]);
    }

    #[test]
    fn 인자가_없으면_빈_목록() {
        let argv: Vec<String> = vec!["Floaty Note.exe".into()];
        assert!(file_args(&argv).is_empty());
    }
}
