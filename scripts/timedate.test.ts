/**
 * F5 = 시간/날짜 넣기 (사용자 지시 — Windows 11 메모장의 `편집 › 시간/날짜`).
 *
 * 여기서 보는 것은 **키 판정**과 **넣기**다. 글자 자체(`오후 11:30 2026-11-09`)는
 * Windows가 그 컴퓨터의 로캘 설정으로 만들어 주므로(`syscmd::time_date_stamp`)
 * 값을 박아 둘 수 없다 — 모양만 본다. 실제 글자는 사용자가 확인한다.
 */

import { describe, expect, it } from "vitest";

import { MarkdownHost } from "../src/lib/editor/MarkdownHost";
import { PlainHost } from "../src/lib/editor/PlainHost";
import { fallbackStamp, isReloadKey, isTimeDateKey } from "../src/lib/timestamp";

function chord(code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, ...mods };
}

describe("키 판정", () => {
  it("맨 F5만 시간/날짜다", () => {
    expect(isTimeDateKey(chord("F5"))).toBe(true);
    expect(isTimeDateKey(chord("F5", { ctrlKey: true }))).toBe(false);
    expect(isTimeDateKey(chord("F5", { shiftKey: true }))).toBe(false);
    expect(isTimeDateKey(chord("F5", { altKey: true }))).toBe(false);
  });

  it("다른 기능키는 건드리지 않는다(F3·Shift+F3·F10)", () => {
    for (const c of [chord("F3"), chord("F3", { shiftKey: true }), chord("F10")]) {
      expect(isTimeDateKey(c)).toBe(false);
      expect(isReloadKey(c)).toBe(false);
    }
  });

  it("새로 고침 키는 전부 막는다 — F5 계열과 Ctrl+R 계열", () => {
    expect(isReloadKey(chord("F5"))).toBe(true);
    expect(isReloadKey(chord("F5", { ctrlKey: true }))).toBe(true);
    expect(isReloadKey(chord("F5", { shiftKey: true }))).toBe(true);
    expect(isReloadKey(chord("KeyR", { ctrlKey: true }))).toBe(true);
    expect(isReloadKey(chord("KeyR", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("그냥 R이나 Alt가 낀 조합은 새로 고침이 아니다", () => {
    expect(isReloadKey(chord("KeyR"))).toBe(false);
    expect(isReloadKey(chord("KeyR", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isReloadKey(chord("F5", { altKey: true }))).toBe(false);
  });
});

describe("대체 글자(Windows가 못 알려 줄 때)", () => {
  it("시간 + 공백 + 날짜 한 줄이다", () => {
    const s = fallbackStamp(new Date(2026, 10, 9, 23, 30));
    expect(s).toContain(" ");
    expect(/\d/.test(s)).toBe(true);
    expect(s.trim()).toBe(s);
    // 두 토막이 모두 비어 있지 않다.
    const cut = s.lastIndexOf(" ");
    expect(s.slice(0, cut).trim().length).toBeGreaterThan(0);
    expect(s.slice(cut + 1).trim().length).toBeGreaterThan(0);
  });

  it("초는 넣지 않는다(메모장과 같다)", () => {
    const s = fallbackStamp(new Date(2026, 10, 9, 23, 30, 45));
    expect(s).not.toContain("45");
  });
});

const STAMP = "오후 11:30 2026-11-09";

describe("넣기 — 두 모드 모두", () => {
  it("마크다운: 커서 자리에 들어가고 실행 취소 한 번이면 지워진다", () => {
    const h = new MarkdownHost("앞\n");
    expect(h.exec({ t: "selectAll" })).toBe(true);
    expect(h.exec({ t: "insertText", text: STAMP })).toBe(true);
    expect(h.save()).toBe(`${STAMP}\n`);
    h.undo();
    expect(h.save()).toBe("앞\n");
  });

  it("마크다운: 선택이 있으면 그 자리를 덮는다", () => {
    const h = new MarkdownHost("지울 글\n");
    // 문서 자리 1~4 = "지울 "(뒤의 공백까지).
    h.select(1, 4);
    h.exec({ t: "insertText", text: STAMP });
    expect(h.save()).toBe(`${STAMP}글\n`);
  });

  it("일반 텍스트: 커서 자리에 들어가고 실행 취소로 돌아간다", () => {
    const p = new PlainHost("가나다\n");
    p.select(1, 2);
    expect(p.exec({ t: "insertText", text: STAMP })).toBe(true);
    expect(p.save()).toBe(`가${STAMP}다\n`);
    p.undo();
    expect(p.save()).toBe("가나다\n");
  });

  it("빈 글자는 넣지 않는다(문서가 수정 상태가 되면 안 된다)", () => {
    const h = new MarkdownHost("앞\n");
    expect(h.exec({ t: "insertText", text: "" })).toBe(false);
    const p = new PlainHost("앞\n");
    expect(p.exec({ t: "insertText", text: "" })).toBe(false);
  });
});
