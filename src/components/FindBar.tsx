import { useEffect, useRef, useState } from "react";

import { t } from "../lib/i18n";

/**
 * 찾기/바꾸기 카드 — 승인된 시안 `FindBar.dc.html`의 **F2** (편집 영역 오른쪽 위에
 * 떠 있는 카드). 시안 수치 그대로: 오른쪽 12 · 위 12 · 폭 268 · 패딩 8 · r12 ·
 * bar 배경 · 1px hairline.
 *
 *   줄 1 (간격 5): [▸ 22×26] [찾기 입력 92×26 r8] [개수 11px dim] [▲ 24×26] [▼ 24×26] [✕ 24×26]
 *   줄 2 (위 6, 왼쪽 들여쓰기 27, 간격 5): [Aa] [ab] [.*] 24 높이 · 패딩 0 8 · r10 · 11px
 *                                           … 오른쪽에 11px dim 글자
 *   바꾸기 줄 (▸를 누르면 펼침): 줄 2와 같은 들여쓰기에 [바꾸기 입력] [바꾸기] [모두]
 *
 * 두 글자 자리의 뜻은 **원본과 같다**(`FindCountText` / `FindHintText`):
 * 줄 1은 `2 / 7`·`3개 일치`·`결과 없음`·`정규식 오류`·`3개 바꿈`, 줄 2 오른쪽은
 * **마우스가 올라간 칩의 이름과 단축키**(카드가 자기 단축키를 가르치는 자리).
 *
 * 오버레이 모드에서는 불투명 칩으로 남고 클릭을 잡아야 하므로 `data-hit`이다.
 */

export interface FindState {
  open: boolean;
  /** 바꾸기 줄이 펼쳐져 있는가. `Ctrl+F`는 접은 채로, `Ctrl+H`는 펼친 채로 연다. */
  replaceOpen: boolean;
  text: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const EMPTY_FIND: FindState = {
  open: false,
  replaceOpen: false,
  text: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

interface Props {
  state: FindState;
  /** 줄 1의 글자. `error`면 warn 색이고 찾기 칸 테두리도 같이 물든다. */
  status: { text: string; error: boolean };
  onChange: (patch: Partial<FindState>) => void;
  onStep: (forward: boolean) => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  /** 이 값이 바뀌면 찾기 칸에 초점을 주고 글자를 전부 고른다(`Ctrl+F`를 다시 눌렀을 때). */
  focusKey: number;
}

const ICON = {
  chevron: "M6 3l5 5-5 5",
  up: "M8 13V3M4 7l4-4 4 4",
  down: "M8 3v10M4 9l4 4 4-4",
  close: "M4 4l8 8M12 4l-8 8",
};

function Icon({ path, size }: { path: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function FindBar({
  state,
  status,
  onChange,
  onStep,
  onReplace,
  onReplaceAll,
  onClose,
  focusKey,
}: Props) {
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** 마우스가 올라간 칩의 이름 — 줄 2 오른쪽 글자(원본 `FindHintText`). */
  const [hint, setHint] = useState("");

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusKey]);

  // 펼칠 때 바꾸기 칸으로 초점을 옮긴다(원본 `ToggleFindReplaceRow`).
  useEffect(() => {
    if (state.replaceOpen) replaceRef.current?.focus();
  }, [state.replaceOpen]);

  /** 입력 칸의 키: Enter 다음 / Shift+Enter 이전 / Ctrl+Alt+Enter 모두 바꾸기. */
  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.ctrlKey && e.altKey) onReplaceAll();
    else onStep(!e.shiftKey);
  };

  const hoverProps = (name: string) => ({
    onMouseEnter: () => setHint(name),
    onMouseLeave: () => setHint((old) => (old === name ? "" : old)),
  });

  const toggle = (
    key: "caseSensitive" | "wholeWord" | "regex",
    label: string,
    name: string
  ) => (
    <button
      type="button"
      className="find-opt"
      data-on={state[key] ? "1" : "0"}
      aria-label={name}
      aria-pressed={state[key]}
      onClick={() => onChange({ [key]: !state[key] })}
      {...hoverProps(name)}
    >
      {label}
    </button>
  );

  return (
    <div className="find-card" data-hit>
      <div className="find-row">
        <button
          type="button"
          className="find-toggle"
          data-open={state.replaceOpen ? "1" : "0"}
          aria-label={t("findToggleReplace")}
          aria-expanded={state.replaceOpen}
          onClick={() => onChange({ replaceOpen: !state.replaceOpen })}
          {...hoverProps(t("findToggleReplace"))}
        >
          <Icon path={ICON.chevron} size={11} />
        </button>
        <input
          ref={findRef}
          className="find-input"
          data-error={status.error ? "1" : "0"}
          type="text"
          spellCheck={false}
          aria-label={t("menuFind")}
          value={state.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onKeyDown={onInputKeyDown}
        />
        <div className="find-count" data-error={status.error ? "1" : "0"}>
          {status.text}
        </div>
        <button
          type="button"
          className="find-nav"
          aria-label={t("findPrev")}
          onClick={() => onStep(false)}
          {...hoverProps(t("findPrev"))}
        >
          <Icon path={ICON.up} size={12} />
        </button>
        <button
          type="button"
          className="find-nav"
          aria-label={t("findNext")}
          onClick={() => onStep(true)}
          {...hoverProps(t("findNext"))}
        >
          <Icon path={ICON.down} size={12} />
        </button>
        <button
          type="button"
          className="find-close"
          aria-label={t("findClose")}
          onClick={onClose}
          {...hoverProps(t("findClose"))}
        >
          <Icon path={ICON.close} size={11} />
        </button>
      </div>

      <div className="find-row find-row-opts">
        {toggle("caseSensitive", "Aa", t("findCase"))}
        {toggle("wholeWord", "ab", t("findWord"))}
        {toggle("regex", ".*", t("findRegex"))}
        <div className="find-spacer" />
        <div className="find-hint">{hint}</div>
      </div>

      {state.replaceOpen && (
        <div className="find-row find-row-repl">
          <input
            ref={replaceRef}
            className="find-input find-input-repl"
            type="text"
            spellCheck={false}
            aria-label={t("findBtnReplace")}
            value={state.replace}
            onChange={(e) => onChange({ replace: e.target.value })}
            onKeyDown={onInputKeyDown}
          />
          <button
            type="button"
            className="find-btn"
            aria-label={t("findReplace")}
            onClick={onReplace}
            {...hoverProps(t("findReplace"))}
          >
            {t("findBtnReplace")}
          </button>
          <button
            type="button"
            className="find-btn"
            aria-label={t("findReplaceAll")}
            onClick={onReplaceAll}
            {...hoverProps(t("findReplaceAll"))}
          >
            {t("findBtnAll")}
          </button>
        </div>
      )}
    </div>
  );
}
