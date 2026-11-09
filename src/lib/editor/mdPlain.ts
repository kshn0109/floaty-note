/**
 * 마크다운 문서를 **보이는 글자 한 줄**로 펼친 표 (설계 문서 §8).
 *
 * 찾기의 건초더미는 "파일 바이트"가 아니라 **편집기에 보이는 글자**다. `**`·`#` 같은
 * 마커는 화면에 없으므로 검색 대상이 아니고(원본도 RichEdit 안의 글자를 찾았다),
 * 소프트 줄바꿈·블록 경계·표 칸 경계는 줄바꿈 한 글자로 보인다. `DocHost.plainText()`와
 * 상태 글자·우클릭 복사가 쓰는 `textBetween(…, "\n", "\n")`과 **같은 모양**이다.
 *
 * 글자마다 문서 위치를 같이 들고 있으므로 찾은 자리를 선택하거나 바꿀 때 변환이 없다.
 * 문서 노드마다 한 번만 계산해 `WeakMap`에 담는다(선택만 바뀌면 다시 세지 않는다).
 */

import type { Node as PmNode } from "prosemirror-model";

export interface PlainIndex {
  /** 보이는 글자 전부를 이어 붙인 것. */
  text: string;
  /** 글자 i가 차지하는 문서 범위의 시작. */
  starts: number[];
  /** 글자 i가 차지하는 문서 범위의 끝. 블록 경계는 `[앞 블록 끝, 뒤 블록 시작)`이다. */
  ends: number[];
}

const cache = new WeakMap<PmNode, PlainIndex>();

export function plainIndex(doc: PmNode): PlainIndex {
  const hit = cache.get(doc);
  if (hit) return hit;

  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let first = true;
  let prevEnd = 0;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (!first) {
      // 블록 사이의 줄바꿈 한 글자. 범위가 두 블록에 걸쳐 있으므로 여기를 덮는
      // 일치는 바꿀 때 건너뛴다(`MarkdownHost.replaceHit`).
      starts.push(prevEnd);
      ends.push(pos + 1);
      text += "\n";
    }
    first = false;
    node.forEach((child, offset) => {
      const p = pos + 1 + offset;
      if (child.isText) {
        const s = child.text ?? "";
        for (let k = 0; k < s.length; k += 1) {
          starts.push(p + k);
          ends.push(p + k + 1);
        }
        text += s;
      } else {
        // 소프트 줄바꿈 — 한 글자로 보인다.
        starts.push(p);
        ends.push(p + child.nodeSize);
        text += "\n";
      }
    });
    prevEnd = pos + 1 + node.content.size;
    return false; // 텍스트블록 안은 위에서 이미 다 훑었다.
  });

  const out: PlainIndex = { text, starts, ends };
  cache.set(doc, out);
  return out;
}

/** 평문 글자 번호 → 문서 위치(글자의 시작). 끝을 넘으면 마지막 글자의 끝. */
export function plainToPos(index: PlainIndex, at: number): number {
  if (index.starts.length === 0) return 1;
  if (at <= 0) return index.starts[0];
  if (at >= index.starts.length) return index.ends[index.ends.length - 1];
  return index.starts[at];
}

/** 문서 위치 → 평문 글자 번호. 그 자리에서 시작하는 첫 글자를 가리킨다. */
export function posToPlain(index: PlainIndex, pos: number): number {
  const { starts } = index;
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
