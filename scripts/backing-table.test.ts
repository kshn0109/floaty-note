// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { backingRanges as mdBackingRanges } from "../src/lib/editor/MarkdownHost";
import { backingRanges as plainBackingRanges } from "../src/lib/editor/PlainHost";
import { blocksToDoc } from "../src/lib/md/pmdoc";
import { loadMarkdown } from "../src/lib/md/parse";

/**
 * 글자 뒤 배경(text backing)이 **글자에만** 붙는지, 그리고 **표를 망가뜨리지 않는지**.
 *
 * 사용자 보고 둘:
 *   1) 표가 있는 메모를 오버레이로 바꾸면 표가 짤렸다 — 받침이 블록에 `width:
 *      fit-content`를 주어 `table-layout: fixed`의 `width: 100%`를 덮은 탓이다.
 *   2) 저장된 `.txt`를 열면(일반 텍스트 모드) 글자 없는 빈 자리까지 크게 칠해졌다 —
 *      `fit-content`도 **접히는 줄**에서는 결국 쓸 수 있는 폭을 꽉 채우기 때문이다.
 *
 * 그래서 받침은 이제 **인라인 장식 `.backing`** 이다(`box-decoration-break: clone`이
 * 접힌 줄마다 상자를 하나씩 만든다). 표만 예전처럼 블록 하나로 칠한다.
 *
 * 레이아웃은 happy-dom에서 못 재므로 보는 것은 **선택자와 범위 계산**이다.
 * 실제로 어떻게 보이는지는 사용자가 확인한다.
 */

// vitest의 root는 프로젝트 뿌리다(`vitest.config.ts`).
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** 아주 작은 CSS 규칙 쪼개기 — `@media` 등의 중첩 블록은 통째로 건너뛴다. */
function rules(src: string): { selectors: string[]; body: string }[] {
  const out: { selectors: string[]; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel || sel.startsWith("@")) continue;
    out.push({ selectors: sel.split(",").map((s) => s.trim()), body: m[2] });
  }
  return out;
}

function dom() {
  document.body.innerHTML = `
    <div class="win" data-backing="1" data-overlay="1">
      <div class="editor" data-engine="markdown">
        <div class="pm">
          <p><span class="backing">본문</span></p>
          <h2><span class="backing">제목</span></h2>
          <table><tbody><tr><th>머리</th></tr><tr><td>본문 칸</td></tr></tbody></table>
        </div>
      </div>
    </div>`;
  return {
    p: document.querySelector("p")!,
    h: document.querySelector("h2")!,
    table: document.querySelector("table")!,
    backing: document.querySelector(".backing")!,
  };
}

function matchingSelectors(el: Element, decl: RegExp): string[] {
  return rules(css)
    .filter((r) => decl.test(r.body))
    .flatMap((r) => r.selectors)
    .filter((s) => {
      try {
        return el.matches(s);
      } catch {
        return false;
      }
    });
}

const FIT = /width\s*:\s*fit-content/;
const BACKING_BG = /background\s*:\s*var\(--text-backing\)/;

describe("받침이 켜진 상태의 표", () => {
  it("표에는 width: fit-content가 걸리지 않는다", () => {
    const { table } = dom();
    expect(matchingSelectors(table, FIT)).toEqual([]);
  });

  it("표에는 받침 색이 그대로 걸린다(오버레이에서 표 글자도 읽혀야 한다)", () => {
    const { table } = dom();
    expect(matchingSelectors(table, BACKING_BG).length).toBeGreaterThan(0);
  });

  it("표의 기본 규칙은 width: 100% + table-layout: fixed 그대로다", () => {
    const base = rules(css).find((r) => r.selectors.includes(".editor .pm table"));
    expect(base).toBeDefined();
    expect(base!.body).toMatch(/width\s*:\s*100%/);
    expect(base!.body).toMatch(/table-layout\s*:\s*fixed/);
  });
});

describe("받침은 글자에만 붙는다", () => {
  it("단락·제목 블록 자신은 이제 받침 색도 fit-content도 받지 않는다", () => {
    const { p, h } = dom();
    for (const el of [p, h]) {
      expect(matchingSelectors(el, BACKING_BG)).toEqual([]);
      expect(matchingSelectors(el, FIT)).toEqual([]);
    }
  });

  it("인라인 장식 `.backing`이 받침 색을 받는다", () => {
    const { backing } = dom();
    expect(matchingSelectors(backing, BACKING_BG).length).toBeGreaterThan(0);
  });

  it("`.backing`은 접힌 줄마다 상자를 따로 만든다(box-decoration-break: clone)", () => {
    const rule = rules(css).find((r) =>
      r.selectors.includes('.win[data-backing="1"] .editor .backing')
    );
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/box-decoration-break\s*:\s*clone/);
    expect(rule!.body).toMatch(/-webkit-box-decoration-break\s*:\s*clone/);
    // 폭을 강제하지 않는다 — 그게 빈 자리까지 칠해지던 원인이었다.
    expect(rule!.body).not.toMatch(FIT);
  });

  it("CSS 어디에도 받침용 fit-content가 남아 있지 않다", () => {
    const left = rules(css).filter(
      (r) => FIT.test(r.body) && r.selectors.some((s) => s.includes("data-backing"))
    );
    expect(left).toEqual([]);
  });
});

describe("받침 범위 — 마크다운(ProseMirror)", () => {
  function ranges(src: string) {
    return mdBackingRanges(blocksToDoc(loadMarkdown(src).blocks));
  }

  it("단락·제목마다 그 안의 글자 전체를 덮는다", () => {
    const r = ranges("# 제목\n\n본문이다\n");
    expect(r.length).toBe(2);
    // `from`은 블록 안쪽 첫 자리, 길이는 글자 수다.
    expect(r[0].to - r[0].from).toBe("제목".length);
    expect(r[1].to - r[1].from).toBe("본문이다".length);
  });

  it("빈 단락은 덮지 않는다(큰 빈 상자가 생기지 않는다)", () => {
    const r = ranges("글\n\n\n\n다음\n");
    for (const one of r) expect(one.to).toBeGreaterThan(one.from);
  });

  it("표는 건너뛴다(표는 CSS가 블록 하나로 칠한다)", () => {
    const r = ranges("| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n");
    expect(r).toEqual([]);
  });
});

describe("받침 범위 — 일반 텍스트(CodeMirror)", () => {
  /** `view.state.doc`의 `lineAt`만 쓰므로 줄 목록으로 가짜를 만든다. */
  function fakeDoc(lines: string[]) {
    return {
      length: lines.join("\n").length,
      lineAt(pos: number) {
        let at = 0;
        for (const line of lines) {
          if (pos <= at + line.length) return { from: at, to: at + line.length };
          at += line.length + 1;
        }
        const last = lines[lines.length - 1] ?? "";
        return { from: at - last.length - 1, to: at - 1 };
      },
    };
  }

  it("보이는 범위의 줄마다 글자 전체를 덮는다", () => {
    const doc = fakeDoc(["가나다", "라마"]);
    expect(plainBackingRanges(doc, [{ from: 0, to: doc.length }])).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 6 },
    ]);
  });

  it("빈 줄은 덮지 않는다", () => {
    const doc = fakeDoc(["가", "", "나"]);
    expect(plainBackingRanges(doc, [{ from: 0, to: doc.length }])).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 4 },
    ]);
  });

  it("보이지 않는 줄은 건드리지 않는다(화면에 그려진 만큼만)", () => {
    const doc = fakeDoc(["하나", "둘", "셋"]);
    expect(plainBackingRanges(doc, [{ from: 3, to: 4 }])).toEqual([{ from: 3, to: 4 }]);
  });
});
