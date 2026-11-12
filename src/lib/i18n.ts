/**
 * UI 문자열 표 — 원본 Win32 버전의 `src/i18n.h`를 그대로 옮긴 것.
 *
 * 원본과 같은 규칙:
 *   * 사람이 읽는 모든 문자열은 **여기 한 곳에만** 있다. 컴포넌트에 하드코딩 금지.
 *   * 한 행 = 한 id, 열은 언어 순서([영어, 한국어]).
 *   * 언어를 더하려면 열을 하나 더하고 `LANG_INDEX`에 한 줄 더하면 끝이다.
 *   * 비어 있는 칸은 **영어로 되돌아간다** — 반쯤 번역된 열도 그대로 돌아간다.
 *   * 단축키 문자열("Ctrl+N", "UTF-8", "LF")은 어느 언어에서나 같은 토큰이라
 *     표에 넣지 않고 메뉴 정의(`menus.ts`)에 직접 쓴다. 원본도 그렇게 한다.
 *
 * 원본 id `kStrMenuThemeDark` → 여기 키 `menuThemeDark` (kStr 떼고 첫 글자 소문자).
 * 표는 원본 파일에서 기계적으로 추출했으므로 211행이 순서대로 다 들어 있다.
 *
 * AI 쪽 문자열도 다 옮겨 두었다 — 표는 원본과 **같아야** 하고, 쓰지 않는 행이
 * 있는 것이 나중에 빠진 행을 찾는 것보다 싸다. AI 기능 자체는 손대지 않았다.
 */

export type Lang = "en" | "ko";

/**
 * 언어 모드. `auto`는 "Windows에 물어본다"는 뜻 (원본 UiLangMode).
 *
 * **사용자가 고르는 값이 아니다**(사용자 결정 2026-11-09): 앱은 늘 `auto`로 돈다.
 * `en`/`ko`는 시험이 언어를 고정할 때만 쓴다.
 */
export const LANG_MODES = ["auto", "en", "ko"] as const;
export type LangMode = (typeof LANG_MODES)[number];

const LANG_INDEX: Record<Lang, 0 | 1> = { en: 0, ko: 1 };

/** [영어, 한국어] */
const STRINGS = {
  empty: ["", ""],
  btnNew: ["New", "새 문서"],
  btnOpen: ["Open", "열기"],
  btnSave: ["Save", "저장"],
  btnBold: ["B", "B"],
  btnH1: ["H1", "H1"],
  btnH2: ["H2", "H2"],
  btnH3: ["H3", "H3"],
  btnTable: ["Table", "표"],
  btnStrike: ["Strikethrough (Ctrl+Shift+X)", "취소선 (Ctrl+Shift+X)"],
  // 글머리 기호 — 승인된 시안 L1의 `•≡` 버튼(도구 줄 H ▾ 오른쪽).
  btnBullet: ["Bulleted list (Ctrl+Shift+8)", "글머리 기호 (Ctrl+Shift+8)"],
  tapePin: ["Pin on top", "항상 위로 고정"],
  tapeUnpin: ["Unpin", "고정 해제"],
  overlaySwitch: ["Overlay", "오버레이"],
  btnAi: ["AI", "AI"],
  hintNew: ["New · Ctrl+N", "새 문서 · Ctrl+N"],
  hintOpen: ["Open · Ctrl+O", "열기 · Ctrl+O"],
  hintSave: ["Save · Ctrl+S · Save As Ctrl+Shift+S", "저장 · Ctrl+S · 다른 이름으로 Ctrl+Shift+S"],
  hintBold: ["Bold · Ctrl+B", "굵게 · Ctrl+B"],
  hintH1: ["Heading 1 · Ctrl+1", "제목 1 · Ctrl+1"],
  hintH2: ["Heading 2 · Ctrl+2", "제목 2 · Ctrl+2"],
  hintH3: ["Heading 3 · Ctrl+3", "제목 3 · Ctrl+3"],
  hintTable: ["Insert table · pick a size · Ctrl+T", "표 넣기 · 크기 선택 · Ctrl+T"],
  hintHighlight: ["Highlight · Ctrl+Shift+H · ▾ or right-click for colours", "형광펜 · Ctrl+Shift+H · ▾ 또는 오른쪽 클릭으로 색 선택"],
  hintHighlightOn: ["Highlighter pen on · drag to highlight · Esc to stop", "형광펜 모드 켜짐 · 드래그하면 칠해짐 · Esc로 끄기"],
  hintAi: ["AI panel · Ctrl+Shift+A", "AI 패널 · Ctrl+Shift+A"],
  hintSlider: ["Background opacity · drag or scroll", "배경 투명도 · 끌거나 휠"],
  hintToolLeft: ["Scroll the bar left · wheel", "메뉴 바 왼쪽으로 · 휠"],
  hintToolRight: ["Scroll the bar right · wheel", "메뉴 바 오른쪽으로 · 휠"],
  statusOverlay: ["Overlay · Ctrl+Shift+T", "오버레이 · Ctrl+Shift+T"],
  statusLnColFmt: ["Ln %ld  ·  Col %ld", "%ld행  ·  %ld열"],
  statusCharsFmt: ["%ld characters", "%ld자"],
  statusSelFmt: ["%ld selected", "%ld자 선택"],
  statusFmtMarkdown: ["Markdown", "마크다운"],
  statusFmtText: ["Text", "텍스트"],
  statusEncAnsi: ["ANSI", "ANSI"],
  statusEolMixed: ["Mixed", "혼합"],
  moreFile: ["File", "파일"],
  moreView: ["View", "보기"],
  menuSaveAs: ["Save As…", "다른 이름으로 저장…"],
  menuFind: ["Find", "찾기"],
  menuOverlay: ["Overlay mode", "오버레이 모드"],
  menuTheme: ["Theme", "테마"],
  menuThemeDark: ["Dark", "어둡게"],
  menuThemeLight: ["Light", "밝게"],
  menuThemeSystem: ["System", "시스템"],
  menuMemoColor: ["Memo color", "메모지 색"],
  memoDefault: ["Default", "기본"],
  // 메모지 색 그룹 맨 위 — 색을 지우는 입구(사용자 결정 2026-11-08). 테마를 바꿔도
  // 색이 지워지지 않으므로 색을 끄는 행이 따로 있어야 한다.
  memoNone: ["No color", "색 없음"],
  memoYellow: ["Yellow", "노랑"],
  memoMint: ["Mint", "민트"],
  memoPink: ["Pink", "분홍"],
  memoSky: ["Sky", "하늘"],
  // `언어` 네 줄(`menuLanguage`·`menuLangAuto`·`menuLangEnglish`·`menuLangKorean`)은
  // 없어졌다 — UI 언어는 항상 자동이다(사용자 결정 2026-11-09).
  menuTextBacking: ["Text backing when see-through", "반투명일 때 글자 뒤 배경"],
  // 간략 메뉴(시안 C2)의 짧은 라벨. 폭을 글자에 맞추므로 긴 문구가 들어가지 않는다 —
  // 설정 카드는 위의 긴 쪽을 그대로 쓴다.
  menuTextBackingShort: ["Text backing", "글자 뒤 배경"],
  menuStatusBar: ["Status bar", "상태 표시줄"],
  // 확대/축소 — 메모장 11의 `보기 › 확대/축소` 세 줄과 같은 말이다(`lib/zoom.ts`).
  // `menuZoomIn`/`Out`/`Reset`은 시안 C2에서 줄이 없어졌지만 낭독기가 −·+·배율 글자를
  // 읽을 이름으로 그대로 쓴다.
  menuZoom: ["Zoom", "확대/축소"],
  menuZoomIn: ["Zoom in", "확대"],
  menuZoomOut: ["Zoom out", "축소"],
  menuZoomReset: ["Restore default zoom", "기본 크기로 복원"],
  tableSizePrompt: ["Table size", "표 크기"],
  tableSizeFmt: ["%d × %d", "%d × %d"],
  hlPickTitle: ["Highlighter", "형광펜"],
  hlYellow: ["Yellow", "노랑"],
  hlGreen: ["Green", "초록"],
  hlPink: ["Pink", "분홍"],
  hlBlue: ["Blue", "파랑"],
  hlOrange: ["Orange", "주황"],
  hlRemove: ["Remove highlight", "하이라이트 지우기"],
  findPrev: ["Previous · Shift+F3", "이전 찾기 · Shift+F3"],
  findNext: ["Next · F3", "다음 찾기 · F3"],
  findCase: ["Match case", "대소문자 구분"],
  findWord: ["Whole word", "단어 단위"],
  findRegex: ["Regular expression", "정규식"],
  findClose: ["Close · Esc", "닫기 · Esc"],
  findReplace: ["Replace · Alt+R", "바꾸기 · Alt+R"],
  findReplaceAll: ["Replace all · Ctrl+Alt+Enter", "모두 바꾸기 · Ctrl+Alt+Enter"],
  findBtnReplace: ["Replace", "바꾸기"],
  findBtnAll: ["All", "모두"],
  findRegexError: ["Regex error", "정규식 오류"],
  findToggleReplace: ["Replace · Ctrl+H", "바꾸기 · Ctrl+H"],
  findNoResults: ["No results", "결과 없음"],
  findMatchesFmt: ["%u matches", "%u개 일치"],
  findReplacedFmt: ["%u replaced", "%u개 바꿈"],
  aiLoadingModel: ["Loading AI model…", "AI 모델 로드 중…"],
  aiSuggestingFmt: ["AI thinking…  ·  Ln %ld  ·  Col %ld", "AI 추천 중…  ·  %ld행  ·  %ld열"],
  aiGhostFmt: ["AI suggestion · Tab to accept  ·  Ln %ld  ·  Col %ld", "AI 추천 · Tab 적용  ·  %ld행  ·  %ld열"],
  aiModeOnFmt: ["AI mode on  ·  Ln %ld  ·  Col %ld", "AI 모드 활성화  ·  %ld행  ·  %ld열"],
  aiBarSuggesting: ["AI thinking…", "AI 추천 중…"],
  aiBarGhost: ["AI suggestion · Tab to accept", "AI 추천 · Tab 적용"],
  aiBarOn: ["AI mode on", "AI 모드 활성화"],
  panelModelPrefix: ["Model: ", "모델: "],
  panelModelNone: ["Model: none", "모델: 없음"],
  panelLoading: ["Loading model…", "모델 로드 중…"],
  panelReady: ["Ready", "준비됨"],
  panelWorkingPrefix: ["Working… · ", "작업 중… · "],
  panelIdle: ["Idle", "대기"],
  panelTargetSelFmt: ["Target: selection (%ld chars)", "대상: 선택 영역 (%ld자)"],
  panelTargetDocFmt: ["Target: whole document (%ld chars)", "대상: 문서 전체 (%ld자)"],
  panelGroupWriting: ["Writing", "글쓰기"],
  panelGroupOrganize: ["Organize", "정리"],
  panelGroupCode: ["Code · Data", "코드 · 데이터"],
  panelLabelPrompt: ["Prompt", "프롬프트"],
  panelLabelResult: ["Result", "결과"],
  panelPromptHint: ["e.g. Translate into Korean.\r\nKeep brand names. rent = 임대료", "예: 한국어로 번역해 주세요.\r\n브랜드명은 그대로. rent = 임대료"],
  chipAutoComplete: ["Autocomplete (Tab)", "자동완성 (Tab)"],
  chipProofread: ["Proofread", "교정"],
  chipTranslate: ["Translate", "번역"],
  chipToneMenu: ["Change tone ▾", "말투 변환 ▾"],
  chipSummary: ["Title + 3-line summary", "제목+3줄 요약"],
  chipMarkdown: ["Tidy Markdown", "마크다운 정리"],
  chipTodo: ["Extract To-Do", "To-Do 추출"],
  chipCodeGen: ["Generate code", "코드 생성"],
  chipCodeReview: ["Review code", "코드 리뷰"],
  chipConvMenu: ["Convert ▾", "포맷 변환 ▾"],
  chipRun: ["Run (Ctrl+Enter)", "실행 (Ctrl+Enter)"],
  chipStop: ["Stop", "중지"],
  chipReplace: ["Replace", "교체"],
  chipInsert: ["Insert", "삽입"],
  chipCopy: ["Copy", "복사"],
  chipDownload: ["Download model (soon)", "모델 다운로드 (준비 중)"],
  menuToneBlog: ["Blog post", "블로그 글"],
  menuToneEmail: ["Business email", "비즈니스 이메일"],
  menuToneReport: ["Report", "보고서"],
  menuJsonXml: ["JSON → XML", "JSON → XML"],
  menuCsvTable: ["CSV → text table", "CSV → 텍스트 표"],
  noticeNoTarget: ["No target text. Type something, or select a range.", "대상 텍스트가 없습니다. 문서에 글을 쓰거나 범위를 선택하세요."],
  noticeNoPrompt: ["Type a prompt first.", "프롬프트를 입력하세요."],
  noticeCannotStart: ["Could not start the request.", "요청을 시작할 수 없습니다."],
  noticeTableRange: ["The range contains a table, so Replace is unavailable.", "표가 포함된 범위입니다. '교체'는 쓸 수 없습니다."],
  noticeTargetChanged: ["The target changed. Run it again.", "대상이 바뀌었습니다. 다시 실행하세요."],
  noticeTargetMissing: ["Could not find the target range.", "대상 범위를 찾을 수 없습니다."],
  noticeTableNoReplace: ["A range containing a table cannot be replaced. Use Insert.", "표가 포함된 범위는 교체할 수 없습니다. '삽입'을 쓰세요."],
  noticeReplaced: ["Replaced. (One Ctrl+Z undoes it.)", "교체했습니다. (Ctrl+Z 한 번으로 되돌림)"],
  noticeInserted: ["Inserted. (One Ctrl+Z undoes it.)", "삽입했습니다. (Ctrl+Z 한 번으로 되돌림)"],
  noticeCopied: ["Result copied.", "결과를 복사했습니다."],
  noticeStopRequested: ["Stop requested.", "중지를 요청했습니다."],
  noticeDone: ["Done. Apply it with Replace or Insert.", "완료. '교체' 또는 '삽입'으로 적용하세요."],
  noticeStopped: ["Stopped. What arrived so far is kept.", "중지했습니다. 받은 부분까지 남아 있습니다."],
  noticeTruncatedFmt: ["Input was long: only the first %u characters were used (model context %u tokens).", "입력이 길어 앞부분 %u자만 사용했습니다 (모델 문맥 %u 토큰)."],
  noticeLargeTarget: ["Tip: selecting just the part you need is much faster.", "선택 영역만 보내면 더 빠릅니다."],
  taskProofread: ["Proofread", "교정"],
  taskToneBlog: ["Blog", "블로그"],
  taskToneEmail: ["Business email", "비즈니스 이메일"],
  taskToneReport: ["Report", "보고서"],
  taskSummary: ["Title + summary", "제목+요약"],
  taskMarkdown: ["Markdown", "마크다운 정리"],
  taskTodo: ["To-Do", "To-Do 추출"],
  taskCodeGen: ["Code", "코드 생성"],
  taskCodeReview: ["Code review", "코드 리뷰"],
  taskJsonToXml: ["JSON→XML", "JSON→XML"],
  taskCsvToTable: ["CSV→Table", "CSV→표"],
  taskFree: ["Free prompt", "자유 프롬프트"],
  taskTranslate: ["Translate", "번역"],
  errNoRuntime: ["No AI runtime (ai\\llama.dll)", "AI 런타임 없음 (ai\\llama.dll)"],
  errNoModel: ["No model. Put a GGUF file in the models\\ folder", "모델이 없습니다. models\\ 폴더에 GGUF를 넣어 주세요"],
  errBadRuntimeVersion: ["AI runtime version mismatch", "AI 런타임 버전 불일치"],
  errLoadFailed: ["Could not load the AI model", "AI 모델 로드 실패"],
  errCancelled: ["Stopped", "중지했습니다"],
  errTimeout: ["Timed out", "시간이 초과되었습니다"],
  errRejected: ["No result", "결과가 없습니다"],
  errTooLong: ["The target text is too long", "대상 텍스트가 너무 깁니다"],
  errInternal: ["Internal AI error", "AI 내부 오류"],
  errGeneric: ["AI error", "AI 오류"],
  dlgCannotRead: ["Could not read", "읽을 수 없습니다"],
  dlgCannotWrite: ["Could not write", "쓸 수 없습니다"],
  dlgSaveChangesFmt: ["Save changes to %ls?", "%ls의 변경 내용을 저장할까요?"],
  dlgRichEditFailed: ["Msftedit.dll could not be loaded.", "Msftedit.dll을 불러올 수 없습니다."],
  menuSetReminder: ["Set reminder…", "알림 예약…"],
  menuReminderList: ["Scheduled reminders", "예약된 알림"],
  remindTitle: ["Set reminder", "알림 예약"],
  remindConfirm: ["Set reminder", "알림 설정"],
  remindPast: ["That moment has passed", "이미 지난 시각입니다"],
  remindYear: ["Year", "년"],
  remindMonth: ["Month", "월"],
  remindDay: ["Day", "일"],
  remindHour: ["Hour", "시"],
  remindMinute: ["Min", "분"],
  remindListTitle: ["Scheduled reminders", "예약된 알림"],
  remindListEmpty: ["No reminders scheduled", "예약된 알림이 없습니다"],
  remindCancelHint: ["Del: cancel", "Del: 취소"],
  /**
   * 예약 창의 `예약` 버튼(시안 문구). 위의 `remindConfirm`("알림 설정")은 원본
   * 메시지 박스의 버튼 글자라 표에 그대로 남겨 두고, 시안이 쓰는 짧은 말은 여기 둔다.
   */
  remindBtnSet: ["Set", "예약"],
  /**
   * 버튼 위 한 줄의 꼬리 — **원본에 없던 세 행**(`lib/remindPick.ts` 참고).
   * 기준은 달력 날짜 차이이고, 지난 시각은 경고 줄이 대신 나오므로 음수 쪽은 없다.
   */
  remindRelToday: ["Today", "오늘"],
  remindRelTomorrow: ["Tomorrow", "내일"],
  remindRelDaysFmt: ["In %d days", "%d일 후"],
  /** 예약 목록의 머리(11px dim) — 메모 목록의 개수 줄과 같은 규칙. */
  remindListCountFmt: ["%d reminders", "예약된 알림 %d"],
  remindSetFmt: ["Reminder set — %s", "알림 예약됨 — %s"],
  remindNoSelection: ["Select some text first", "먼저 텍스트를 선택하세요"],
  toastTitle: ["Floaty Note reminder", "Floaty Note 알림"],
  toastMissedFmt: ["(missed %s) %s", "(놓침 %s) %s"],
  /**
   * 원본에 없던 행 **하나**. 원본은 `(missed %s) %s` 한 줄로 시각과 본문을 함께 찍었는데,
   * 승인된 시안(T3 열의 문구를 T2 본문 앞에 쓰라는 지시)은 `(놓침 시각)` 조각만 dim으로
   * 칠하라고 한다. 한 문자열 안의 일부만 다른 색으로 그릴 수는 없으므로 앞 조각을 따로
   * 두었다. 위의 `toastMissedFmt`는 원본과 같게 남겨 둔다(표는 원본과 같아야 한다).
   */
  toastMissedPrefixFmt: ["(missed %s)", "(놓침 %s)"],
  /** 개발 빌드에서만 보이는 ☰ 메뉴의 마지막 줄 — 토스트 모양 확인용. */
  devToastPreview: ["Toast preview (dev)", "토스트 미리보기(개발용)"],
  devToastPreviewMissed: ["Missed toast preview (dev)", "놓친 알림 미리보기(개발용)"],
  // `devRemindSoon`("선택한 글 1분 뒤 알림")은 **지웠다**(단계 10): 예약 창이 생겨
  // 실제 예약을 넣는 길이 UI에 있으므로 개발용 우회로가 필요 없다.
  trayNoticeTitle: ["Floaty Note is still running", "Floaty Note가 계속 실행 중입니다"],
  trayNoticeBody: ["Floaty Note is still running to deliver your reminders. Right-click the tray icon to open it or to quit.", "예약한 알림을 띄우기 위해 Floaty Note가 트레이에서 계속 실행됩니다. 트레이 아이콘을 오른쪽 클릭하면 열거나 종료할 수 있습니다."],
  trayMenuTitle: ["Floaty Note", "Floaty Note"],
  trayOpen: ["Open Floaty Note", "Floaty Note 열기"],
  trayExit: ["Exit", "종료"],
  ctxTitle: ["Edit", "편집"],
  menuUndo: ["Undo", "실행 취소"],
  menuCut: ["Cut", "잘라내기"],
  menuCopy: ["Copy", "복사"],
  menuPaste: ["Paste", "붙여넣기"],
  menuDelete: ["Delete", "삭제"],
  menuSelectAll: ["Select All", "모두 선택"],
  menuDeleteTable: ["Delete table", "표 삭제"],
  menuHighlight: ["Highlight", "형광펜"],
  menuHighlightOff: ["Remove highlight", "형광펜 지우기"],
  opacity: ["Opacity", "불투명도"],
  sysMenuTitle: ["Window", "창"],
  sysRestore: ["Restore", "이전 크기로"],
  sysMove: ["Move", "이동"],
  sysSize: ["Size", "크기 조절"],
  sysMinimize: ["Minimize", "최소화"],
  sysMaximize: ["Maximize", "최대화"],
  sysClose: ["Close", "닫기"],
  dlgTitleSaveChanges: ["Save changes", "변경 내용 저장"],
  dlgTitleError: ["Can't open the file", "파일을 열 수 없습니다"],
  // --- 알림이 걸린 탭을 `저장 안 함`으로 닫을 때의 두 번째 확인(시안 `DiscardReminder` ②) ---
  dlgTitleDiscardReminder: ["Scheduled reminder", "예약된 알림"],
  dlgDiscardReminder: [
    "This tab has a scheduled reminder. If you don't save, the reminder will be removed.",
    "이 탭에 예약된 알림이 있습니다. 저장하지 않으면 예약한 알림이 사라집니다.",
  ],
  dlgBtnDiscardReminder: ["Remove reminder and close", "알림도 지우고 닫기"],
  dlgBtnSave: ["Save", "저장"],
  dlgBtnDontSave: ["Don't save", "저장 안 함"],
  dlgBtnCancel: ["Cancel", "취소"],
  dlgBtnOk: ["OK", "확인"],
  toastFooterFmt: ["Floaty Note · %ls", "Floaty Note · %ls"],
  tabUntitled: ["Untitled", "제목 없음"],
  menuNewTab: ["New Tab", "새 탭"],
  menuCloseTab: ["Close Tab", "탭 닫기"],
  menuNewWindow: ["New Window", "새 창"],

  // --- 파일 메뉴를 Windows 11 메모장 구성으로 맞추면서 생긴 행들 ---
  // 메모장 11의 파일 메뉴는 새 탭 / 새 창 / 열기 / 저장 / 다른 이름으로 저장 /
  // 모두 저장 / 탭 닫기 / 창 닫기 / 끝내기다. 원본에 없던 세 줄이 여기 있다.
  menuSaveAll: ["Save All", "모두 저장"],
  menuCloseWindow: ["Close Window", "창 닫기"],
  menuExit: ["Exit", "끝내기"],

  // --- 설정 화면(시안 S) ---
  settingsStartup: ["When Floaty Note starts", "Floaty Note가 시작될 때"],
  settingsStartupRestore: ["Open content from the previous session", "이전 세션의 콘텐츠 열기"],
  settingsStartupFresh: [
    "Start new session and discard unsaved changes",
    "새 세션 시작 및 저장되지 않은 변경 내용 삭제",
  ],
  // 섹션 라벨 셋(12px dim) — 시안 S의 `모양` / `시작` / `기타`.
  settingsSecAppearance: ["Appearance", "모양"],
  settingsSecStartup: ["Startup", "시작"],
  settingsSecOther: ["Other", "기타"],
  // 카드 머리. 테마 메뉴의 `테마`(menuTheme)와 글자가 달라서 따로 둔다 — 시안 S는
  // `앱 테마`라고 쓰고, 세 번째 값도 메뉴의 `시스템`이 아니라 `시스템 설정 사용`이다
  // (메모장 11의 설정 페이지와 같은 문구).
  settingsAppTheme: ["App theme", "앱 테마"],
  settingsThemeSystem: ["Use system setting", "시스템 설정 사용"],
  // 메모지 색 줄의 둘째 줄(11px dim) — 시안 S의 문구 그대로.
  settingsTintHint: [
    "Applies to this tab · kept in dark theme too",
    "지금 탭에 적용 · 어두운 테마에서도 그대로",
  ],
  // `글꼴` 카드(시안 G1) — 카드 머리와 첫 줄의 라벨이 같은 낱말이라 한 id를 쓴다.
  settingsFont: ["Font", "글꼴"],
  settingsFontSize: ["Size", "크기"],
  settingsFontDefault: ["Default", "기본"],
  // 미리 보기 한 줄. 한글·영문·숫자가 한 번에 보여야 글꼴을 고를 수 있어서 두 언어가
  // **같은 글자**를 쓴다(시안 G1의 글자 그대로).
  settingsFontPreview: ["가나다 Abc 123", "가나다 Abc 123"],
  // 오른쪽 아래 11px dim 한 줄. 버전은 `tauri.conf.json`의 값을 그대로 읽는다.
  settingsVersionFmt: ["Floaty Note · version %s", "Floaty Note · 버전 %s"],

  // 탭 줄이 넘칠 때의 ◀ ▶ (시안에 없는 경우 — 원본 밴드의 규칙을 따랐다).
  tabScrollLeft: ["Scroll tabs left", "탭 왼쪽으로"],
  tabScrollRight: ["Scroll tabs right", "탭 오른쪽으로"],
  // 「N ▾」 탭 목록(승인된 시안 T1) — 버튼 설명과 팝업 이름.
  // 메모장 11에는 이 버튼이 없다(의도된 추가 — 사용자 결정 2026-11-10).
  tabListFmt: ["All tabs (%d)", "모든 탭 (%d)"],
  tabListTitle: ["All tabs", "모든 탭"],

  // --- 아래는 Tauri 버전에서 새로 생긴 화면의 문자열 (원본 표에는 없음) ---
  // 시안 R5 + 메모 목록: 왼쪽 패널을 켜고 끄는 버튼과 ☰ › 보기의 행이 같은 문자열을 쓴다.
  menuNoteList: ["Note list", "메모 목록"],
  // 목록 머리의 개수. 원본의 상태 표시줄 서식들과 같은 규칙으로 %d 하나.
  noteListCountFmt: ["%d notes", "메모 %d"],
  noteListNew: ["New note", "새 메모"],
  // 목록을 켜고 끄는 버튼은 **토글 하나**다(사용자 보고 4): 위 줄 버튼은 열기,
  // 목록(막대 포함) 머리 버튼은 닫기. 좁은 창에서 "펼치기"는 없앴다.
  noteListClose: ["Close the list", "목록 닫기"],
  noteListShow: ["Show the list", "목록 열기"],
  // 목록은 **모든 창 공통**이다(사용자 결정) — 아래 두 묶음의 섹션 라벨과 ✕ 설명.
  noteListOther: ["Other windows", "다른 창"],
  noteListRecent: ["Recent files", "최근 파일"],
  noteListRecentRemove: ["Remove from the list", "목록에서 빼기"],
  // ☰ › 보기의 `항상 위에 고정` — 테이프(시안 Pin)와 같은 상태(지시 5).
  menuAlwaysOnTop: ["Always on top", "항상 위에 고정"],
  // 떠 있는 도구 줄의 버튼들 — 원본에 대응하는 ⋯ 메뉴 버튼이 없어서 새로 생긴 이름.
  dockMenu: ["Menu", "메뉴"],
  dockSettings: ["Settings", "설정"],
  // 시안 N2b — 좁은 창에서 접힌 버튼을 담는 `⋯`와 그 안의 줄 이름.
  // (`btnStrike`·`btnH1`은 단추용 글자라 단축키가 붙어 있거나 `H1`이어서 줄 이름으로
  //  쓸 수 없다 — 줄은 단축키를 오른쪽에 따로 적는다.)
  dockMore: ["More", "더 보기"],
  dockStrike: ["Strikethrough", "취소선"],
  dockBullet: ["Bulleted list", "글머리 기호"],
  dockHeading: ["Heading", "제목"],
  // R5의 상태 글자: `4:9 · 62자` (행:칸 · 글자 수).
  statusLineColCharsFmt: ["%d:%d · %d chars", "%d:%d · %d자"],
  // 임계값(1MB)을 넘은 `.md`를 일반 텍스트로 열었을 때의 안내(설계 문서 §11 · 단계 12).
  // 저장 바이트는 완전히 보존되므로 "파일이 망가질 위험은 없다"가 이 문구의 뜻이다.
  statusBigMdPlain: ["large file · opened as text", "큰 파일 · 텍스트로 열림"],
} as const;

export type StrId = keyof typeof STRINGS;

// ---------------------------------------------------------------------------
// 살아 있는 설정. 모듈 하나가 들고 있으므로 `t()`를 어디서든 인자 없이 부를 수 있다
// (원본의 `g_uiLang` 전역과 같은 구조).
//
// 모드는 **항상 `auto`**다(사용자 결정 2026-11-09 — 언어 선택 UI를 없앴다): 앱은
// `setSystemLang`으로 Windows 표시 언어만 심고, 그 아래 모든 컴포넌트가 같은 언어로
// 그려진다. `setLangMode`는 **시험에서 언어를 고정할 때만** 쓰인다.
// ---------------------------------------------------------------------------

let mode: LangMode = "auto";
let systemLang: Lang = "en"; // 영어가 어디서나 기본값
let active: Lang = "en";

function resolve(m: LangMode): Lang {
  if (m === "en") return "en";
  if (m === "ko") return "ko";
  return systemLang;
}

/** 고른 모드를 심는다. 같은 값이면 아무 일도 하지 않으므로 렌더 중에 불러도 안전하다. */
export function setLangMode(next: LangMode): void {
  mode = LANG_MODES.includes(next) ? next : "auto";
  active = resolve(mode);
}

/**
 * OS의 UI 언어(`GetUserDefaultUILanguage`를 Rust에서 읽은 값)를 심는다.
 * 우리가 내보내는 언어가 아니면 영어 — 그게 기본값의 핵심이다(원본 주석).
 */
export function setSystemLang(next: Lang): void {
  systemLang = next === "ko" ? "ko" : "en";
  active = resolve(mode);
}

/** 지금 실제로 그려지는 언어. */
export function lang(): Lang {
  return active;
}

/**
 * 문자열 하나. 절대 `undefined`를 주지 않는다 — 없는 id도, 빈 칸도 영어로 되돌아간다
 * (원본 `T(UiStr)`과 같은 보증).
 */
export function t(id: StrId): string {
  const row = STRINGS[id] as readonly [string, string] | undefined;
  if (!row) return "";
  return row[LANG_INDEX[active]] || row[0] || "";
}

/**
 * `%ld`, `%u`, `%d`, `%s`, `%ls` 자리를 앞에서부터 차례로 채운다
 * (원본의 `swprintf` 자리와 같은 순서·같은 개수).
 */
export function tf(id: StrId, ...args: (string | number)[]): string {
  let i = 0;
  return t(id).replace(/%(?:ld|lu|ls|[dus])/g, () => {
    const value = args[i];
    i += 1;
    return value === undefined ? "" : String(value);
  });
}
