import type { DocFormat } from "../lib/editor/DocHost";
import { encName, eolName, type Encoding, type Eol } from "../lib/file";
import { t, tf } from "../lib/i18n";
import { zoomLabel } from "../lib/zoom";

export interface DocStats {
  /** 커서가 있는 줄(1부터). **편집 중 논리 줄** 기준이다(설계 문서 §12-6). */
  line: number;
  col: number;
  chars: number;
  format: DocFormat;
  /** 디스크에 있던 인코딩·줄바꿈(탭의 값). 저장하면 UTF-8 / LF가 된다. */
  enc: Encoding;
  eol: Eol;
  /** 임계값을 넘은 `.md`를 일반 텍스트로 열었는가 — 안내가 한 조각 더 붙는다. */
  bigMd: boolean;
}

interface Props {
  stats: DocStats;
  overlay: boolean;
  /** 설정의 "상태 표시줄" 스위치 — R5에서는 이 글자를 켜고 끈다. */
  shown: boolean;
  /**
   * `알림 예약됨 — 2026-11-05 15:30` (원본 `kStrRemindSetFmt`). 예약이 없으면 빈 문자열.
   *
   * 원본은 바닥 바의 **왼쪽**(켜진 모드를 적는 쪽)에 이 글자를 두었다. R5에는 바닥 바가
   * 없고 오른쪽 아래 글자 한 줄뿐이라, 지시대로 **그 줄의 맨 앞**에 붙인다 — 왼쪽
   * 자리의 뜻("지금 켜져 있는 것")을 같은 줄 안에서 지키는 가장 가까운 자리다.
   */
  reminder: string;
  /**
   * 글자 크기(%) — **100%가 아닐 때만** 조각 하나가 붙는다(`120%`). 메모장도 상태
   * 표시줄에 퍼센트를 보여 주고 100%에서는 보여 주지 않는다. 창의 성질이라
   * `DocStats`(탭의 것)와 따로 받는다.
   */
  zoom: number;
  /**
   * 떠 있는 도구 줄과 **겹치는가**(판단은 `lib/dockFit.ts`의 `statusCollides`, 측정은
   * `App`). 겹치면 `visibility`로 숨는다 — `display: none`으로 지우면 사각형이 0이 되어
   * "겹치지 않음 → 다시 보임 → 겹침"이 무한히 돈다. 자리는 그대로다.
   */
  collide: boolean;
}

/**
 * 상태 글자 — 시안 R5 (오른쪽 아래 11px dim, 오른쪽 14 · 아래 24, `4:9 · 62자`).
 *
 * A 배치의 24px 상태 표시줄을 대신한다. 조각 순서는 원본 `StatusBarDocText`와 같다:
 * **줄:칸 · 글자 수 · 인코딩 · 줄바꿈 · 형식**. 구분자는 R5의 ` · ` 하나다.
 *
 * 오버레이에서 켜진 모드 안내(`Overlay · Ctrl+Shift+T`)는 원본처럼 왼쪽 아래에
 * 남는다 — 모드를 끄는 단축키를 알려 주는 유일한 자리라 상태 글자 스위치와 무관하게
 * 늘 보인다.
 */
export default function StatusText({
  stats,
  overlay,
  shown,
  reminder,
  zoom,
  collide,
}: Props) {
  const parts = [
    ...(reminder === "" ? [] : [reminder]),
    tf("statusLineColCharsFmt", stats.line, stats.col, stats.chars),
    encName(stats.enc),
    eolName(stats.eol),
    t(stats.format === "markdown" ? "statusFmtMarkdown" : "statusFmtText"),
  ];
  if (stats.bigMd) parts.push(t("statusBigMdPlain"));
  const zoomPart = zoomLabel(zoom);
  if (zoomPart !== "") parts.push(zoomPart);
  return (
    <>
      {overlay && (
        <div className="status-overlay" data-hit>
          {t("statusOverlay")}
        </div>
      )}
      {shown && (
        <div className="status-text" data-hit data-collide={collide ? "1" : "0"}>
          {parts.join(" · ")}
        </div>
      )}
    </>
  );
}
