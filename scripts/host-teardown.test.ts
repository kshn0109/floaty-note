// @vitest-environment happy-dom
/**
 * **호스트를 치울 때 DOM이 정말 사라지는지** 시험 — 사용자 보고:
 * `.txt`를 저장하고 다시 열면 왼쪽에 여백이 생겨 글이 가운데로 몰렸다.
 *
 * 원인은 두 겹이었다.
 *   1) `MarkdownHost.mount()`는 뷰를 `new EditorView({ mount: … }, …)`로 만든다.
 *      `prosemirror-view`의 `destroy()`는 **mounted 노드를 떼지 않고 안만 비운다.**
 *      `destroy()`가 `this.view = null`만 하면 나중 `unmount()`는 떼야 할 노드를
 *      더는 모르고, `.editor` 안에 class 없는 빈 div가 쌓인다.
 *   2) `index.css`의 `.editor[data-engine="plain"] > *`가 그 빈 div까지 늘려
 *      CodeMirror와 폭을 나눠 가졌다 → 글이 가운데로.
 *
 * 그래서 이 시험은 "호스트를 치운 뒤 붙였던 자리에 자식이 하나도 없다"와
 * "모드를 바꿔 다시 붙이면 자식이 **정확히 `.cm-editor` 하나**"를 본다.
 * 두 번째가 CSS 쪽 조건까지 대신 지킨다(늘어날 자식이 하나뿐이면 몰릴 수 없다).
 *
 * UI 자동 테스트가 아니다: 그리거나 찍지 않고 DOM 자식 수만 센다.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { DocHost } from "../src/lib/editor/DocHost";
import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { dropHost, hostOf, replaceHost } from "../src/lib/editor/registry";

const MD = "# 제목\n\n본문 한 줄.\n";
const TXT = "첫 줄\n둘째 줄\n";

/** 실제 앱의 `Editor` 컴포넌트가 하는 일 — `.editor` 자리를 만들어 호스트를 붙인다. */
function slot(): HTMLElement {
  const el = document.createElement("div");
  el.className = "editor";
  document.body.appendChild(el);
  return el;
}

function mount(host: DocHost, el: HTMLElement): DocHost {
  // `Editor.tsx`와 같은 순서: 붙이기 전에 비운다.
  el.replaceChildren();
  host.mount(el);
  return host;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("호스트를 치우면 DOM도 사라진다", () => {
  it("MarkdownHost: mount → destroy 뒤 자식이 없다 (이번 버그)", () => {
    const el = slot();
    const host = mount(new MarkdownHost(MD), el);
    expect(el.children.length).toBe(1);

    host.destroy();
    expect(el.children.length).toBe(0);
  });

  it("MarkdownHost: unmount → destroy 순서로도 남지 않는다", () => {
    const el = slot();
    const host = mount(new MarkdownHost(MD), el);
    host.unmount();
    expect(el.children.length).toBe(0);
    host.destroy();
    expect(el.children.length).toBe(0);
  });

  it("PlainHost: mount → destroy 뒤 자식이 없다", () => {
    const el = slot();
    const host = mount(new PlainHost(TXT), el);
    expect(el.children.length).toBe(1);

    host.destroy();
    expect(el.children.length).toBe(0);
  });
});

describe("registry — 같은 자리에 여러 번 붙여도 쌓이지 않는다", () => {
  it("hostOf / dropHost를 되풀이해도 자식은 늘 하나", () => {
    const el = slot();
    for (let i = 0; i < 5; i += 1) {
      mount(hostOf(1, "markdown"), el);
      expect(el.children.length).toBe(1);
      dropHost(1);
      expect(el.children.length).toBe(0);
    }
  });

  it("hostOf가 모드를 바꾸며 낡은 호스트를 치울 때도 쌓이지 않는다", () => {
    const el = slot();
    mount(hostOf(2, "markdown"), el);
    // 같은 탭을 다른 모드로 물어보면 `hostOf`가 낡은 호스트를 `destroy()`한다.
    const next = hostOf(2, "plain");
    mount(next, el);
    expect(el.children.length).toBe(1);
    expect(el.querySelectorAll(".cm-editor").length).toBe(1);
    dropHost(2);
  });

  it("replaceHost(markdown → plain) 뒤 새 호스트를 붙이면 `.cm-editor` 하나뿐 (글이 몰린 자리)", () => {
    const el = slot();
    mount(hostOf(3, "markdown"), el);

    // 파일을 열어 확장자가 `.txt`로 바뀌는 길 — 여기서 ProseMirror 노드가 남았다.
    const plain = replaceHost(3, {
      format: "plain",
      fileSrc: TXT,
      text: TXT,
      selection: null,
      scrollTop: 0,
      history: { done: [], undone: [], savedId: null, seq: 0 },
    });
    mount(plain, el);

    expect(el.children.length).toBe(1);
    expect(el.children[0].classList.contains("cm-editor")).toBe(true);
    dropHost(3);
  });
});
