import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

import { cleanFontList, docFontCss } from "../lib/fonts";
import { t, tf } from "../lib/i18n";
import { type Action, type Menu, type MenuState } from "../lib/menus";
import {
  FONT_SIZE_MENU,
  fontMenu,
  PANEL_STARTUP,
  PANEL_THEMES,
  PANEL_TINTS,
  PANEL_TOGGLES,
  panelOn,
  type PanelChoice,
} from "../lib/settingsPanel";

/**
 * 설정 — 승인된 시안 **S**.
 *
 * **창이 아니라 "설정을 연 창 안에 뜨는 모달 카드"다.** 시안 S는 자체 제목 줄과 ✕를
 * 가진 600폭 창 모양으로 그려져 있고, 여기서 그리는 것도 **그 모양 그대로**다 —
 * 제목 줄 34(cap 배경 · accent 네모 10 r3 · 12px semibold `설정` · ✕ 34)와 r12 ·
 * 1px hairline까지 같다. 다른 것은 "그 카드가 OS 창인가, 창 안의 레이어인가"뿐이다.
 *
 * 왜 레이어인가 (다중 창 구조에서 가장 단순하고 안정적인 쪽 — 지시 2):
 *   * 창을 하나 더 띄우면 `vite.config.ts`에 entry 하나(ghost/toast처럼), capability
 *     하나, 창 수명 관리(이미 열려 있으면 앞으로 올리기 / 부모 창이 닫히면 같이 닫기 /
 *     세션에 들어가지 않게 제외), 그리고 **그 창만의 테마 계산**이 따로 생긴다.
 *     설정 창은 종이색이 없으니 어느 탭의 색을 쓸지부터 답해야 한다.
 *   * 메모지 색 4점은 `지금 탭에 적용`이다. 별개 창은 "지금 탭"이 무엇인지 스스로
 *     알 수 없어 창-탭 대화가 한 겹 더 필요하다. 레이어는 그냥 `activeId`를 본다.
 *   * 값 동기화는 이미 된다: 어느 창에서 바꾸든 `settings.ts`가 쓰고 Rust
 *     `broadcast_settings`가 모든 창에 보내므로, 창 둘이 각자 설정을 열어 두어도
 *     한쪽에서 바꾼 값이 다른 쪽 화면에 바로 반영된다. 창을 더 만들어도 얻는 것이 없다.
 *   * 모달이라 열려 있는 동안 그 창의 편집은 막히는데, 그것이 메모장과 같다(메모장 11은
 *     설정을 **같은 창 안의 페이지로** 열고 그동안 문서를 못 만진다).
 *
 * 모든 컨트롤은 메뉴와 **같은 `Action`**을 `onAction`으로 보낸다(`lib/settingsPanel.ts`).
 * 그래서 메뉴 ↔ 설정은 맞춰 주는 코드 없이 양방향으로 같은 값을 본다.
 *
 * 키보드: Tab 이동, Esc 닫기, 라디오 그룹은 ←→↑↓(Windows처럼 **옮기면 바로 골라진다**).
 */

interface Props {
  state: MenuState;
  onAction: (act: Action) => void;
  onClose: () => void;
  /** 글꼴·크기 드롭다운이 아래로 여는 메뉴. `App`의 팝업 하나를 그대로 쓴다. */
  onOpenMenu: (menu: Menu, el: HTMLElement, placement: "below") => void;
}

/**
 * 라디오 그룹의 화살표 — 다음/이전으로 옮기고 **그 자리에서 고른다**(Windows 규칙).
 * 끝에서는 반대쪽으로 돈다.
 */
function arrowStep(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  return null;
}

export default function Settings({ state, onAction, onClose, onOpenMenu }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState("");
  /**
   * 설치된 글꼴 이름 — Windows에서 읽는다(Rust `system_fonts`, 권한 불필요).
   * 설정을 **열 때 한 번** 묻는다: 목록은 수백 개가 될 수 있고 글꼴이 설치·삭제되는
   * 일은 드물다. 못 읽으면 목록이 비고 `기본` 한 줄만 남는다(앱은 그대로 돈다).
   */
  const [fonts, setFonts] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void invoke<string[]>("system_fonts")
      .then((list) => {
        if (alive) setFonts(cleanFontList(list));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 버전은 `tauri.conf.json`의 값(= 앱 버전)이다. 못 읽으면 줄을 비워 둔다.
  useEffect(() => {
    let alive = true;
    void getVersion()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 열리면 카드에 초점 — Esc가 바로 듣고 Tab이 첫 컨트롤에서 시작한다.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  /** 라디오 묶음 하나 — 테마 칩 세 개와 `시작` 두 줄이 같은 규칙을 쓴다. */
  const radioGroup = (
    items: readonly PanelChoice[],
    kind: "chip" | "row",
    label: string
  ) => {
    const selected = items.findIndex((it) => panelOn(it.act, state));
    return (
      <div
        className={kind === "chip" ? "set-chips" : "set-rows"}
        role="radiogroup"
        aria-label={label}
      >
        {items.map((item, index) => {
          const on = index === selected;
          return (
            <button
              key={item.label}
              className={kind === "chip" ? "set-chip" : "set-row-btn"}
              type="button"
              role="radio"
              aria-checked={on}
              data-on={on ? "1" : "0"}
              // 그룹 안에서는 **고른 것 하나만** Tab 순서에 든다(roving tabindex).
              tabIndex={on || (selected < 0 && index === 0) ? 0 : -1}
              onClick={() => onAction(item.act)}
              onKeyDown={(e) => {
                const next = arrowStep(e.key, index, items.length);
                if (next === null) return;
                e.preventDefault();
                e.stopPropagation();
                const target = items[next];
                if (!target) return;
                onAction(target.act);
                const group = e.currentTarget.parentElement;
                const el = group?.children[next];
                if (el instanceof HTMLElement) el.focus();
              }}
            >
              <span className="set-radio" data-on={on ? "1" : "0"} />
              {t(item.label)}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="settings-scrim" data-hit onMouseDown={onClose} />
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label={t("dockSettings")}
        tabIndex={-1}
        ref={cardRef}
        data-hit
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      >
        {/* 제목 줄 34 — 시안 S: accent 네모 10 r3 (여백 0 8 0 12) + 12px semibold + ✕ 34 */}
        <div className="settings-title">
          <span className="settings-mark" />
          <span className="settings-name">{t("dockSettings")}</span>
          <button
            className="settings-close"
            type="button"
            aria-label={t("sysClose")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="settings-body">
          {/* --- 모양 --- */}
          <div className="set-label">{t("settingsSecAppearance")}</div>
          <div className="set-card set-card-pad">
            <div className="set-head">{t("settingsAppTheme")}</div>
            {radioGroup(PANEL_THEMES, "chip", t("settingsAppTheme"))}
            {/* 메모지 색 — 다크 테마에서도 보인다(사용자 결정 2026-11-08). 맨 앞의
                `색 없음`은 빈 동그라미다. */}
            <div className="set-hair" />
            <div className="set-tints">
              <div className="set-tint-text">
                <div className="set-head">{t("menuMemoColor")}</div>
                <div className="set-sub">{t("settingsTintHint")}</div>
              </div>
              {PANEL_TINTS.map((item) => (
                <button
                  key={item.label}
                  className="set-dot"
                  type="button"
                  aria-label={t(item.label)}
                  aria-pressed={panelOn(item.act, state)}
                  data-on={panelOn(item.act, state) ? "1" : "0"}
                  data-none={item.color === "" ? "1" : "0"}
                  style={item.color === "" ? undefined : { background: item.color }}
                  onClick={() => onAction(item.act)}
                />
              ))}
            </div>
          </div>

          {/* --- 글꼴 (시안 G1) — 앱 테마 카드 **아래**.
                 메모장 11의 `설정 › 글꼴`과 같은 구성(글꼴 · 크기 · 미리 보기)이다.
                 두 드롭다운은 메뉴와 **같은 팝업**을 쓴다(`onOpenMenu`) — 그래서
                 고르는 길이 메뉴와 하나이고 값도 하나다. --- */}
          <div className="set-card set-card-pad">
            <div className="set-head">{t("settingsFont")}</div>
            <div className="set-font-line">
              <span className="set-font-label">{t("settingsFont")}</span>
              <button
                className="set-font-pick"
                type="button"
                aria-haspopup="menu"
                aria-label={t("settingsFont")}
                onClick={(e) => onOpenMenu(fontMenu(fonts), e.currentTarget, "below")}
              >
                <span className="set-font-name">
                  {state.fontFamily === "" ? t("settingsFontDefault") : state.fontFamily}
                </span>
                <span className="set-caret">▾</span>
              </button>
            </div>
            <div className="set-font-line">
              <span className="set-font-label">{t("settingsFontSize")}</span>
              <button
                className="set-font-pick"
                type="button"
                aria-haspopup="menu"
                aria-label={t("settingsFontSize")}
                onClick={(e) => onOpenMenu(FONT_SIZE_MENU, e.currentTarget, "below")}
              >
                <span className="set-font-name">{state.fontSize}</span>
                <span className="set-caret">▾</span>
              </button>
            </div>
            {/* 미리 보기 — **고른 글꼴로** 그린다. 크기는 시안 그대로 15px 고정이다
                (크기는 본문에 걸리는 값이고 이 줄은 글꼴을 보는 자리다). */}
            <div className="set-font-preview" style={{ fontFamily: docFontCss(state.fontFamily) }}>
              {t("settingsFontPreview")}
            </div>
          </div>

          {/* --- 시작 --- */}
          <div className="set-label set-label-gap">{t("settingsSecStartup")}</div>
          <div className="set-card set-card-pad set-card-startup">
            <div className="set-head">{t("settingsStartup")}</div>
            {radioGroup(PANEL_STARTUP, "row", t("settingsStartup"))}
          </div>

          {/* --- 기타 --- */}
          <div className="set-label set-label-gap">{t("settingsSecOther")}</div>
          {/* `언어` 줄은 **없어졌다**(사용자 결정 2026-11-09) — UI 언어는 항상 자동
              (Windows 표시 언어). 남은 것은 토글 두 줄이다. */}
          <div className="set-card set-card-list">
            {PANEL_TOGGLES.map((item) => {
              const on = panelOn(item.act, state);
              return (
                <div className="set-line" key={item.label}>
                  <span className="set-line-label">{t(item.label)}</span>
                  <button
                    className="set-switch"
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={t(item.label)}
                    data-on={on ? "1" : "0"}
                    onClick={() => onAction(item.act)}
                  >
                    <span className="set-knob" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="set-version">{version === "" ? "" : tf("settingsVersionFmt", version)}</div>
        </div>
      </div>
    </>
  );
}
