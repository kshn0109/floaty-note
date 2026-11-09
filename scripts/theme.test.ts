/**
 * 테마 × 메모지 색 규칙 — **사용자 결정 2026-11-08** 이후의 모양.
 *
 * 한 줄로: 두 축은 완전히 독립이다. 테마는 앱 전체 값이고 색은 탭별 값이며,
 * 어느 쪽을 골라도 다른 쪽이 바뀌지 않는다. 색이 있으면 테마와 무관하게 그 색 종이다.
 *
 * (예전 규칙 — `밝게`가 색을 지우고, 다크에서 색을 고르면 밝게로 바뀌던 것(수정 10) —
 * 은 없어졌다. 아래 마지막 describe가 그 둘이 되살아나지 않는지 지킨다.)
 */

import { describe, expect, it } from "vitest";

import { THEMES } from "../src/lib/palette";
import {
  TINTS,
  THEME_CHOICES,
  applyTint,
  chooseTheme,
  cycleTheme,
  paletteName,
  resolvedChoice,
  type ThemeState,
} from "../src/lib/theme";

const COLORS = TINTS.filter((t) => t !== "none");

describe("paletteName — 색이 있으면 테마와 무관하게 그 색 팔레트", () => {
  it("색이 있는 탭은 어떤 테마에서도 그 색 종이다", () => {
    for (const tint of COLORS) {
      for (const choice of THEME_CHOICES) {
        expect(paletteName(choice, tint, true)).toBe(tint);
        expect(paletteName(choice, tint, false)).toBe(tint);
      }
    }
  });

  it("색이 없으면 테마가 다크/라이트를 정한다", () => {
    expect(paletteName("dark", "none", false)).toBe("dark");
    expect(paletteName("dark", "none", true)).toBe("dark");
    expect(paletteName("light", "none", true)).toBe("light");
    expect(paletteName("light", "none", false)).toBe("light");
  });

  it("`시스템`은 OS가 어느 쪽인지로 정한다 (색이 없을 때만 의미가 있다)", () => {
    expect(paletteName("system", "none", true)).toBe("dark");
    expect(paletteName("system", "none", false)).toBe("light");
    expect(paletteName("system", "mint", true)).toBe("mint");
  });

  it("돌려주는 이름은 언제나 실제 팔레트 여섯 중 하나다", () => {
    for (const tint of TINTS) {
      for (const choice of THEME_CHOICES) {
        for (const osDark of [true, false]) {
          expect(THEMES).toContain(paletteName(choice, tint, osDark));
        }
      }
    }
  });
});

describe("테마를 고르는 일은 색을 건드리지 않는다", () => {
  it("어떤 색의 탭에서 어떤 테마를 골라도 색이 그대로다", () => {
    for (const tint of TINTS) {
      for (const from of THEME_CHOICES) {
        for (const to of THEME_CHOICES) {
          const next = chooseTheme({ choice: from, tint }, to);
          expect(next).toEqual({ choice: to, tint });
        }
      }
    }
  });

  it("`밝게`도 색을 지우지 않는다 (예전 수정 10 규칙이 없어졌다)", () => {
    expect(chooseTheme({ choice: "dark", tint: "yellow" }, "light")).toEqual({
      choice: "light",
      tint: "yellow",
    });
  });
});

describe("색을 고르는 일은 테마를 건드리지 않는다", () => {
  it("다크에서 색을 골라도 테마 선택은 `어둡게`로 남는다", () => {
    for (const tint of COLORS) {
      expect(applyTint({ choice: "dark", tint: "none" }, tint)).toEqual({
        choice: "dark",
        tint,
      });
    }
  });

  it("`색 없음`은 색만 지운다", () => {
    expect(applyTint({ choice: "dark", tint: "pink" }, "none")).toEqual({
      choice: "dark",
      tint: "none",
    });
    expect(applyTint({ choice: "system", tint: "sky" }, "none")).toEqual({
      choice: "system",
      tint: "none",
    });
  });

  it("어떤 상태에서든 테마 선택은 입력과 같다", () => {
    for (const choice of THEME_CHOICES) {
      for (const tint of TINTS) {
        expect(applyTint({ choice, tint: "none" }, tint).choice).toBe(choice);
      }
    }
  });
});

describe("Ctrl+Shift+M — 어둡게 → 밝게 → 시스템만 돈다", () => {
  it("세 번 돌면 제자리로 온다", () => {
    let s: ThemeState = { choice: "dark", tint: "none" };
    s = cycleTheme(s);
    expect(s.choice).toBe("light");
    s = cycleTheme(s);
    expect(s.choice).toBe("system");
    s = cycleTheme(s);
    expect(s.choice).toBe("dark");
  });

  it("순환이 색을 건드리지 않는다 (노란 탭은 세 번 돌아도 노랗다)", () => {
    let s: ThemeState = { choice: "dark", tint: "yellow" };
    for (let i = 0; i < 6; i += 1) {
      s = cycleTheme(s);
      expect(s.tint).toBe("yellow");
      expect(paletteName(s.choice, s.tint, true)).toBe("yellow");
    }
  });
});

describe("resolvedChoice — `시스템`만 OS를 본다", () => {
  it("고정 두 값은 OS와 무관하다", () => {
    expect(resolvedChoice("dark", false)).toBe("dark");
    expect(resolvedChoice("light", true)).toBe("light");
  });

  it("`시스템`은 OS를 따른다", () => {
    expect(resolvedChoice("system", true)).toBe("dark");
    expect(resolvedChoice("system", false)).toBe("light");
  });
});

describe("없어진 두 규칙이 되살아나지 않는다", () => {
  it("테마 → 색 방향의 변화가 **한 번도** 없다", () => {
    for (const tint of TINTS) {
      for (const from of THEME_CHOICES) {
        for (const to of THEME_CHOICES) {
          expect(chooseTheme({ choice: from, tint }, to).tint).toBe(tint);
        }
      }
    }
  });

  it("색 → 테마 방향의 변화가 **한 번도** 없다", () => {
    for (const choice of THEME_CHOICES) {
      for (const before of TINTS) {
        for (const after of TINTS) {
          expect(applyTint({ choice, tint: before }, after).choice).toBe(choice);
        }
      }
    }
  });
});
