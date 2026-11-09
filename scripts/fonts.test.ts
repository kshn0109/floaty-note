import { describe, expect, it } from "vitest";

import {
  DOC_FONT_FALLBACK,
  DOC_SIZE_DEFAULT,
  FONT_SIZES,
  FONT_SIZE_DEFAULT,
  MONO_FONT_FALLBACK,
  cleanFontList,
  docFontCss,
  docSizePx,
  monoFontCss,
  pickFontSize,
  quoteFamily,
} from "../src/lib/fonts";

/**
 * 설정 › 모양 › `글꼴`(시안 G1 · 사용자 결정 2026-11-09)의 **순수한 계산**.
 * 화면에 심는 일(`App`)과 Windows에서 목록을 읽는 일(Rust)은 여기 없다.
 */

describe("크기 — pt → 본문 px", () => {
  it("기본 11pt는 **지금과 똑같은 15px**이다 (이 줄이 이 기능의 전제다)", () => {
    expect(FONT_SIZE_DEFAULT).toBe(11);
    expect(docSizePx(FONT_SIZE_DEFAULT)).toBe(DOC_SIZE_DEFAULT);
    expect(docSizePx(11)).toBe(15);
  });

  it("비례한다 — 두 배 pt면 두 배 px", () => {
    expect(docSizePx(22)).toBe(30);
    expect(docSizePx(44)).toBe(60);
  });

  it("단계마다 커진다 (메모장과 같은 단계 전부)", () => {
    const px = FONT_SIZES.map(docSizePx);
    for (let i = 1; i < px.length; i += 1) {
      expect(px[i]).toBeGreaterThan(px[i - 1] as number);
    }
    expect(px[0]).toBeCloseTo(10.91, 2);
    expect(px[px.length - 1]).toBeCloseTo(98.18, 2);
  });

  it("숫자가 아니면 기본 크기", () => {
    expect(docSizePx(Number.NaN)).toBe(15);
  });

  it("목록에 없는 크기는 받지 않는다 (저장 파일이 깨져 있어도 기본으로 돈다)", () => {
    expect(pickFontSize(11)).toBe(11);
    expect(pickFontSize(72)).toBe(72);
    expect(pickFontSize(13)).toBe(FONT_SIZE_DEFAULT);
    expect(pickFontSize("11")).toBe(FONT_SIZE_DEFAULT);
    expect(pickFontSize(undefined)).toBe(FONT_SIZE_DEFAULT);
  });
});

describe("글꼴 — CSS `font-family` 만들기", () => {
  it("`기본`(빈 문자열)은 **지금 값 그대로**다 — 마크다운 Segoe UI 계열, 텍스트 고정폭", () => {
    expect(docFontCss("")).toBe(DOC_FONT_FALLBACK);
    expect(monoFontCss("")).toBe(MONO_FONT_FALLBACK);
  });

  it("고른 글꼴은 **맨 앞**에 붙고 기존 폴백이 뒤에 남는다 (두 탭 종류 모두 같은 글꼴)", () => {
    expect(docFontCss("Arial")).toBe(`"Arial", ${DOC_FONT_FALLBACK}`);
    expect(monoFontCss("Arial")).toBe(`"Arial", ${MONO_FONT_FALLBACK}`);
  });

  it("공백·한글 이름은 따옴표로 묶는다", () => {
    expect(quoteFamily("맑은 고딕")).toBe('"맑은 고딕"');
    expect(quoteFamily("Courier New")).toBe('"Courier New"');
  });

  it("CSS를 깨뜨릴 글자는 지운다 (값 주입 차단)", () => {
    expect(quoteFamily('A"; color: red; font-family: "B')).toBe('"A color: red font-family: B"');
    expect(quoteFamily("A\\B")).toBe('"AB"');
    expect(quoteFamily("   ")).toBe("");
    // 지워서 빈 이름이 되면 폴백만 쓴다.
    expect(docFontCss("}{")).toBe(DOC_FONT_FALLBACK);
  });
});

describe("목록 정리 — Rust가 준 날목록 → 드롭다운", () => {
  it("`@`로 시작하는 세로쓰기 글꼴은 뺀다", () => {
    expect(cleanFontList(["@맑은 고딕", "맑은 고딕", "@Batang"])).toEqual(["맑은 고딕"]);
  });

  it("중복은 하나만 (대소문자가 달라도 같은 글꼴이다)", () => {
    expect(cleanFontList(["Arial", "Arial", "ARIAL"])).toEqual(["Arial"]);
  });

  it("빈 이름·공백만 있는 이름은 뺀다", () => {
    expect(cleanFontList(["", "   ", "Arial"])).toEqual(["Arial"]);
  });

  /**
   * 한국어 로캘 비교(`localeCompare(_, "ko")`)를 그대로 쓴다 — 시안 G1이 말하는
   * `가나다순`이다. 한글이 영문보다 앞에 온다(ICU의 한국어 정렬).
   *
   * **확인하지 못한 것**: Windows 11 메모장의 글꼴 드롭다운이 한글 이름을 위에 두는지
   * 아래에 두는지는 확인하지 못했다. Windows `설정 › 글꼴`은 영문 이름을 먼저 보여
   * 주지만 메모장의 목록을 직접 보지 못했으므로 추측으로 규칙을 만들지 않고 로캘
   * 비교를 쓴다. 사용자가 다르게 보길 원하면 이 함수 한 줄이다.
   */
  it("가나다순 — 한국어 로캘 비교(한글이 영문 앞)", () => {
    expect(cleanFontList(["Segoe UI", "맑은 고딕", "Arial", "굴림"])).toEqual([
      "굴림",
      "맑은 고딕",
      "Arial",
      "Segoe UI",
    ]);
  });

  it("빈 목록도 그냥 빈 목록이다 (글꼴을 못 읽어도 `기본`만 남고 앱은 돈다)", () => {
    expect(cleanFontList([])).toEqual([]);
  });
});
