import { describe, expect, it } from "vitest";
import { mix, parseHex, withAlpha } from "../src/lib/palette";

// 배포 빌드의 CSS 압축은 `#ffffff` → `#fff`처럼 색을 줄인다. 6자리만 읽으면
// 라이트 테마가 빨강(255,15,0)으로 칠해진다.
describe("parseHex", () => {
  it("6자리", () => expect(parseHex("#1e1f24")).toEqual([30, 31, 36]));
  it("3자리(압축된 흰색)", () => expect(parseHex("#fff")).toEqual([255, 255, 255]));
  it("4자리", () => expect(parseHex("#abcd")).toEqual([170, 187, 204]));
  it("앞뒤 공백", () => expect(parseHex(" #fff ")).toEqual([255, 255, 255]));
  it("rgb()", () => expect(parseHex("rgb(1, 2, 3)")).toEqual([1, 2, 3]));
  it("withAlpha·mix도 압축 색을 받는다", () => {
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(mix("#fff", "#000", 50)).toBe("rgb(128, 128, 128)");
  });
});
