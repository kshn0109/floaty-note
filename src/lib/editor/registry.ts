/**
 * 탭 id → 편집기 호스트. 탭마다 **독립된 문서 상태**를 들고 있는 자리다(§10).
 *
 * React 상태가 아니라 모듈 하나가 들고 있는 `Map`인 이유: 편집기 상태는 렌더 결과가
 * 아니라 살아 있는 객체(DOM·IME·스크롤)이고, React 상태에 넣으면 StrictMode의 두 번
 * 호출과 재렌더마다 새로 만들게 된다. 탭 목록(`tabs.ts`)은 그대로 React 상태다.
 */

import type { DocFormat, DocHost, TabDoc } from "./DocHost";
import { MarkdownHost } from "./MarkdownHost";
import { PlainHost } from "./PlainHost";

const hosts = new Map<number, DocHost>();

export function createHost(format: DocFormat, text = ""): DocHost {
  return format === "plain" ? new PlainHost(text) : new MarkdownHost(text);
}

/** 그 탭의 호스트. 없으면 그 모드로 빈 문서를 만든다. */
export function hostOf(tabId: number, format: DocFormat): DocHost {
  const hit = hosts.get(tabId);
  if (hit && hit.kind === format) return hit;
  if (hit) hit.destroy();
  const host = createHost(format);
  hosts.set(tabId, host);
  return host;
}

export function peekHost(tabId: number): DocHost | undefined {
  return hosts.get(tabId);
}

/** 모드가 바뀌는 경우(파일을 열어 확장자가 달라질 때)에 쓴다. */
export function replaceHost(tabId: number, doc: TabDoc): DocHost {
  hosts.get(tabId)?.destroy();
  const host = createHost(doc.format);
  host.restore(doc);
  hosts.set(tabId, host);
  return host;
}

export function dropHost(tabId: number): void {
  hosts.get(tabId)?.destroy();
  hosts.delete(tabId);
}
