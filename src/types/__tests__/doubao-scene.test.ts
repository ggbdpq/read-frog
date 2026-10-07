import { describe, expect, it } from "vitest"
import { doubaoSceneSchema, optionalDoubaoSceneSchema } from "@/types/doubao"

/**
 * 这道防线的存在理由：`scene` 一旦以字符串形式发出去，豆包服务端一律返回
 * `710010202 系统错误`，而 TypeScript 在 `postMessage` 边界上不设防 ——
 * 一个陈旧的内容脚本、一次手写调试、一段 JSON 反序列化都能把 `"2"` 塞进来。
 */
describe("doubaoSceneSchema", () => {
  it("接受 1–6 的整数", () => {
    for (const scene of [1, 2, 3, 4, 5, 6]) {
      expect(doubaoSceneSchema.safeParse(scene).success).toBe(true)
    }
  })

  it("显式拒绝字符串（这就是 710010202 的来源）", () => {
    for (const bad of ["2", "web", "", "6"]) {
      const result = doubaoSceneSchema.safeParse(bad)
      expect(result.success).toBe(false)
      // 错误文案里必须点名 doubaoScene 与「数字」，否则调用方看不懂服务端的 710010202。
      expect(JSON.stringify(result.error?.issues)).toContain("doubaoScene 必须是数字")
    }
  })

  it("拒绝越界值与非整数", () => {
    for (const bad of [0, 7, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(doubaoSceneSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("拒绝 null / undefined / 对象", () => {
    for (const bad of [null, undefined, {}, []]) {
      expect(doubaoSceneSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("可选包装仍然拒绝字符串 —— 不能因为「可选」就放行", () => {
    expect(optionalDoubaoSceneSchema.safeParse(undefined).success).toBe(true)
    expect(optionalDoubaoSceneSchema.safeParse(3).success).toBe(true)
    expect(optionalDoubaoSceneSchema.safeParse("3").success).toBe(false)
  })
})
