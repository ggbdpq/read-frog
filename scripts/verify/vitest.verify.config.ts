import { fileURLToPath } from "node:url"
/**
 * 独立验证用的 vitest 配置 —— **故意不复用仓库的 vitest.config.ts**。
 *
 * 原因：本目录下的对抗性契约测试属于「验证者自己写的证据」，不应该混进交付物的
 * `pnpm test` 门禁（那是给实现者的单测用的）。这里用独立 include 模式，跑法：
 *
 *     cd read-frog
 *     pnpm exec vitest run --config scripts/verify/vitest.verify.config.ts
 *
 * root 显式指回仓库根，保证 `@/` 别名与 WxtVitest 生成的 #imports 解析正常。
 */
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { WxtVitest } from "wxt/testing/vitest-plugin"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

export default defineConfig({
  root: repoRoot,
  plugins: [WxtVitest() as any, react()],
  test: {
    root: repoRoot,
    include: ["scripts/verify/**/*.verify.ts"],
    environment: "node",
    globals: true,
    setupFiles: ["vitest.setup.ts", "scripts/verify/verify.setup.ts"],
    watch: false,
    // 对抗测试要打真实本机 HTTP mock，给足时间；并发跑避免端口互踩
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
