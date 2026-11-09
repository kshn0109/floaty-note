import { defineConfig } from "vitest/config";

/**
 * 단위 시험 설정 — `scripts/*.test.ts`만 돌린다. UI 자동 테스트(스크린샷·픽셀 비교·
 * 시안 렌더링)는 하지 않는다(사용자 규칙).
 *
 * 기본 환경은 `node`다: 시험 대상 대부분이 `src/lib/md`·`src/lib/editor`의 순수 모듈이고
 * 5MB 왕복 시험을 DOM 없이 돌리는 쪽이 훨씬 빠르다. **키 입력 경로**만은 편집기 DOM이
 * 있어야 확인할 수 있으므로(`scripts/keys.test.ts`) 그 파일만 `happy-dom`을 쓴다 —
 * 파일 맨 위의 `// @vitest-environment happy-dom` 주석으로 고른다.
 *
 * `vite.config.ts`를 쓰지 않는 이유: 그쪽은 React·Tailwind 플러그인이 달려 있어
 * 시험에 필요 없는 변환을 걸고, 앱 빌드 설정과 시험 설정이 서로를 끌고 다니게 된다.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
});
