//! 알림 — 저장소 · 스케줄러 · 예약 API (§4, §5, MIGRATION_HANDOFF §7).
//!
//! **Rust가 유일한 작성자이자 스케줄러다**(지시 1). 이유는 §7의 한 줄 그대로다:
//! "알림이 두 번 울리거나 `reminders.tsv`를 덮어쓰지 않게 프로세스는 하나." 창 N개는
//! 모두 같은 프로세스의 webview이므로, 1초 타이머를 프론트에 두면 **창 수만큼 울린다**.
//! 그래서 여기 스레드 하나가 1초마다 보고, 파일은 여기서만 쓴다.
//!
//! ## 저장 — `%APPDATA%\Inkwell-Tauri\reminders.tsv`
//!
//! **원본 앱의 `%APPDATA%\Inkwell\reminders.tsv`는 절대 건드리지 않는다.** Win32
//! Inkwell이 아직 사용자 PC에서 돌아가므로 둘이 같은 파일을 쓰면 사용자의 실제 알림이
//! 날아간다(§7). 폴더가 `Inkwell-Tauri`인 이유다.
//!
//! 형식은 원본과 같은 **탭으로 나눈 한 줄 한 기록**이고(원본 주석: 알림은 설정이 아니라
//! 레코드다. 또 사람이 열어 보고 지울 수 있는 파일이어야 한다), §5가 요구한 **탭 참조
//! 칸**과 토스트 색을 위한 메모지 색 칸이 늘었다:
//!
//! ```text
//! id \t due \t selStart \t selEnd \t tabUid \t tint \t docPath \t text
//! ```
//!
//! 원본과 다르게 한 것 둘:
//!   * `due`가 FILETIME(1601년부터 100ns)이 아니라 **epoch 밀리초**다. 웹 쪽과 Rust가
//!     변환 없이 같은 숫자를 본다. 원본이 FILETIME을 고른 이유(절대 시각이라 재부팅을
//!     넘어 비교·직렬화된다)는 그대로다 — 기준점만 바꿨다.
//!   * `id`가 숫자가 아니라 문자열이다. 원본의 `unsigned`는 실행 중에만 뜻이 있어
//!     파일에 들어가지 않았는데, 우리는 세션의 탭(`Tab.reminder`)이 알림을 **실행 사이에**
//!     가리켜야 해서 파일에 들어가는 이름이 필요하다.
//!
//! 쓰기는 임시 파일 → rename이고, 예약이 하나도 없으면 **파일을 지운다**(원본과 같다 —
//! "없음"의 정직한 표현은 파일이 없는 것이다).
//!
//! ## 울린 뒤
//!
//! 울린 알림은 원본과 같이 목록에서 빠진다. 그런데 그 토스트를 누르면 숨은 탭이
//! 되살아나야 하므로(§5), **떠 있는 카드가 그 알림의 사본을 들고 있다**
//! (`toast.rs`의 슬롯). "아직 치우면 안 되는 탭"은 그래서
//! `대기 중인 알림 ∪ 떠 있는 카드`가 가리키는 탭이고, 그 합집합을 내는 것이
//! `reminder_state`다.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::session::{app_dir, write_atomic};
use crate::winmgr::Windows;

/// 알림 상태가 바뀌었다(예약·취소·발생·카드 닫힘) — 모든 창이 듣는다.
pub const REMINDERS_EVENT: &str = "inkwell://reminders";
/// 토스트를 눌렀다 — 그 문서·범위를 열어라.
pub const REVEAL_EVENT: &str = "inkwell://reminder-reveal";

const FILE_NAME: &str = "reminders.tsv";
/// 알림이 들고 가는 글의 길이 상한(원본 `kReminderTextMax`).
const TEXT_MAX: usize = 160;
/// 1초 틱 — 원본 `kReminderTimer`와 같은 주기.
const TICK: Duration = Duration::from_secs(1);
/// 스케줄러가 처음 도는 시각을 조금 늦춘다: 놓친 알림의 카드가 뜰 때 첫 창이 이미
/// 있어야 **작업 표시줄 깜빡임**이 의미가 있고(원본 `ReminderFire`), webview도 따뜻하다.
const STARTUP_DELAY: Duration = Duration::from_millis(700);

/// 알림 하나. 프론트의 `Reminder`와 1:1이다(`src/lib/reminders.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    /// 울릴 시각 — epoch 밀리초(UTC).
    pub due: i64,
    /// 이 알림이 걸린 탭(`Tab.uid`). §5가 요구한 칸이다.
    pub tab_uid: String,
    /// 그 탭의 파일 경로. 제목 없는 탭은 `None`.
    #[serde(default)]
    pub doc_path: Option<String>,
    /// 그 탭의 메모지 색 — 카드가 그 탭의 종이색으로 뜬다.
    pub tint: String,
    pub sel_start: i64,
    pub sel_end: i64,
    pub text: String,
}

/// 예약을 넣을 때 프론트가 주는 것. `id`는 여기서 발급한다.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderRequest {
    pub due: i64,
    pub tab_uid: String,
    #[serde(default)]
    pub doc_path: Option<String>,
    pub tint: String,
    pub sel_start: i64,
    pub sel_end: i64,
    pub text: String,
}

/// 모든 창에 알리는 상태. `held`는 **아직 치우면 안 되는 탭**의 `uid`다.
#[derive(Debug, Clone, Serialize)]
pub struct ReminderStateDto {
    pub pending: Vec<Reminder>,
    pub held: Vec<String>,
}

/// 토스트 클릭이 요구하는 것.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealRequest {
    pub tab_uid: String,
    pub doc_path: Option<String>,
    pub sel_start: i64,
    pub sel_end: i64,
    pub text: String,
}

// ---------------------------------------------------------------------------
// 순수한 쪽 — 직렬화 · 스케줄 판정
// ---------------------------------------------------------------------------

/// 탭·줄바꿈·역슬래시만 피한다(원본 `ReminderEscape`와 같은 네 가지).
pub fn escape_field(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            _ => out.push(c),
        }
    }
    out
}

pub fn unescape_field(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('n') => out.push('\n'),
            Some(other) => out.push(other),
            // 줄 끝의 외톨이 역슬래시 — 글자 그대로 둔다.
            None => out.push('\\'),
        }
    }
    out
}

/// 한 줄 한 기록. UTF-8(BOM 없음) + LF — `write_text_file`이 내는 것과 같은 형식이다.
pub fn serialize(list: &[Reminder]) -> String {
    let mut out = String::new();
    for r in list {
        out.push_str(&escape_field(&r.id));
        out.push('\t');
        out.push_str(&r.due.to_string());
        out.push('\t');
        out.push_str(&r.sel_start.to_string());
        out.push('\t');
        out.push_str(&r.sel_end.to_string());
        out.push('\t');
        out.push_str(&escape_field(&r.tab_uid));
        out.push('\t');
        out.push_str(&escape_field(&r.tint));
        out.push('\t');
        out.push_str(&escape_field(r.doc_path.as_deref().unwrap_or("")));
        out.push('\t');
        out.push_str(&escape_field(&r.text));
        out.push('\n');
    }
    out
}

/// 깨졌거나 칸이 모자란 줄은 **추측하지 않고 버린다**(원본과 같다).
pub fn parse(text: &str) -> Vec<Reminder> {
    let mut out = Vec::new();
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        // 마지막 칸(글)에는 탭이 들어 있을 수 없다(이스케이프됨) — 앞 일곱 칸만 끊는다.
        let fields: Vec<&str> = line.splitn(8, '\t').collect();
        if fields.len() != 8 {
            continue;
        }
        let Ok(due) = fields[1].parse::<i64>() else {
            continue;
        };
        let text = unescape_field(fields[7]);
        let id = unescape_field(fields[0]);
        if due <= 0 || text.is_empty() || id.is_empty() {
            continue;
        }
        let doc = unescape_field(fields[6]);
        out.push(Reminder {
            id,
            due,
            sel_start: fields[2].parse().unwrap_or(0),
            sel_end: fields[3].parse().unwrap_or(0),
            tab_uid: unescape_field(fields[4]),
            tint: unescape_field(fields[5]),
            doc_path: if doc.is_empty() { None } else { Some(doc) },
            text,
        });
    }
    out
}

/// 시각이 된 것과 아직 아닌 것으로 가른다. 발생(1초 틱)과 **놓친 알림**(시작할 때)이
/// 같은 판정을 쓴다 — 원본도 `AppCheckReminders`와 `ReminderStartup`이 같은 비교였다.
pub fn split_due(list: Vec<Reminder>, now: i64) -> (Vec<Reminder>, Vec<Reminder>) {
    let mut due = Vec::new();
    let mut rest = Vec::new();
    for r in list {
        if now >= r.due {
            due.push(r);
        } else {
            rest.push(r);
        }
    }
    (due, rest)
}

/// 여러 줄 선택을 한 단락으로(원본 `ReminderFlatten`). 프론트의 `flattenText`와 같은
/// 규칙이고, 프론트를 못 믿어서가 아니라 **파일에 들어가는 값의 상한을 쓰는 쪽이
/// 지켜야** 하기 때문에 여기서 한 번 더 한다.
pub fn flatten(input: &str, cap: usize) -> String {
    let mut out = String::new();
    let mut space = false;
    for ch in input.chars() {
        let c = if ch.is_control() || ch == '\t' { ' ' } else { ch };
        if c == ' ' {
            if out.is_empty() {
                continue;
            }
            space = true;
            continue;
        }
        if space {
            out.push(' ');
            space = false;
        }
        out.push(c);
        if out.chars().count() >= cap {
            out.push('…');
            break;
        }
    }
    out
}

/// 상주 종료 판정의 **네 가지 답**. §7: "알림 토스트가 사라질 때 트레이 상주 종료
/// 판단을 꼭 다시 할 것(안 하면 영원히 상주)."
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Residency {
    /// 창이 열려 있다 — 상주는 생각할 일이 아니다(트레이 아이콘을 치운다).
    HasWindow,
    /// 창은 없지만 예약이 남았다 — 트레이에 남는다.
    StayInTray,
    /// 창도 예약도 없지만 카드가 떠 있다 — 카드를 보여 주고, 닫힐 때 다시 판정한다.
    WaitForToast,
    /// 아무 이유도 없다 — 프로세스를 끝낸다.
    Quit,
}

/// 네 숫자만 보는 순수 판정. 원본 `AppMaybeQuit`의 순서와 같다.
pub fn decide(windows: usize, pending: usize, toasts: usize) -> Residency {
    if windows > 0 {
        return Residency::HasWindow;
    }
    if pending > 0 {
        return Residency::StayInTray;
    }
    if toasts > 0 {
        return Residency::WaitForToast;
    }
    Residency::Quit
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Inner {
    pending: Vec<Reminder>,
    /// id를 발급하는 번호. 파일에서 읽은 번호보다 늘 크다.
    next: u64,
    /// 창이 뜨기 **전에** 눌린 토스트가 남긴 요청. 트레이에 상주하던 중 카드를 누르면
    /// 창이 그때 만들어지므로 이벤트만으로는 리스너가 붙기 전에 사라진다
    /// (`ghost_paint`·`take_cli_files`와 같은 두 길 구조).
    reveal: Option<RevealRequest>,
}

#[derive(Default)]
pub struct Reminders {
    inner: Mutex<Inner>,
    /// 스케줄러 스레드를 두 번 띄우지 않기 위한 깃발.
    started: AtomicBool,
}

fn lock(state: &Reminders) -> MutexGuard<'_, Inner> {
    // 독이 올라도 앱을 죽이지 않는다(세션·창 목록과 같은 판단).
    state.inner.lock().unwrap_or_else(|e| e.into_inner())
}

fn store_path() -> Result<PathBuf, String> {
    Ok(app_dir()?.join(FILE_NAME))
}

fn read_store() -> Vec<Reminder> {
    let Ok(path) = store_path() else {
        return Vec::new();
    };
    match fs::read_to_string(&path) {
        Ok(text) => parse(&text),
        Err(_) => Vec::new(),
    }
}

/// 임시 파일 → rename. 하나도 없으면 파일을 지운다(원본과 같다).
fn write_store(list: &[Reminder]) -> Result<(), String> {
    let path = store_path()?;
    if list.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("알림 폴더를 만들 수 없습니다: {e}"))?;
    }
    write_atomic(&path, &serialize(list))
}

fn next_id(inner: &mut Inner) -> String {
    inner.next += 1;
    format!("{}-{}", now_ms(), inner.next)
}

impl Reminders {
    pub fn pending(&self) -> Vec<Reminder> {
        lock(self).pending.clone()
    }

    pub fn count(&self) -> usize {
        lock(self).pending.len()
    }

    pub fn put_reveal(&self, req: RevealRequest) {
        lock(self).reveal = Some(req);
    }

    pub fn take_reveal(&self) -> Option<RevealRequest> {
        lock(self).reveal.take()
    }
}

/// 지금 상태 + **아직 치우면 안 되는 탭**. 떠 있는 카드가 가리키는 탭도 함께 센다.
pub fn state_of(app: &AppHandle) -> ReminderStateDto {
    let pending = app.state::<Reminders>().pending();
    let mut held: Vec<String> = pending.iter().map(|r| r.tab_uid.clone()).collect();
    for uid in crate::toast::held_tabs(app) {
        if !held.iter().any(|h| h == &uid) {
            held.push(uid);
        }
    }
    held.retain(|u| !u.is_empty());
    ReminderStateDto { pending, held }
}

/// 모든 창에 상태를 뿌린다. 예약·취소·발생·카드 닫힘 **네 자리**에서 부른다 — 어느
/// 한 자리를 빠뜨리면 메뉴의 `예약된 알림`과 상태 글자가 낡고, 숨은 탭이 안 치워진다.
pub fn broadcast(app: &AppHandle) {
    let dto = state_of(app);
    for label in app.state::<Windows>().order() {
        let _ = app.emit_to(label.as_str(), REMINDERS_EVENT, dto.clone());
    }
}

// ---------------------------------------------------------------------------
// 스케줄러 — 1초 틱 하나
// ---------------------------------------------------------------------------

/// 앱이 시작할 때 한 번. 파일을 읽고, **놓친 알림**을 먼저 띄운 뒤 1초 틱을 돈다.
pub fn start(app: &AppHandle) {
    let state = app.state::<Reminders>();
    if state.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        startup(&app);
        loop {
            std::thread::sleep(TICK);
            tick(&app);
        }
    });
}

/// 앱이 꺼져 있던 동안 지난 알림 — 조용히 버리지 않고 `(놓침 시각) 본문`으로 띄운다
/// (원본 `ReminderStartup`: 사용자가 못 본 알림이 늦은 알림보다 나쁘다).
fn startup(app: &AppHandle) {
    let loaded = read_store();
    let max = loaded
        .iter()
        .filter_map(|r| r.id.rsplit('-').next().and_then(|n| n.parse::<u64>().ok()))
        .max()
        .unwrap_or(0);
    let (missed, rest) = split_due(loaded, now_ms());
    {
        let state = app.state::<Reminders>();
        let mut inner = lock(&state);
        inner.next = inner.next.max(max);
        inner.pending = rest;
    }
    if !missed.is_empty() {
        let _ = write_store(&app.state::<Reminders>().pending());
    }
    // 원본과 같이 카드는 쌓인다 — 놓친 알림이 여럿이면 한꺼번에 읽을 수 있다.
    // `tick`과 같은 이유로 **카드를 먼저 세우고** 알린다(저쪽 주석에 이유).
    for r in missed {
        crate::toast::fire(app, &r, true);
    }
    broadcast(app);
    crate::toast::reconsider(app);
}

fn tick(app: &AppHandle) {
    let state = app.state::<Reminders>();
    let fired = {
        let mut inner = lock(&state);
        if inner.pending.is_empty() {
            return;
        }
        let list = std::mem::take(&mut inner.pending);
        let (due, rest) = split_due(list, now_ms());
        inner.pending = rest;
        due
    };
    if fired.is_empty() {
        return;
    }
    let _ = write_store(&state.pending());
    /*
     * **순서가 중요하다 — 카드를 먼저 세우고 그 다음에 알린다.**
     *
     * `broadcast`가 보내는 `held`는 "대기 중인 알림 ∪ 떠 있는 카드"가 가리키는 탭이다
     * (`state_of`). 방금 울린 알림은 `pending`에서 빠졌으므로, 카드가 생기기 **전에**
     * 알리면 그 탭은 양쪽 어디에도 없다 → 프론트의 `reconcileReminderTabs`가
     * **숨은 탭을 치워 버린다**(§5의 "알림 토스트를 누를 때만 되살아난다"가 깨지고,
     * 저장하지 않은 글이 그대로 사라진다). 점검(2026-11-08)에서 잡은 버그이고,
     * §7이 경고한 "종료 판단 순서" 함정과 같은 모양이다.
     */
    for r in &fired {
        crate::toast::fire(app, r, false);
    }
    broadcast(app);
    // 마지막 알림이 울렸다면 상주 이유가 사라졌을 수 있다(카드가 닫힐 때 또 본다).
    crate::toast::reconsider(app);
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

/// 예약 하나를 넣는다 — **예약 창과 AI 없는 유일한 입구**(원본 `ReminderAdd`와 같은 자리).
#[tauri::command]
pub fn reminder_add(app: AppHandle, req: ReminderRequest) -> Result<Reminder, String> {
    let text = flatten(&req.text, TEXT_MAX);
    if text.is_empty() {
        return Err("알림에 담을 글이 없습니다".into());
    }
    let reminder = {
        let state = app.state::<Reminders>();
        let mut inner = lock(&state);
        let reminder = Reminder {
            id: next_id(&mut inner),
            due: req.due,
            tab_uid: req.tab_uid,
            doc_path: req.doc_path.filter(|p| !p.is_empty()),
            tint: req.tint,
            sel_start: req.sel_start,
            sel_end: req.sel_end,
            text,
        };
        inner.pending.push(reminder.clone());
        reminder
    };
    write_store(&app.state::<Reminders>().pending())?;
    broadcast(&app);
    Ok(reminder)
}

/// 예약 하나를 취소한다. **마지막 예약을 취소하면 상주 이유가 사라진다** —
/// 그래서 여기서도 종료 판정을 다시 돌린다(원본 `ReminderCancel`과 같다).
#[tauri::command]
pub fn reminder_cancel(app: AppHandle, id: String) -> Result<bool, String> {
    let found = {
        let state = app.state::<Reminders>();
        let mut inner = lock(&state);
        let before = inner.pending.len();
        inner.pending.retain(|r| r.id != id);
        before != inner.pending.len()
    };
    if !found {
        return Ok(false);
    }
    write_store(&app.state::<Reminders>().pending())?;
    broadcast(&app);
    crate::toast::reconsider(&app);
    Ok(true)
}

#[tauri::command]
pub fn reminder_state(app: AppHandle) -> ReminderStateDto {
    state_of(&app)
}

/// 창이 뜨기 전에 눌린 토스트가 남긴 요청을 꺼내 간다.
#[tauri::command]
pub fn reminder_take_reveal(state: tauri::State<'_, Reminders>) -> Option<RevealRequest> {
    state.take_reveal()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(id: &str, due: i64, text: &str) -> Reminder {
        Reminder {
            id: id.into(),
            due,
            tab_uid: "tab1".into(),
            doc_path: Some("C:\\메모\\할 일.md".into()),
            tint: "yellow".into(),
            sel_start: 12,
            sel_end: 30,
            text: text.into(),
        }
    }

    #[test]
    fn tsv는_왕복한다() {
        let list = vec![r("1-1", 1_800_000_000_000, "회고 쓰기"), {
            let mut x = r("1-2", 1_800_000_060_000, "탭\t줄\n바꿈 \\ 섞인 글");
            x.doc_path = None;
            x.tint = "none".into();
            x
        }];
        let text = serialize(&list);
        // 기록 하나가 정확히 한 줄이다 — 글에 든 줄바꿈이 줄을 쪼개지 않는다.
        assert_eq!(text.lines().count(), 2);
        assert_eq!(parse(&text), list);
    }

    #[test]
    fn 깨진_줄은_버린다() {
        let good = serialize(&[r("1-1", 1_800_000_000_000, "하나")]);
        let text = format!("{good}칸이\t모자란\t줄\nid\t시각아님\t0\t0\tt\tnone\t\t글\n");
        let got = parse(&text);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].text, "하나");
    }

    #[test]
    fn 시각이_된_것만_갈라진다() {
        let list = vec![r("a", 100, "지남"), r("b", 300, "아직")];
        let (due, rest) = split_due(list, 200);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "a");
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, "b");
        // 같은 시각이면 **울린다**(원본 `now >= dueUtc`).
        let (due, rest) = split_due(vec![r("c", 200, "정각")], 200);
        assert_eq!(due.len(), 1);
        assert!(rest.is_empty());
    }

    #[test]
    fn 여러_줄_선택은_한_단락이_된다() {
        assert_eq!(flatten("  첫 줄\r\n\t둘째   줄  ", TEXT_MAX), "첫 줄 둘째 줄");
        // 상한을 넘으면 자른 표시가 붙는다.
        let long = "가".repeat(200);
        let cut = flatten(&long, 160);
        assert_eq!(cut.chars().count(), 161);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn 종료_판정은_네_가지다() {
        assert_eq!(decide(1, 0, 0), Residency::HasWindow);
        // 창이 있으면 예약·카드가 있어도 상주는 생각할 일이 아니다.
        assert_eq!(decide(2, 3, 1), Residency::HasWindow);
        assert_eq!(decide(0, 1, 0), Residency::StayInTray);
        // 예약이 남아 있으면 카드가 떠 있어도 트레이다(둘 다면 상주가 이긴다).
        assert_eq!(decide(0, 1, 2), Residency::StayInTray);
        // §7: 카드가 사라질 때 다시 판정해야 하는 그 상태.
        assert_eq!(decide(0, 0, 1), Residency::WaitForToast);
        assert_eq!(decide(0, 0, 0), Residency::Quit);
    }
}
