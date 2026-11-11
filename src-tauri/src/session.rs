//! 세션 저장소 — `%APPDATA%\Inkwell-Tauri\session\`. **쓰는 곳은 여기 하나다.**
//!
//! **원본 앱의 자리(`%APPDATA%\Inkwell\session\`)는 절대 건드리지 않는다.** Win32 Inkwell이
//! 아직 사용자 PC에서 돌아가므로 둘이 같은 폴더를 쓰면 사용자의 실제 세션이 날아간다
//! (MIGRATION_HANDOFF §7). 폴더 이름이 `Inkwell-Tauri`인 이유다.
//!
//! 들어 있는 것 (원본 `SessionDir()`의 구성과 1:1):
//!
//!   session.json        창 목록 → 탭 목록. 모양은 **프론트가 정한다**(`src/lib/session.ts`).
//!   buf_<탭ID>.txt      미저장 탭의 글(= 그 탭을 저장했다면 나왔을 바이트)
//!   buf_<탭ID>.hist.json 그 탭의 실행 취소 스택
//!
//! ## 다중 창 — 왜 Rust가 인덱스를 **조립**하는가
//!
//! 창이 여럿이면 각 창의 프론트가 자기 상태를 알고 있고, 창마다 `session.json`을 통째로
//! 쓰면 **마지막에 쓴 창만 남는다**(먼저 쓴 창의 탭이 사라진다). 그래서 창은 자기 기록
//! 하나만 보내고(`session_put_window`), 여기서 **창별 스냅샷을 모아 하나의 인덱스로**
//! 쓴다. 쓰는 주체가 하나이므로 경쟁이 구조적으로 없다.
//!
//!   live    라벨 → 그 창의 기록. 창이 자기 기록을 보낼 때마다 갈아 끼운다.
//!   frozen  닫힌 창의 기록(§5: "먼저 닫은 창도 그 실행 동안 보관 → 다음 실행에 모든 창이
//!           돌아온다")과, 시작할 때 읽었지만 아직 창으로 되살리지 못한 기록.
//!
//! 인덱스의 창 순서는 **살아 있는 창을 만든 순서 + 얼린 창**이고, `activeWindow`는
//! 마지막으로 활성이던 창의 자리다(`winmgr::Windows`가 안다).
//!
//! ## 버퍼 정리
//!
//! 이름이 `buf_<탭ID>`인 것은 원본의 판단 그대로다: 인덱스 번호로 이름을 붙이면 창이
//! 여럿일 때 한 창의 정리가 다른 창의 글을 지운다(원본 R15, MIGRATION_HANDOFF §7).
//! 정리 규칙은 **"조립한 인덱스가 — 즉 모든 창의 모든 탭이 — 이름을 대지 않은 `buf_*`는
//! 전부 지운다"**이고 상한이 없다. `keep` 목록을 프론트가 주지 않고 여기서 인덱스를 읽어
//! 구하는 이유가 그것이다: 한 창이 자기 탭만 담은 `keep`을 주면 다른 창의 버퍼를 지운다.
//!
//! 모든 쓰기는 **임시 파일 → 제자리 바꿔치기**다(`write_atomic`). 쓰는 도중에 죽어도
//! 이전 세션이 멀쩡히 남는다.
//! 쓰는 순서도 원본과 같다: 버퍼를 먼저 다 쓰고, 그 다음 인덱스, **성공한 뒤에** 정리.
//!
//! 쓰기가 하나도 실패하지 않았을 때만 `Ok`다. 프론트는 실패를 받으면 **탭마다 D1로 묻는
//! 길**로 떨어진다(§5: "세션 저장 자체가 실패했을 때만 묻는다").

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Window};

use crate::winmgr::{is_main_label, main_window_count, Windows};

const DIR_NAME: &str = "Inkwell-Tauri";
const SESSION_DIR: &str = "session";
const INDEX_NAME: &str = "session.json";
/// 버퍼 파일 이름의 머리. 정리 규칙("이 머리로 시작하는데 인덱스가 안 대는 것")의 기준.
const BUF_PREFIX: &str = "buf_";
/// 인덱스 형식 번호 — `src/lib/session.ts`의 `SESSION_VERSION`과 같아야 한다.
const SESSION_VERSION: u64 = 1;

#[derive(Deserialize)]
pub struct SessionBuffer {
    /// `buf_<탭ID>.txt` 같은 **파일 이름 하나**. 경로가 아니다.
    name: String,
    text: String,
}

/// 닫기 규칙(§5)이 보는 수치 — 이 창 말고 세션에 남는 것이 있는가.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCounts {
    /// 살아 있는 메인 창의 수(이 창을 포함한다).
    pub live: usize,
    /// 얼려 둔 창의 수.
    pub frozen: usize,
}

#[derive(Default)]
struct Inner {
    /// 라벨 → 그 창이 마지막으로 보낸 기록.
    live: HashMap<String, Value>,
    /// 얼린 창 + 아직 되살리지 못한 창의 기록(닫힌/읽은 순서).
    frozen: Vec<Value>,
    /// **마지막으로 활성이던 창의 기록 `id`.** 창이 전부 닫히면 `last_active`가 가리킬
    /// 살아 있는 창이 없어지므로, 얼릴 때 그 창이 활성이었는지를 여기 적어 둔다.
    /// 없으면 다음 실행이 **먼저 닫은 창**을 활성으로 열게 되어 §5와 어긋난다.
    active_id: Option<String>,
}

#[derive(Default)]
pub struct SessionState(Mutex<Inner>);

fn lock(state: &SessionState) -> MutexGuard<'_, Inner> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// 기록을 가리키는 이름 = 프론트의 `SessionWindow.id`. 창 라벨이 아니다(라벨은 실행마다
/// 다시 쓰이고, `id`는 실행 사이에 안 바뀐다).
fn record_id(record: &Value) -> Option<String> {
    record.get("id")?.as_str().map(|s| s.to_string())
}

fn tab_count(record: &Value) -> usize {
    record
        .get("tabs")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

/// 점검용 데이터 폴더 바꿔치기 — **디버그 빌드에만 있다.**
///
/// `INKWELL_DATA_DIR`이 있으면 이 앱이 쓰는 **모든** 데이터(설정·세션·알림·최근 파일)가
/// 그 폴더 아래로 간다. 사람이 쓰는 인스턴스와 점검용 인스턴스를 같은 PC에서 함께
/// 띄워도 서로의 파일을 덮어쓰지 않게 하는 용도다. 릴리스 빌드에서는 이 함수 자체가
/// 사라지므로(`#[cfg(debug_assertions)]`) 환경변수를 넣어도 아무 일이 없다 —
/// 데이터 자리는 언제나 `%APPDATA%\Inkwell-Tauri`다.
#[cfg(debug_assertions)]
fn data_dir_override() -> Option<PathBuf> {
    let raw = std::env::var_os("INKWELL_DATA_DIR")?;
    if raw.is_empty() {
        return None;
    }
    Some(PathBuf::from(raw))
}

/// 점검용 WebView2 사용자 데이터 폴더 — **디버그 빌드에만 있다.**
///
/// WebView2는 **사용자 데이터 폴더마다 브라우저 프로세스 하나**를 띄우고, 같은 폴더에
/// 다른 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`로 두 번째 환경을 만들려 하면
/// `0x8007139F`로 거절한다. 그래서 `INKWELL_DATA_DIR`로 띄운 인스턴스는 WebView2
/// 캐시·localStorage까지 그 폴더 아래로 옮긴다 — "이 앱이 쓰는 모든 데이터"에 들어가고,
/// 그래야 사람이 쓰는 인스턴스와 나란히 띄울 수 있다. 릴리스 빌드에는 없다.
#[cfg(debug_assertions)]
pub fn webview_data_dir() -> Option<PathBuf> {
    data_dir_override().map(|d| d.join("webview2"))
}

/// 위 폴더를 창 빌더에 끼운다(디버그 빌드 전용 · 환경변수가 없으면 그대로 돌려준다).
/// 창을 만드는 자리가 네 군데(설정 창·떼어낸 창·고스트·알림 카드)라 여기 모아 둔다.
#[cfg(debug_assertions)]
pub fn with_webview_data_dir<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    match webview_data_dir() {
        Some(dir) => builder.data_directory(dir),
        None => builder,
    }
}

/// `%APPDATA%\Inkwell-Tauri` — 세션·설정·`reminders.tsv`가 함께 사는 폴더.
/// (**원본 앱의 `%APPDATA%\Inkwell`이 아니다** — §7.)
pub fn app_dir() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(dir) = data_dir_override() {
        return Ok(dir);
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| "APPDATA를 읽을 수 없습니다".to_string())?;
    Ok(base.join(DIR_NAME))
}

fn session_dir() -> Result<PathBuf, String> {
    Ok(app_dir()?.join(SESSION_DIR))
}

/// 프론트가 준 이름이 **이 폴더 안의 버퍼 파일 이름**인지. 경로 구분자·`..`·드라이브
/// 문자가 섞인 이름은 거부한다 — 프론트가 보내는 값이라도 폴더 밖으로 나갈 길을
/// 열어 두지 않는다(사용자 문서 폴더에 쓰는 사고를 반복할 수 없게).
fn safe_buffer_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name.starts_with(BUF_PREFIX)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        && !name.contains("..");
    if ok {
        Ok(())
    } else {
        Err(format!("버퍼 이름이 올바르지 않습니다: {name}"))
    }
}

/// 임시 파일에 쓰고 fsync한 뒤 제자리로 **바꿔치기한다**(`textfile::replace_file` =
/// Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`).
///
/// 예전에는 "지우고 옮기기"였다. `fs::rename`이 Windows에서 대상이 있으면 실패하기
/// 때문인데, 그 사이(지운 뒤 · 옮기기 전)에 죽으면 **세션 파일이 아예 없다** — 임시
/// 파일 → rename이 막으려던 바로 그 사고다. 한 번에 바꿔치기하면 그 틈이 없다.
/// 세션·설정·알림·최근 파일이 모두 이 함수를 쓴다.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    {
        let mut file =
            fs::File::create(&temp).map_err(|e| format!("임시 파일을 만들 수 없습니다: {e}"))?;
        let written = file
            .write_all(text.as_bytes())
            .and_then(|()| file.sync_all());
        if let Err(e) = written {
            drop(file);
            let _ = fs::remove_file(&temp);
            return Err(format!("파일을 쓸 수 없습니다: {e}"));
        }
    }
    if let Err(e) = crate::textfile::replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("파일을 옮길 수 없습니다: {e}"));
    }
    Ok(())
}

/// 창별 기록을 **하나의 인덱스로 조립한다**. 순서는 살아 있는 창을 만든 순서 + 얼린 창이고,
/// 같은 `id`가 두 번 들어가지 않는다(한 창을 얼린 직후 그 창이 한 번 더 보낼 수 있다).
/// 탭이 하나도 없는 창은 버린다(원본과 같다 — `parseSession`도 그렇게 읽는다).
fn assemble(inner: &Inner, order: &[String], active_label: Option<&str>) -> (Value, usize) {
    let mut windows: Vec<Value> = Vec::new();
    let mut ids: Vec<String> = Vec::new();
    let mut active: Option<usize> = None;

    let push = |record: &Value, ids: &mut Vec<String>, windows: &mut Vec<Value>| -> bool {
        if tab_count(record) == 0 {
            return false;
        }
        if let Some(id) = record_id(record) {
            if ids.iter().any(|k| k == &id) {
                return false;
            }
            ids.push(id);
        }
        windows.push(record.clone());
        true
    };

    for label in order {
        if let Some(record) = inner.live.get(label) {
            let at = windows.len();
            if push(record, &mut ids, &mut windows) && Some(label.as_str()) == active_label {
                active = Some(at);
            }
        }
    }
    // 목록에 없는 라벨(창 등록 순서를 놓친 경우)도 잃지 않는다.
    for (label, record) in &inner.live {
        if !order.iter().any(|l| l == label) {
            push(record, &mut ids, &mut windows);
        }
    }
    for record in &inner.frozen {
        push(record, &mut ids, &mut windows);
    }

    // 살아 있는 창 중에 활성이 없다면(창이 전부 닫혔다) 마지막에 활성이던 **얼린** 창이다.
    let active = active
        .or_else(|| {
            inner
                .active_id
                .as_ref()
                .and_then(|id| ids.iter().position(|k| k == id))
        })
        .unwrap_or(0);

    let count = windows.len();
    (
        json!({ "v": SESSION_VERSION, "activeWindow": active, "windows": windows }),
        count,
    )
}

/// 조립한 인덱스가 이름을 대는 버퍼 전부 — **모든 창의 모든 탭** 기준이다.
fn referenced_buffers(index: &Value) -> Vec<String> {
    let mut names = Vec::new();
    let Some(windows) = index.get("windows").and_then(Value::as_array) else {
        return names;
    };
    for win in windows {
        let Some(tabs) = win.get("tabs").and_then(Value::as_array) else {
            continue;
        };
        for tab in tabs {
            for key in ["buf", "hist"] {
                if let Some(name) = tab.get(key).and_then(Value::as_str) {
                    names.push(name.to_string());
                }
            }
        }
    }
    names
}

/// 지금 상태를 디스크에 쓴다. 쓸 창이 하나도 없으면 **아무것도 하지 않는다** —
/// 디스크의 세션을 잘라 내지 않는다(마지막 창의 닫기가 이미 다 썼을 수 있다).
fn flush(app: &AppHandle, inner: &Inner) -> Result<(), String> {
    let reg = app.state::<Windows>();
    let order = reg.order();
    let active = reg.last_active();
    let (index, count) = assemble(inner, &order, active.as_deref());
    if count == 0 {
        return Ok(());
    }
    let dir = session_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("세션 폴더를 만들 수 없습니다: {e}"))?;
    let text = serde_json::to_string(&index).map_err(|e| format!("세션 직렬화 실패: {e}"))?;
    write_atomic(&dir.join(INDEX_NAME), &text)?;
    // 인덱스를 성공적으로 쓴 **뒤에만** 정리한다(원본 `SessionGcBuffers`와 같은 이유).
    gc_buffers(&dir, &referenced_buffers(&index));
    Ok(())
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

/// 인덱스 파일의 글. 없으면 `None` — 첫 실행과 똑같이 동작한다.
#[tauri::command]
pub fn session_load() -> Result<Option<String>, String> {
    let path = session_dir()?.join(INDEX_NAME);
    Ok(fs::read_to_string(&path).ok())
}

/// 버퍼 하나. 없으면 오류이고, 프론트는 그 탭을 빈 탭으로 되살린다.
#[tauri::command]
pub fn session_load_buffer(name: String) -> Result<String, String> {
    safe_buffer_name(&name)?;
    let path = session_dir()?.join(&name);
    fs::read_to_string(&path).map_err(|e| format!("버퍼를 읽을 수 없습니다: {e}"))
}

/// 창 하나가 자기 기록과 버퍼를 보낸다. 버퍼 → 인덱스 조립 → 쓰기 → 정리 순서다.
///
/// 보낸 기록과 **같은 `id`의 얼린 기록은 지운다**: 시작할 때 읽어 둔 기록(아직 창이
/// 아니었던 것)이 그 창이 실제로 뜨면서 live로 넘어오는 자리다. 그러지 않으면 같은 창이
/// 두 번 들어가고, 다음 실행에 유령 창이 하나 더 뜬다.
#[tauri::command]
pub fn session_put_window(
    app: AppHandle,
    window: Window,
    record: String,
    buffers: Vec<SessionBuffer>,
) -> Result<(), String> {
    let label = window.label().to_string();
    if !is_main_label(&label) {
        return Err("고스트 창은 세션에 들어가지 않습니다".into());
    }
    let value: Value =
        serde_json::from_str(&record).map_err(|e| format!("세션 기록을 읽을 수 없습니다: {e}"))?;

    let dir = session_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("세션 폴더를 만들 수 없습니다: {e}"))?;
    for buf in &buffers {
        safe_buffer_name(&buf.name)?;
        write_atomic(&dir.join(&buf.name), &buf.text)?;
    }

    let state = app.state::<SessionState>();
    let mut inner = lock(&state);
    if let Some(id) = record_id(&value) {
        inner.frozen.retain(|r| record_id(r).as_deref() != Some(&id));
    }
    inner.live.insert(label, value);
    flush(&app, &inner)
}

/// 이 창을 **얼린다**(§5). 창이 사라져도 그 기록은 이번 실행 동안 남고 다음 실행에
/// 모든 창이 돌아온다. 창을 닫기 **직전에**, 기록을 보낸 **뒤에** 부른다.
#[tauri::command]
pub fn session_freeze_window(app: AppHandle, window: Window) -> Result<(), String> {
    let label = window.label().to_string();
    // 지금 이 창이 활성이었는가 — 창이 사라진 뒤에는 알 수 없으므로 여기서 적어 둔다.
    let was_active = app.state::<Windows>().last_active().as_deref() == Some(label.as_str());
    let state = app.state::<SessionState>();
    let mut inner = lock(&state);
    if let Some(record) = inner.live.remove(&label) {
        if tab_count(&record) > 0 {
            if let Some(id) = record_id(&record) {
                inner.frozen.retain(|r| record_id(r).as_deref() != Some(&id));
                if was_active {
                    inner.active_id = Some(id);
                }
            }
            inner.frozen.push(record);
        }
    }
    flush(&app, &inner)
}

/// 이 창을 세션에서 **지운다**(얼리지 않는다). 마지막 탭을 다른 창으로 합쳐서 창이
/// 사라질 때의 길이다 — 그 탭은 다른 창에 살아 있으므로 여기서 되살아나면 복제된다(§5).
#[tauri::command]
pub fn session_forget_window(app: AppHandle, window: Window) -> Result<(), String> {
    let label = window.label().to_string();
    let state = app.state::<SessionState>();
    let mut inner = lock(&state);
    inner.live.remove(&label);
    flush(&app, &inner)
}

/// 시작할 때 읽은 세션 중 **첫 창이 쓰지 않은 기록들**을 들고 있는다. 그 창들이 실제
/// 창으로 뜨면서 `session_put_window`가 같은 `id`를 live로 옮긴다.
#[tauri::command]
pub fn session_adopt(app: AppHandle, records: Vec<String>) -> Result<(), String> {
    let state = app.state::<SessionState>();
    let mut inner = lock(&state);
    inner.frozen.clear();
    inner.active_id = None;
    for text in records {
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            if tab_count(&value) > 0 {
                inner.frozen.push(value);
            }
        }
    }
    // 아직 디스크를 고치지 않는다 — 읽은 그대로이므로 쓸 이유가 없고, 창이 뜨는 중에
    // 쓰면 그 사이에 죽었을 때 반쪽 세션이 남는다.
    Ok(())
}

/// 그 탭(`Tab.uid`)을 지금 들고 있는 **창의 라벨**. 알림 토스트를 눌렀을 때 "어느 창이
/// 그 탭을 갖고 있나"를 알아야 하는 자리다(`toast::reminder_open`): 아무 창에나 보내면
/// 그 창이 같은 문서를 **한 번 더** 열어 탭이 복제된다.
///
/// 창이 자기 상태를 보낼 때마다 갈아 끼우는 `live` 기록을 읽는다 — 프론트는 변경 뒤
/// 1.5초마다 세션을 쓰므로 이 답은 사실상 지금의 것이다. 숨은 탭도 기록에 들어 있다.
pub fn window_with_tab(app: &AppHandle, uid: &str) -> Option<String> {
    let state = app.state::<SessionState>();
    let inner = lock(&state);
    for (label, record) in &inner.live {
        let Some(tabs) = record.get("tabs").and_then(Value::as_array) else {
            continue;
        };
        if tabs
            .iter()
            .any(|t| t.get("id").and_then(Value::as_str) == Some(uid))
        {
            return Some(label.clone());
        }
    }
    None
}

/// 닫기 규칙(§5)이 보는 수치.
#[tauri::command]
pub fn session_counts(app: AppHandle) -> SessionCounts {
    let state = app.state::<SessionState>();
    let inner = lock(&state);
    SessionCounts {
        live: main_window_count(&app),
        frozen: inner.frozen.len(),
    }
}

/// 세션을 버린다 — 설정이 "새 세션 시작 및 저장되지 않은 변경 내용 삭제"일 때 쓴다.
#[tauri::command]
pub fn session_clear(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<SessionState>();
        let mut inner = lock(&state);
        inner.live.clear();
        inner.frozen.clear();
        inner.active_id = None;
    }
    let dir = session_dir()?;
    let _ = fs::remove_file(dir.join(INDEX_NAME));
    gc_buffers(&dir, &[]);
    Ok(())
}

/// 인덱스가 이름을 대지 않은 `buf_*`는 전부 지운다. 상한이 없고 살아 있는 창의 버퍼에
/// 닿을 수 없다(원본 R15).
fn gc_buffers(dir: &Path, keep: &[String]) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(BUF_PREFIX) {
            continue;
        }
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        if keep.iter().any(|k| k.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, tabs: &[&str]) -> Value {
        let tabs: Vec<Value> = tabs
            .iter()
            .map(|t| json!({ "id": t, "buf": format!("buf_{t}.txt"), "hist": Value::Null }))
            .collect();
        json!({ "id": id, "tabs": tabs })
    }

    /// 대상이 **이미 있어도** 한 번에 바꿔치기하고 임시 파일을 남기지 않는다
    /// (Windows의 `fs::rename`은 여기서 실패한다 — `textfile::replace_file`을 쓰는 이유).
    #[test]
    fn 쓰기는_대상이_있어도_제자리를_바꿔치기한다() {
        let dir = std::env::temp_dir().join("inkwell-session-atomic-test");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.json");

        write_atomic(&path, "first").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first");
        write_atomic(&path, "second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        assert!(!dir.join("session.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 버퍼_이름은_폴더_밖으로_나갈_수_없다() {
        assert!(safe_buffer_name("buf_abc.txt").is_ok());
        assert!(safe_buffer_name("buf_abc.hist.json").is_ok());
        // 머리가 다르면 거부 — 정리 규칙이 닿지 않는 이름을 만들 수 없게.
        assert!(safe_buffer_name("session.json").is_err());
        // 경로가 섞인 이름은 전부 거부.
        assert!(safe_buffer_name("buf_../../x.txt").is_err());
        assert!(safe_buffer_name("buf_a\\b.txt").is_err());
        assert!(safe_buffer_name("buf_a/b.txt").is_err());
        assert!(safe_buffer_name("").is_err());
    }

    #[test]
    fn 조립은_창_순서를_지키고_활성_창을_가리킨다() {
        let mut inner = Inner::default();
        inner.live.insert("main".into(), record("w1", &["a"]));
        inner.live.insert("win1".into(), record("w2", &["b"]));
        inner.frozen.push(record("w3", &["c"]));

        let order = vec!["main".to_string(), "win1".to_string()];
        let (index, count) = assemble(&inner, &order, Some("win1"));
        assert_eq!(count, 3);
        assert_eq!(index["activeWindow"], json!(1));
        let ids: Vec<&str> = index["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["w1", "w2", "w3"]);
    }

    #[test]
    fn 같은_id는_한_번만_들어가고_빈_창은_버린다() {
        let mut inner = Inner::default();
        inner.live.insert("main".into(), record("w1", &["a"]));
        inner.live.insert("win1".into(), record("w2", &[]));
        // 얼린 쪽에 같은 창이 남아 있어도 복제되지 않는다.
        inner.frozen.push(record("w1", &["a"]));
        let (index, count) = assemble(&inner, &["main".to_string(), "win1".to_string()], None);
        assert_eq!(count, 1);
        assert_eq!(index["windows"][0]["id"], json!("w1"));
    }

    #[test]
    fn 창이_전부_닫히면_마지막에_활성이던_얼린_창을_가리킨다() {
        let mut inner = Inner::default();
        // 창 둘을 차례로 닫았고, 나중에 닫은 w2가 활성이었다.
        inner.frozen.push(record("w1", &["a"]));
        inner.frozen.push(record("w2", &["b"]));
        inner.active_id = Some("w2".into());
        let (index, count) = assemble(&inner, &[], None);
        assert_eq!(count, 2);
        // 적어 두지 않으면 **먼저 닫은** w1(0번)이 활성이 된다.
        assert_eq!(index["activeWindow"], json!(1));
    }

    #[test]
    fn 정리_목록은_모든_창의_모든_탭을_모은다() {
        let mut inner = Inner::default();
        inner.live.insert("main".into(), record("w1", &["a", "b"]));
        inner.frozen.push(record("w2", &["c"]));
        let (index, _) = assemble(&inner, &["main".to_string()], None);
        let mut keep = referenced_buffers(&index);
        keep.sort();
        assert_eq!(keep, vec!["buf_a.txt", "buf_b.txt", "buf_c.txt"]);
    }
}
