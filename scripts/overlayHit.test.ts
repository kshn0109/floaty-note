import { describe, expect, it } from "vitest";

import { scrollbarBand, type Box } from "../src/lib/overlayHitRects";

/**
 * 오버레이 모드에서 **스크롤 막대 띠**가 히트 영역에 들어가는 조건
 * (사용자 보고 3: 막대가 보이는데 잡을 수 없으면 안 된다).
 *
 * 순수한 계산뿐이라 DOM이 필요 없다 — 띠를 실제로 모으는 쪽(`collectHitRects`)은
 * 요소에서 네 값을 읽어 이 함수에 넘긴다.
 */

const box: Box = { left: 0, top: 36, right: 400, bottom: 500 };

describe("scrollbarBand", () => {
  it("막대가 있고 구를 내용이 있으면 오른쪽 끝에서 막대 두께만큼", () => {
    expect(scrollbarBand(box, 14, 2000, 464)).toEqual({
      left: 386,
      top: 36,
      right: 400,
      bottom: 500,
    });
  });

  it("구를 내용이 없으면 띠가 없다 — 빈 곳은 클릭 통과로 남는다", () => {
    expect(scrollbarBand(box, 14, 400, 464)).toBeNull();
    expect(scrollbarBand(box, 14, 464, 464)).toBeNull();
  });

  it("막대가 자리를 차지하지 않으면(겹쳐 그리는 막대·스크롤 안 하는 요소) 띠가 없다", () => {
    expect(scrollbarBand(box, 0, 2000, 464)).toBeNull();
    expect(scrollbarBand(box, -2, 2000, 464)).toBeNull();
  });

  it("요소가 막대보다 좁으면 띠가 없다(폭이 0 이하가 되는 자리)", () => {
    expect(scrollbarBand({ left: 0, top: 0, right: 14, bottom: 100 }, 14, 2000, 50)).toBeNull();
  });

  it("띠는 요소의 위아래 전체를 덮는다 — 막대를 어디서 잡아도 끌린다", () => {
    const band = scrollbarBand(box, 14, 2000, 464);
    expect(band?.top).toBe(box.top);
    expect(band?.bottom).toBe(box.bottom);
  });
});
