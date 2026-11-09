mod cli;
mod clipboard;
mod drag;
mod fonts;
mod overlay;
mod recent;
mod reminders;
mod session;
mod settings;
mod syscmd;
mod textfile;
mod toast;
mod winmgr;

#[cfg(desktop)]
fn register_global_shortcuts(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    // Ctrl+Shift+Alt+N: 보이면 숨기고, 숨어 있으면 보이고 포커스.
    // Alt+Space는 Windows 창 메뉴라서 손대지 않는다. Ctrl+Alt+Space는 이 PC에서 다른 앱이 점유.
    //
    // **다중 창에서는 모든 창을 함께** 숨기고 보인다. 메모장에 이런 단축키가 없어 기준
    // 동작이 없으므로 기능의 뜻("지금 보고 있는 메모를 한 번에 치운다")을 따랐다 —
    // 창 하나만 숨으면 나머지가 화면에 남아 치운 것이 아니게 된다. 다시 보일 때 앞으로
    // 오는 것은 **마지막으로 활성이던 창**이다.
    let toggle = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::SHIFT | Modifiers::ALT),
        Code::KeyN,
    );

    let result = app.global_shortcut().on_shortcut(toggle, |app, _sc, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let windows: Vec<tauri::WebviewWindow> = {
            use tauri::Manager;
            app.webview_windows()
                .into_iter()
                .filter(|(label, _)| winmgr::is_main_label(label))
                .map(|(_, win)| win)
                .collect()
        };
        if windows.is_empty() {
            return;
        }
        let any_visible = windows.iter().any(|w| w.is_visible().unwrap_or(false));
        if any_visible {
            for win in &windows {
                let _ = win.hide();
            }
            return;
        }
        for win in &windows {
            let _ = win.show();
        }
        if let Some(win) = winmgr::target_window(app) {
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    });

    // 다른 앱이 이미 쓰고 있을 수 있다. 앱을 죽이지 않고 로그만 남긴다.
    if let Err(err) = result {
        eprintln!("[Inkwell] Ctrl+Shift+Alt+N 전역 단축키 등록 실패 (무시하고 계속): {err}");
    }
}

/// `tauri.conf.json`에서 **떼어 낸** 창 설정 — 점검용 경로에서만 채워진다.
///
/// Tauri는 `WebviewAttributes::from(&WindowConfig)`에서 `data_directory`를 옮기지
/// 않으므로(upstream), 설정이 만드는 첫 창에는 WebView2 폴더를 지정할 길이 없다.
/// 그래서 점검용 인스턴스에서는 그 창을 설정에서 빼 두고 `setup`에서 같은 설정으로
/// 직접 만들며 폴더를 끼운다. **릴리스 빌드에는 이 값도, 이 길도 없다.**
#[cfg(debug_assertions)]
static QA_WINDOWS: std::sync::OnceLock<Vec<tauri::utils::config::WindowConfig>> =
    std::sync::OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 단일 인스턴스는 **맨 처음** 붙여야 한다(플러그인 문서). 두 번째 실행은 여기서
    // 돌아가던 인스턴스에 파일을 넘기고 스스로 끝난다 — 프로세스는 하나다(§7).
    #[cfg(desktop)]
    {
        // 점검용 탈출구 — **디버그 빌드에만 있다.** `INKWELL_NO_SINGLE_INSTANCE=1`이면
        // 플러그인을 안 붙여서 이 프로세스가 돌아가던 인스턴스에 흡수되지 않는다
        // (점검용 인스턴스를 사람이 쓰는 인스턴스와 나란히 띄우기 위한 것). 릴리스
        // 빌드에서는 아래 `if`가 컴파일되지 않으므로 언제나 단일 인스턴스다(§7).
        #[cfg(debug_assertions)]
        let skip = std::env::var("INKWELL_NO_SINGLE_INSTANCE").is_ok_and(|v| v == "1");
        #[cfg(not(debug_assertions))]
        let skip = false;

        if !skip {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                cli::on_second_instance(app, argv);
            }));
        }
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(overlay::Overlay::default())
        .manage(cli::CliFiles::default())
        .manage(winmgr::Windows::default())
        .manage(session::SessionState::default())
        .manage(drag::Drag::default())
        .manage(reminders::Reminders::default())
        .manage(toast::Toasts::default())
        .invoke_handler(tauri::generate_handler![
            cli::take_cli_files,
            clipboard::clipboard_read_text,
            drag::drag_begin,
            drag::drag_end,
            drag::ghost_paint,
            fonts::system_fonts,
            overlay::set_overlay,
            overlay::set_overlay_hit_rects,
            recent::recent_add,
            recent::recent_list,
            recent::recent_remove,
            reminders::reminder_add,
            reminders::reminder_cancel,
            reminders::reminder_state,
            reminders::reminder_take_reveal,
            toast::reminder_open,
            toast::toast_dismiss,
            toast::toast_payload,
            toast::toast_preview,
            toast::toast_ready,
            session::session_load,
            session::session_load_buffer,
            session::session_put_window,
            session::session_freeze_window,
            session::session_forget_window,
            session::session_adopt,
            session::session_counts,
            session::session_clear,
            settings::load_settings,
            settings::save_settings,
            syscmd::sys_command,
            syscmd::system_language,
            syscmd::time_date_stamp,
            textfile::read_text_file,
            textfile::write_text_file,
            winmgr::app_close_all,
            winmgr::tab_transfer,
            winmgr::window_activate_tab,
            winmgr::window_boot,
            winmgr::window_create,
            winmgr::window_drop_zones,
            winmgr::window_focus,
            winmgr::window_mark_drop,
            winmgr::window_put_tabs,
            winmgr::window_set_drop_zone
        ])
        // 창 목록과 "마지막으로 활성이던 창"을 여기서 센다 — 그 답을 창 하나에 매달면
        // 그 창이 닫힐 때 답이 사라진다(원본 설계의 「보이지 않는 앱 창」과 같은 자리).
        .on_window_event(|window, event| {
            use tauri::Manager;
            let label = window.label().to_string();
            match event {
                tauri::WindowEvent::Focused(true) => {
                    window.app_handle().state::<winmgr::Windows>().set_active(&label);
                }
                tauri::WindowEvent::Destroyed => {
                    let app = window.app_handle().clone();
                    // 알림 카드가 사라졌다 — 슬롯을 치우고 **종료 판단을 다시 돌린다**
                    // (§7: 이것을 빠뜨리면 영원히 트레이에 남는다).
                    if toast::is_toast_label(&label) {
                        toast::forget(&app, &label);
                        return;
                    }
                    app.state::<winmgr::Windows>().forget(&label);
                    app.state::<overlay::Overlay>().forget(&label);
                    // 닫힌 창의 메모가 남은 창의 `다른 창` 묶음에 유령으로 남지 않게
                    // 목록을 다시 보낸다(`forget`이 그 창의 요약을 이미 지웠다).
                    winmgr::broadcast_notes(&app);
                    // 메인 창이 하나도 남지 않으면 고스트도 부순다. 고스트가 살아 있으면
                    // Tauri는 "창이 남아 있다"고 보고 프로세스를 끝내지 않는다.
                    if winmgr::main_window_count(&app) == 0 {
                        if let Some(ghost) = app.get_webview_window(winmgr::GHOST_LABEL) {
                            let _ = ghost.destroy();
                        }
                    }
                    // 마지막 창이 닫히면 앱 종료 — **예약이 남아 있으면 트레이 상주**(§4).
                    // 이 핸들러는 이벤트 루프 안이라 판정은 async 런타임으로 넘긴다
                    // (트레이 아이콘 만들기와 안내 카드가 거기서 이어진다).
                    tauri::async_runtime::spawn(async move { toast::reconsider(&app) });
                }
                _ => {}
            }
        })
        .setup(|_app| {
            // 떼어 낸 첫 창을 여기서 만든다(점검용 경로에서만 — 평소에는 비어 있다).
            #[cfg(debug_assertions)]
            if let Some(dir) = session::webview_data_dir() {
                for win in QA_WINDOWS.get().into_iter().flatten() {
                    tauri::webview::WebviewWindowBuilder::from_config(_app.handle(), win)?
                        .data_directory(dir.clone())
                        .build()?;
                }
            }
            #[cfg(desktop)]
            {
                _app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                register_global_shortcuts(_app.handle());
            }
            {
                use tauri::Manager;
                // `tauri.conf.json`이 만든 첫 창을 창 목록에 올린다.
                _app.state::<winmgr::Windows>().register(winmgr::MAIN_LABEL);
                // 첫 실행의 명령줄 파일. 프론트가 시작할 때 `take_cli_files`로 가져간다.
                let argv: Vec<String> = std::env::args().collect();
                let files = cli::file_args(&argv);
                if !files.is_empty() {
                    if let Ok(mut slot) = _app.state::<cli::CliFiles>().0.lock() {
                        *slot = files;
                    }
                }
                // 알림 스케줄러 — **프로세스에 하나뿐인 1초 틱**(§7: 창이 여럿이어도 한
                // 번만 울린다). 파일을 읽고, 놓친 알림을 띄운 뒤 돈다.
                reminders::start(_app.handle());
            }
            Ok(())
        })
        // `.run(context)`가 아니라 `build` + 실행 루프인 이유는 **ExitRequested 하나** 때문이다:
        // Tauri는 창이 전부 닫히면 프로세스를 끝내려 하는데, 예약이 남아 있거나 카드가 떠
        // 있으면 그래선 안 된다(§4의 트레이 상주). 여기서 막고, 끝낼 자격은
        // `toast::reconsider`의 `app.exit(0)`에게만 둔다 — 종료 판단이 한 자리여야 한다.
        .build({
            #[allow(unused_mut)]
            let mut context = tauri::generate_context!();
            // `tauri.conf.json`이 만드는 첫 창을 **떼어 낸다** — `setup`이 점검용
            // WebView2 폴더를 끼워 직접 만든다(디버그 빌드 전용 · `QA_WINDOWS` 주석).
            #[cfg(debug_assertions)]
            if session::webview_data_dir().is_some() {
                let taken = std::mem::take(&mut context.config_mut().app.windows);
                let _ = QA_WINDOWS.set(taken);
            }
            context
        })
        .expect("error while running tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // `code`가 있는 종료는 우리가 부른 `app.exit(…)`다 — 막지 않는다.
                if code.is_none() && toast::should_stay(app) {
                    api.prevent_exit();
                }
            }
        });
}
