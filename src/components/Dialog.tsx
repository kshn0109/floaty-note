import { useEffect, useRef } from "react";

/**
 * 대화상자 — 승인된 시안 `Dialogs.dc.html`의 **D1**.
 *
 * 두 모양이 한 컴포넌트에 있다(시안 D1 열에 둘이 함께 그려져 있다):
 *
 *   * **확인 카드**(`title`이 있을 때) — 360폭 · 패딩 16 · r12 · bar 배경 · 1px hairline,
 *     제목 14px bold(아래 7), 본문 13px/1.6, 버튼은 오른쪽 정렬 간격 6 · 높이 30 ·
 *     패딩 0 13 · r10 · 12px, 주 버튼은 accent 채움. 저장 확인(저장/저장 안 함/취소)이
 *     이 모양이고 **세션 단계**에서 붙는다.
 *   * **오류 카드**(`title`이 없을 때) — 같은 카드에 패딩 12 14, 한 줄로 [글 12px +
 *     경로 11px dim] [확인 28 높이 · 패딩 0 14 · r10 · accent]. 파일을 읽거나 쓸 수
 *     없을 때 쓴다(이번 단계).
 *
 * 뒤에는 시안의 스크림(rgba(0,0,0,.25)). Enter는 주 버튼, Esc는 `cancel`로 표시된
 * 버튼(없으면 아무 일도 하지 않는다 — 원본의 모달 규칙과 같다).
 */

export interface DialogButton {
  label: string;
  /** accent 채움 + Enter가 누르는 버튼. 하나만 둔다. */
  primary?: boolean;
  /** Esc와 스크림 클릭이 누르는 버튼. */
  cancel?: boolean;
  onClick: () => void;
}

export interface DialogSpec {
  /** 있으면 확인 카드, 없으면 오류 카드 모양. */
  title?: string;
  message: string;
  /** 둘째 줄(11px dim) — 오류 카드의 파일 경로. */
  detail?: string;
  buttons: DialogButton[];
}

interface Props {
  spec: DialogSpec;
}

export default function Dialog({ spec }: Props) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { buttons } = spec;

  // 열리면 주 버튼에 초점 — Enter/Space가 바로 듣고, Tab 순서도 거기서 시작한다.
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const cancel = buttons.find((b) => b.cancel);
        if (!cancel) return;
        e.preventDefault();
        e.stopPropagation();
        cancel.onClick();
      } else if (e.key === "Enter") {
        const primary = buttons.find((b) => b.primary);
        if (!primary) return;
        e.preventDefault();
        e.stopPropagation();
        primary.onClick();
      }
    };
    // 캡처 단계 — 편집기와 찾기 바보다 먼저 가져간다(모달이므로).
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [buttons]);

  const kind = spec.title === undefined ? "error" : "confirm";

  return (
    <>
      <div
        className="dialog-scrim"
        data-hit
        onMouseDown={() => buttons.find((b) => b.cancel)?.onClick()}
      />
      <div className="dialog" data-kind={kind} role="dialog" aria-modal="true" data-hit>
        {kind === "confirm" ? (
          <>
            <div className="dialog-title">{spec.title}</div>
            <div className="dialog-message">{spec.message}</div>
            {spec.detail !== undefined && <div className="dialog-detail">{spec.detail}</div>}
            <div className="dialog-buttons">
              {buttons.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  ref={b.primary ? primaryRef : undefined}
                  data-primary={b.primary ? "1" : "0"}
                  onClick={b.onClick}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="dialog-error-text">
              <div className="dialog-message">{spec.message}</div>
              {spec.detail !== undefined && <div className="dialog-detail">{spec.detail}</div>}
            </div>
            {buttons.map((b) => (
              <button
                key={b.label}
                type="button"
                ref={b.primary ? primaryRef : undefined}
                data-primary={b.primary ? "1" : "0"}
                onClick={b.onClick}
              >
                {b.label}
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
