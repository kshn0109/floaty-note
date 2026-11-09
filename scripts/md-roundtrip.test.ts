/**
 * 마크다운 왕복 시험 — spike `docs/editor-spike/roundtrip.mjs`를 vitest로 옮긴 것.
 *
 * 세 경로를 센다.
 *   스키마 무손실: blocks → ProseMirror 문서 → blocks
 *   A) 항상 재직렬화 = 원본(`main.cpp`)과 같은 방식
 *   B) 원문 보존 = 이 앱이 쓰는 방식 (설계 문서 §4-3)
 *
 * 숫자(50/50, 74/74, 4000/4000)는 설계 문서 §2의 측정값이고 **회귀 기준**이다.
 */

import { describe, expect, it } from "vitest";

import { blocksToDoc, docToBlocks } from "../src/lib/md/pmdoc";
import { loadMarkdown, parseMarkdown } from "../src/lib/md/parse";
import { serializeMarkdown, serializeWithSource } from "../src/lib/md/serialize";
import {
  blockListsEqual,
  INKWELL_OPTS,
  ORIGINAL_OPTS,
  type Block,
  type MdOptions,
  type Run,
} from "../src/lib/md/types";

const S = (name: string, md: string) => ({ name, md });

/** USAGE §5의 예외 예시 전부 + 미지원 문법 + 위험한 글자들 + 긴 실전 문서. */
export const samples = [
  S("빈 파일", ""),
  S('"\\n" 한 줄만', "\n"),
  S('"\\n\\n"', "\n\n"),
  S("제목만", "# 제목\n"),
  S("제목 + 빈 줄 + 본문", "# 제목\n\n본문\n"),
  S("제목 + 바로 본문(원본이 정규화)", "# 제목\n본문\n"),
  S("H1~H6", "# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6\n"),
  S("닫는 # 있는 제목", "## 제목 ##\n"),
  S("제목 아님(#뒤 공백 없음)", "#NoSpace\n"),
  S("제목 아님(# 7개)", "####### seven\n"),
  S("굵게/기울임/취소선", "**굵게** 보통 *기울임* ~~취소~~\n"),
  S("__굵게__(원본이 정규화)", "__굵게__\n"),
  S("_기울임_(원본이 정규화)", "_기울임_\n"),
  S("***굵게기울임***", "***둘다***\n"),
  S("형광펜 기본색 ==", "==형광==\n"),
  S("형광펜 mark 태그", '<mark style="background:#FF8AD8">분홍</mark>\n'),
  S("형광펜 + 굵게", '<mark style="background:#7FDBFF">**파랑굵게**</mark>\n'),
  S("표 기본", "| a | b |\n| --- | --- |\n| 1 | 2 |\n"),
  S("표 정렬", "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n"),
  S("표 정렬(:--- 은 원본이 --- 로)", "| a |\n| :--- |\n| 1 |\n"),
  S("표 공백 없음(원본이 정규화)", "|a|b|\n|---|---|\n|1|2|\n"),
  S("표 + 앞뒤 문단", "앞 문단\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n뒤 문단\n"),
  S("표 안 형광/굵게", "| **굵** | ==형광== |\n| --- | --- |\n| 1 | 2 |\n"),
  S("목록(미지원 문법)", "- 하나\n- 둘\n- 셋\n"),
  S("번호 목록", "1. 하나\n2. 둘\n"),
  S("체크박스", "- [ ] 할 일\n- [x] 끝난 일\n"),
  S("코드 펜스", "```js\nconst a = 1;\n```\n"),
  S("인용", "> 인용문\n> 둘째 줄\n"),
  S("링크/이미지", "[링크](https://example.com) 와 ![그림](a.png)\n"),
  S("HTML 블록", '<div class="x">내용</div>\n'),
  S("각주", "[^1]: 각주 본문\n"),
  S("수평선", "---\n"),
  S("이스케이프들", "\\* \\_ \\# \\| \\\\ \\~\n"),
  S("윈도 경로(백슬래시)", "C:\\Users\\ksch3\\notes\\a.md\n"),
  S("literal == 쌍", "a == b 입니다\n"),
  S("==== 네 개", "====\n"),
  S("<marked> 는 mark 아님", "<marked>x</marked>\n"),
  S("곱셈 2 * 3", "2 * 3 = 6 이다\n"),
  S("snake_case", "snake_case_name 변수\n"),
  S("한글_밑줄_사이", "한글_밑줄_사이\n"),
  S("파이프만 있는 줄", "Ln | Col | 글자\n"),
  S("소프트 줄바꿈 단락", "줄1\n줄2\n줄3\n"),
  S("빈 줄 여러 개", "A\n\n\n\nB\n"),
  S("앞뒤 빈 줄", "\n\nA\n\n\n"),
  S("끝 newline 없음", "abc"),
  S("들여쓴 줄", "  두 칸 들여씀\n"),
  S("탭 들여쓰기", "\t탭 들여씀\n"),
  S("줄 끝 공백", "끝에 공백 둘  \n"),
  S("이모지/서로게이트", "메모 🙂 끝\n"),
  S(
    "긴 실전 문서",
    [
      "# 주간 메모",
      "",
      "## 월요일",
      "",
      "- 화요일 3시 디자인 리뷰",
      "- 컨셉 F 통합안 확인",
      "",
      "진행 상황은 **중요**하고 ==이건 형광==.",
      "",
      "| 항목 | 상태 | 비고 |",
      "| :--- | :---: | ---: |",
      "| 편집기 | 진행 | PM |",
      "| 왕복 | 확인 | 48/48 |",
      "",
      "```sh",
      "npm run tauri dev",
      "```",
      "",
      "> 인용: 왕복은 바이트 단위로.",
      "",
      "끝.",
      "",
    ].join("\n")
  ),
];

function run(md: string, opts: MdOptions) {
  const base = loadMarkdown(md, opts);
  const back = docToBlocks(blocksToDoc(base.blocks));
  return { base, back };
}

describe("샘플 50개 왕복", () => {
  it("샘플이 50개다", () => {
    expect(samples.length).toBe(50);
  });

  for (const opts of [INKWELL_OPTS, ORIGINAL_OPTS]) {
    const label = opts === INKWELL_OPTS ? "이 앱 규칙" : "원본 규칙";

    it(`스키마 무손실 50/50 (${label})`, () => {
      const bad: string[] = [];
      for (const s of samples) {
        const r = run(s.md, opts);
        if (!blockListsEqual(r.base.blocks, r.back)) bad.push(s.name);
      }
      expect(bad).toEqual([]);
    });

    it(`B) 원문 보존 — 바이트 동일 50/50 (${label})`, () => {
      const bad: string[] = [];
      for (const s of samples) {
        const r = run(s.md, opts);
        if (serializeWithSource(r.back, r.base, opts) !== s.md) bad.push(s.name);
      }
      expect(bad).toEqual([]);
    });
  }

  // A 경로는 "원본과 같은 방식"이라 바이트를 바꾸는 샘플이 있다. 그 개수가 곧
  // 원본의 숨은 정규화 목록이고, 사용자 결정 2(버그 2건 고침)로 34 → 36이 된다.
  it("A) 항상 재직렬화 — 원본 규칙 34/50, 이 앱 규칙 36/50", () => {
    const count = (opts: MdOptions) =>
      samples.filter((s) => {
        const r = run(s.md, opts);
        return serializeMarkdown(r.back, opts) === s.md;
      }).length;
    expect(count(ORIGINAL_OPTS)).toBe(34);
    expect(count(INKWELL_OPTS)).toBe(36);
  });

  it("고친 두 규칙이 실제로 백슬래시·한글 밑줄을 지킨다", () => {
    const paths = ["C:\\Users\\ksch3\\notes\\a.md\n", "한글_밑줄_사이\n"];
    for (const md of paths) {
      const r = run(md, INKWELL_OPTS);
      expect(serializeMarkdown(r.back, INKWELL_OPTS)).toBe(md);
      expect(serializeMarkdown(r.back, ORIGINAL_OPTS)).not.toBe(md);
    }
  });
});

const text = (t: string): Run[][] => [[{ text: t, em: 0, hl: null }]];
const clone = (blocks: readonly Block[]): Block[] =>
  blocks.map((b) => JSON.parse(JSON.stringify(b)) as Block);

describe("한 블록만 고쳐 저장 → 다시 열기 (전수)", () => {
  it("74가지 모두 의도한 문서와 같고, 앞쪽 원문 줄이 남는다", () => {
    let total = 0;
    let kept = 0;
    let keptTotal = 0;
    const bad: string[] = [];
    for (const s of samples) {
      const base = loadMarkdown(s.md);
      for (let i = 0; i < base.blocks.length; i += 1) {
        total += 1;
        const want = clone(base.blocks);
        const b = want[i];
        if (b.kind === "empty") want[i] = { kind: "para", lines: text("새 줄") };
        else if (b.kind === "table") b.rows[0][0] = [{ text: "머리", em: 1, hl: null }];
        else if (b.kind === "list") b.items[0].runs = [{ text: "고친 항목 ZZ", em: 0, hl: null }];
        else b.lines[0] = [{ text: "고친 줄 ZZ", em: 0, hl: null }];
        const md2 = serializeWithSource(want, base);
        if (!blockListsEqual(parseMarkdown(md2).blocks, want)) bad.push(`${s.name} #${i}`);
        const ls = base.lineStart[i];
        if (ls > 1) {
          keptTotal += 1;
          if (md2.startsWith(base.lines.slice(0, ls - 1).join("\n"))) kept += 1;
        }
      }
    }
    expect(total).toBe(74);
    expect(bad).toEqual([]);
    expect(kept).toBe(keptTotal);
    expect(keptTotal).toBe(20);
  });
});

describe("무작위 편집 퍼즈", () => {
  it("4000회 모두 저장 → 다시 열기가 의도한 문서와 같다", () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const mkPara = (t: string): Block => ({ kind: "para", lines: text(t) });
    let ok = 0;
    const bad: string[] = [];
    for (let iter = 0; iter < 4000; iter += 1) {
      const s = samples[rnd(samples.length)];
      const base = loadMarkdown(s.md);
      const want = clone(base.blocks);
      const nOps = 1 + rnd(3);
      for (let o = 0; o < nOps; o += 1) {
        const i = rnd(want.length + 1);
        const op = rnd(4);
        if (op === 0) want.splice(i, 0, mkPara(`삽입${o}`));
        else if (op === 1) want.splice(i, 0, { kind: "empty" });
        else if (op === 2 && want.length > 1) want.splice(Math.min(i, want.length - 1), 1);
        else if (want.length) {
          const j = Math.min(i, want.length - 1);
          want[j] = want[j].kind === "empty" ? mkPara(`바뀜${o}`) : { kind: "empty" };
        }
      }
      if (want.length === 0) want.push({ kind: "empty" });
      const md2 = serializeWithSource(want, base);
      if (blockListsEqual(parseMarkdown(md2).blocks, want)) ok += 1;
      else if (bad.length < 6) bad.push(`${s.name} → ${JSON.stringify(md2)}`);
    }
    expect(bad).toEqual([]);
    expect(ok).toBe(4000);
  });
});

describe("편집 후 저장: 손대지 않은 부분의 바이트 보존", () => {
  const doc0 = samples[samples.length - 1].md;

  it("마지막 단락만 고치면 그 앞은 원문 그대로이고 코드펜스·인용·`:---`가 산다", () => {
    const base = loadMarkdown(doc0);
    const blocks = clone(base.blocks);
    const last = blocks.map((b, i) => [b, i] as const).filter(([b]) => b.kind === "para").pop();
    expect(last).toBeDefined();
    blocks[last![1]] = { kind: "para", lines: text("끝. 한 글자 더.") };
    const out = serializeWithSource(blocks, base);
    expect(out.startsWith(doc0.slice(0, doc0.indexOf("끝.")))).toBe(true);
    expect(out).toContain("```sh");
    expect(out).toContain("> 인용");
    expect(out).toContain(":---:");
  });

  it("표 한 칸만 고쳐도 코드펜스·인용·앞쪽 목록이 그대로다", () => {
    const base = loadMarkdown(doc0);
    const blocks = clone(base.blocks);
    const ti = blocks.findIndex((b) => b.kind === "table");
    const table = blocks[ti];
    expect(table.kind).toBe("table");
    if (table.kind === "table") table.rows[1][2] = [{ text: "PM 확정", em: 1, hl: null }];
    const out = serializeWithSource(blocks, base);
    expect(out).toContain("```sh");
    expect(out).toContain("> 인용");
    expect(out).toContain("- 화요일 3시 디자인 리뷰");
    expect(out).toContain("PM 확정");
  });
});

describe("성능 (Node, DOM 없음)", () => {
  function bigMd(targetBytes: number): string {
    const unit =
      [
        "## 섹션",
        "",
        "본문 한 줄과 **굵게** 그리고 ==형광==. 보통 글자가 조금 더 붙습니다.",
        "둘째 줄은 소프트 줄바꿈으로 이어집니다.",
        "",
        "- 목록 한 줄",
        "- 목록 두 줄",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
      ].join("\n") + "\n";
    let s = "";
    while (s.length < targetBytes) s += unit;
    return s;
  }

  for (const mb of [1, 5]) {
    it(
      `${mb}MB 마크다운: 열고 저장해도 바이트가 같다`,
      () => {
        const md = bigMd(mb * 1024 * 1024);
        let t = performance.now();
        const base = loadMarkdown(md);
        const tParse = performance.now() - t;
        t = performance.now();
        const doc = blocksToDoc(base.blocks);
        const tDoc = performance.now() - t;
        t = performance.now();
        const back = docToBlocks(doc);
        const tBack = performance.now() - t;
        t = performance.now();
        const out = serializeWithSource(back, base);
        const tSer = performance.now() - t;
        expect(out).toBe(md);
        // 수치는 측정값으로만 남긴다 — 기계 속도에 따라 달라지므로 단정하지 않는다.
        console.log(
          `  ${mb}MB: 블록 ${base.blocks.length}개 / 파서 ${tParse.toFixed(0)}ms / ` +
            `PM문서 ${tDoc.toFixed(0)}ms / 문서→블록 ${tBack.toFixed(0)}ms / 저장 ${tSer.toFixed(0)}ms`
        );
      },
      120_000
    );
  }
});
