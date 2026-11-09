import { useRef, type RefObject } from "react";

import { t, tf } from "../lib/i18n";
import { recentLabel, type OtherNote } from "../lib/noteList";
import { tabLabel, type Tab } from "../lib/tabs";
import { PanelIcon, TabClose, TintDot } from "./TitleBar";
import { useTabDrag, type TearInfo } from "./useTabDrag";

/**
 * 메모 목록 — 시안 R5List (왼쪽 패널, 폭 168, bar 배경, 오른쪽 1px hairline).
 *
 * 머리 36px: [목록 닫기 버튼 26 (활성 = hover 채움)] + `메모 N` 11px dim.
 * 항목 30 · r8 · 패널 안쪽 여백 6 · 간격 2 · 패딩 0 9 · 간격 8:
 * [색 점 8][이름][미저장 점 6 accent]. 활성 = field 채움 + 600 + text, 비활성 = 투명 + dim.
 * 맨 끝에 `+ 새 메모`.
 *
 * **알약 탭과 같은 목록을 다른 모양으로 보여 줄 뿐이다**(탭 데이터는 하나).
 * 클릭은 전환, 가운데 클릭은 닫기, 끌면 순서가 바뀐다 — 끌기는 알약 탭과 **같은 코드**
 * (`useTabDrag`)이고 축만 세로다. **목록 항목을 패널 밖으로 끌어도 떼어내기**가 되고
 * (지시: 메모 목록 항목을 끌 때도 같은 고스트), 다른 창에서 끌어온 탭이 이 목록 위에
 * 있으면 `dropAt`이 들어갈 자리를 알려 준다.
 *
 * 오버레이에서도 불투명하게 남고 클릭 통과 대상(`data-hit`)에 들어간다.
 *
 * ## 목록은 **모든 창 공통**이다 (사용자 결정)
 *
 * 이 창의 메모 아래에 두 묶음이 더 붙는다. 섹션 라벨 모양은 승인된 시안 `Popups.dc.html`의
 * 섹션 라벨 그대로다(22px · 11px dim · 패딩 0 10).
 *
 *   `다른 창`     다른 창에 열려 있는 메모. **창이 여럿일 때만** 보인다. 같은 줄 모양
 *                (30 · r8 · 비활성 dim)이고 클릭하면 그 창이 앞으로 오고 그 탭이 활성이
 *                된다 — 메모는 원래 창에 그대로 남는다. **✕와 끌기는 없다**(판단):
 *                남의 창의 탭을 여기서 닫으면 그 창에서 저장 확인(D1)이 떠야 하고, 끌기는
 *                이미 알약 탭의 떼어내기·합치기가 하는 일이다. 둘 다 전례가 없는 동작을
 *                지어내는 쪽이라 넣지 않았다.
 *   `최근 파일`   **지금 어느 창에도 열려 있지 않은** 최근 파일. 이름만 보이고 가리키면
 *                전체 경로가 툴팁으로, 가리킬 때 ✕는 **목록에서 빼기**다(파일은 안 지운다).
 *                클릭하면 이 창에 새 탭으로 열린다(기존 열기 규칙).
 *
 * 줄이 길어지면 머리를 뺀 **패널 안쪽이 스크롤**한다. 놓을 자리를 재는 `[data-tab="1"]`은
 * 이 창의 메모 줄에만 붙는다 — 다른 창·최근 파일 줄이 거기 끼면 끌어온 탭이 엉뚱한
 * 자리에 꽂힌다.
 *
 * ## 좁은 창의 **색 점 막대**(`rail` — 사용자 보고 2)
 *
 * 전에는 창이 480보다 좁으면 목록을 **아예 숨겼다**. 켜 둔 목록은 어떤 폭에서도
 * 사라지지 않아야 하므로(사용자 요청) 좁으면 **폭 42의 막대**로 접는다: 머리에 목록
 * 닫기 버튼, 항목마다 색 점 8 + 활성 표시(왼쪽 2px accent 띠 + field 채움), 가리키면
 * 이름 툴팁, 맨 아래 `+`. **같은 컴포넌트·같은 끌기 코드**라 클릭 전환·가운데 클릭 닫기·
 * 끌어서 순서 바꾸기·떼어내기가 제 폭 목록과 똑같다. 아주 좁은 창(180 이하)에서도
 * 막대는 그대로 남는다 — 숨기면 메모를 옮겨 다닐 손잡이가 없어진다.
 *
 * 막대에서도 **다른 창의 메모는 보인다**: hairline 구분선 아래에 흐린 색 점으로 들어가고
 * 가리키면 이름 툴팁, 클릭하면 그 창으로 간다. **최근 파일은 막대에서 생략한다**(판단):
 * 색 점은 메모지 색인데 최근 파일에는 색이 없어 전부 빈 동그라미가 되고, 이름이 보이지
 * 않는 42px 막대에서 "어떤 파일인지 모르는 점"을 눌러 새 탭이 열리는 쪽이 더 나쁘다.
 * 최근 파일이 필요하면 창을 480 이상으로 넓히면 제 폭 목록이다.
 *
 * ## 머리 버튼은 **늘 목록을 끈다** (사용자 보고 4)
 *
 * 전에는 막대의 머리 버튼이 좁은 창에서 목록을 **펼쳤다**. 그래서 막대 ↔ 제 폭 목록만
 * 오가고 목록을 끌 수가 없었다. 이제 제 폭 목록이든 막대든 머리 버튼은 **목록 끄기
 * 하나**이고(위 줄의 목록 버튼·☰ › 보기 › 메모 목록과 같은 토글), 켜져 있을 때의 모양은
 * 창 폭이 정한다(`listMode`). 좁은 창에서 막대를 펼치는 단계는 **없앴다**(판단): 머리
 * 버튼이 끄기가 되면 펼치기를 걸 자리가 승인된 시안에 없고, 없는 요소를 지어내지 않는다.
 *
 * 막대일 때는 이름이 보이지 않으므로 **알약 탭이 위 줄에 그대로 남는다**(`TitleBar`의
 * `listMode`). 그래서 막대와 알약 둘 다 보이고, 끌어온 탭을 놓는 자리(`zoneRef`)는
 * 위 줄의 알약 줄 하나로 유지된다 — 막대는 자기 안쪽 끌기만 본다.
 */

interface Props {
  tabs: readonly Tab[];
  activeId: number;
  /** 좁은 창에서 접힌 모양(색 점만 보이는 막대)인가. */
  rail: boolean;
  /** 다른 창에 열려 있는 메모(창 순서대로). 비어 있으면 `다른 창` 묶음이 없다. */
  others: readonly OtherNote[];
  /** 최근 연 파일 — 지금 어느 창에도 열려 있지 않은 것만. */
  recent: readonly string[];
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onNewTab: () => void;
  /** 다른 창의 메모를 눌렀다 — 그 창을 앞으로, 그 탭을 활성으로. */
  onPickOther: (note: OtherNote) => void;
  /** 최근 파일을 눌렀다 — 이 창에 새 탭으로(이미 열려 있으면 그 창·탭으로). */
  onPickRecent: (path: string) => void;
  /** 최근 파일 줄의 ✕ — **목록에서만** 뺀다(파일은 그대로 있다). */
  onDropRecent: (path: string) => void;
  /** 끌어서 순서 바꾸기 — 알약 탭과 같은 함수로 들어간다. */
  onReorder: (id: number, to: number) => void;
  /** 머리 버튼 — 제 폭 목록이든 막대든 **목록을 끈다**(위 줄 목록 버튼과 같은 토글). */
  onClose: () => void;
  /** 항목 목록 요소 — `App`이 놓을 자리(드롭 존)를 재는 데 쓴다. */
  zoneRef: RefObject<HTMLDivElement | null>;
  onTear: (info: TearInfo) => void;
  tearing: boolean;
  dropAt: number | null;
}

export default function NoteList({
  tabs,
  activeId,
  rail,
  others,
  recent,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onPickOther,
  onPickRecent,
  onDropRecent,
  onReorder,
  onClose,
  zoneRef,
  onTear,
  tearing,
  dropAt,
}: Props) {
  // 막대일 때 놓을 자리는 위 줄의 알약 줄이다(알약이 거기 그대로 있다) — 막대는 자기
  // 안쪽 끌기만 보도록 자기 ref를 쓴다.
  const ownRef = useRef<HTMLDivElement>(null);
  const itemsRef = rail ? ownRef : zoneRef;
  const drag = useTabDrag({
    container: itemsRef,
    axis: "y",
    onReorder,
    onTear,
    tearing,
  });

  return (
    <div className="notelist" data-rail={rail ? "1" : "0"} data-hit>
      <div className="notelist-head">
        <button
          className="list-toggle"
          type="button"
          data-active="1"
          aria-label={t("noteListClose")}
          title={t("noteListClose")}
          onClick={onClose}
        >
          <PanelIcon />
        </button>
        {!rail && <div className="notelist-count">{tf("noteListCountFmt", tabs.length)}</div>}
      </div>

      {/* 끌기·놓기의 기준 상자는 **스크롤 영역 전체**다(`itemsRef`). 안쪽의
          `.notelist-items`에만 붙이면 상자가 이 창의 메모 줄에 딱 맞게 줄어들어, 마지막
          줄 아래로 6px만 끌어도 떼어내기가 시작되고(`tearStarted`) 패널의 빈 곳에 놓은
          탭이 이 창에 들어오지 않는다 — 목록에 묶음이 붙기 전과 같게 둔다.
          순서 계산이 보는 `[data-tab="1"]`은 이 창의 메모 줄에만 붙는다. */}
      <div className="notelist-scroll" ref={itemsRef}>
        <div className="notelist-items">
          {tabs.map((tab, i) => (
            <button
              className="notelist-item"
              type="button"
              key={tab.id}
              data-tab="1"
              data-drop={dropAt === i ? "before" : undefined}
              data-active={tab.id === activeId ? "1" : "0"}
              // 막대는 이름이 없으므로 가리키면 툴팁으로 알려 준다.
              title={rail ? tabLabel(tab) : undefined}
              onClick={() => {
                if (!drag.tore()) onSelectTab(tab.id);
              }}
              onPointerDown={(e) => drag.down(e, tab.id)}
              onPointerMove={(e) => drag.move(e, tab.id)}
              onPointerUp={drag.up}
              onPointerCancel={drag.up}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
            >
              <TintDot tint={tab.tint} />
              {!rail && <span className="notelist-name">{tabLabel(tab)}</span>}
              {tab.dirty && <span className="dirty-dot" />}
              {/* 항목은 좁아서(168 패널) 미저장 점과 ✕가 같은 자리다 — 가리키면 ✕가
                  그 자리를 **대신한다**(지시). 탭이 하나뿐이면 ✕가 없다.
                  막대에는 ✕가 들어갈 자리가 없다 — 닫기는 가운데 클릭이다(알약과 같다). */}
              {!rail && tabs.length > 1 && <TabClose onClose={() => onCloseTab(tab.id)} />}
            </button>
          ))}

          {dropAt !== null && dropAt >= tabs.length && <span className="drop-mark" />}
        </div>

        {/* --- 다른 창에 열려 있는 메모 (창이 여럿일 때만) --- */}
        {others.length > 0 && (
          <>
            {rail ? (
              <div className="notelist-rail-sep" />
            ) : (
              <div className="notelist-section">{t("noteListOther")}</div>
            )}
            <div className="notelist-group" data-other="1">
              {others.map((note) => (
                <button
                  className="notelist-item"
                  type="button"
                  key={`${note.label}:${note.uid}`}
                  title={note.name ?? t("tabUntitled")}
                  onClick={() => onPickOther(note)}
                >
                  <TintDot tint={note.tint} />
                  {!rail && (
                    <span className="notelist-name">{note.name ?? t("tabUntitled")}</span>
                  )}
                  {note.dirty && <span className="dirty-dot" />}
                </button>
              ))}
            </div>
          </>
        )}

        {/* --- 최근 연 파일 (막대에서는 생략 — 위 주석의 판단) --- */}
        {!rail && recent.length > 0 && (
          <>
            <div className="notelist-section">{t("noteListRecent")}</div>
            <div className="notelist-group" data-other="1">
              {recent.map((path) => (
                <button
                  className="notelist-item"
                  type="button"
                  key={path}
                  // 가리키면 전체 경로(지시). 줄에 보이는 것은 파일 이름뿐이다.
                  title={path}
                  onClick={() => onPickRecent(path)}
                >
                  <TintDot tint="none" />
                  <span className="notelist-name">{recentLabel(path)}</span>
                  <TabClose
                    label={t("noteListRecentRemove")}
                    onClose={() => onDropRecent(path)}
                  />
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className="notelist-item"
          type="button"
          title={rail ? t("noteListNew") : undefined}
          aria-label={rail ? t("noteListNew") : undefined}
          onClick={onNewTab}
        >
          <span className="notelist-plus">+</span>
          {!rail && <span className="notelist-name">{t("noteListNew")}</span>}
        </button>
      </div>
    </div>
  );
}
