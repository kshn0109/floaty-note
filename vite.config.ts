import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 편집기 두 엔진(ProseMirror + CodeMirror 6)이 들어오면서 한 덩어리가 500kB를 넘는다.
  // 이 경고는 "네트워크로 내려보내는 번들"을 위한 것이고, 우리는 설치된 앱 안의 로컬
  // 파일을 읽는다(코드 쪼개기는 첫 화면을 늦추기만 한다). 그래서 한도만 올린다.
  build: {
    chunkSizeWarningLimit: 1200,
    // 페이지가 셋이다: 창 본체(`index.html`), 떠다니는 고스트 탭(`ghost.html`),
    // 알림 토스트 카드(`toast.html`). 뒤의 둘이 `index.html`을 쓰면 칩/카드 하나를
    // 그리려고 React와 편집기 두 엔진이 한 번 더 올라간다(`src/ghost.ts`의 주석).
    // 토스트는 **창이 하나도 없을 때도** 떠야 해서 자기 창이기도 하다(§7의 트레이 상주).
    // 창을 만드는 쪽은 `src-tauri/src/drag.rs`와 `src-tauri/src/toast.rs`다.
    rollupOptions: {
      input: {
        main: "index.html",
        ghost: "ghost.html",
        toast: "toast.html",
      },
    },
  },

  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
