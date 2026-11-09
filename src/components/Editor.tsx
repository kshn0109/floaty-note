import { useEffect, type RefObject } from "react";

import type { ChangeReason, DocHost } from "../lib/editor/DocHost";

interface Props {
  /** 오버레이의 글자 사각형을 모으는 자리(`overlayHitRects.ts`). 스크롤 컨테이너다. */
  editorRef: RefObject<HTMLDivElement | null>;
  /** 지금 탭의 편집기. 탭마다 하나씩 있고 살아 있는 채로 DOM만 옮겨 다닌다. */
  host: DocHost;
  /** 내용·커서·뷰포트가 바뀔 때마다 상태 글자와 오버레이 사각형을 다시 계산하게 한다. */
  onChange: (why: ChangeReason) => void;
  /** 우클릭 메뉴를 그 자리에 연다. */
  onContextMenu: (x: number, y: number) => void;
}

/**
 * 편집 영역 — 지금 탭의 `DocHost`를 여기에 붙인다.
 *
 * 이 컴포넌트는 **엔진을 모른다**: 마크다운(ProseMirror)이든 일반 텍스트(CodeMirror)든
 * `mount`/`unmount`/`onChange`만 쓴다. 밖으로 나가는 것도 `editorRef`(글자 줄 사각형
 * 계산용)와 `onChange`뿐이라 오버레이·상태 글자 코드가 엔진에 묶이지 않는다.
 *
 * 여백·본문 크기·줄 간격은 CSS(시안 A 수치)에 있고, 모드는 `data-engine`으로 알린다 —
 * 일반 텍스트 모드는 CodeMirror가 자기 스크롤 영역을 가져야 보이는 줄만 그릴 수 있다.
 */
export default function Editor({ editorRef, host, onChange, onContextMenu }: Props) {
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return undefined;
    host.mount(el);
    const off = host.onChange(onChange);
    onChange("doc");
    return () => {
      off();
      host.unmount();
    };
  }, [editorRef, host, onChange]);

  return (
    <div
      className="editor"
      data-engine={host.kind}
      ref={editorRef}
      onScroll={(e) => {
        host.noteScroll(e.currentTarget.scrollTop);
        onChange("viewport");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
    />
  );
}
