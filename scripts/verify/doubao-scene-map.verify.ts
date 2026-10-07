import type { HostedAiTextStreamRoute } from "@/types/background-stream"
/**
 * 功能 → 场景号（scene）表驱动验证 + 请求体类型核对。
 *
 * 起因：lead 要求「未设置节点翻译上下文时，整页翻译下发的 scene 必须仍是 1」，
 * 防止悬停翻译（scene=6）的改动把整页翻译带偏。
 *
 * `resolveDoubaoScene(feature, override?)` 是纯函数，直接表驱动断言比抓包更可靠、
 * 更容易复现；再叠一层 mock，断言最终**请求体里的 `scene` 确实是 number**。
 */
import { describe, expect, it } from "vitest"
import { DOUBAO_DEFAULT_SCENE, DOUBAO_SCENES } from "@/utils/constants/doubao"
import { doubaoTranslate } from "@/utils/host/translate/api/doubao/client"
import { resolveDoubaoScene } from "@/utils/host/translate/api/doubao/scene"
import {
  getNodeTranslationScene,
  runWithNodeTranslationScene,
  setNodeTranslationScene,
} from "@/utils/host/translate/node-translation-scene"
import { startMockDoubao } from "./mock-doubao-server.mjs"

/** 期望映射：整页 1 / 划词 3 / 输入翻译 2 / 视频字幕 2 / 悬停 6（由 override 给） */
const TABLE: Array<{ route: HostedAiTextStreamRoute; expected: number; note: string }> = [
  { route: "pageTranslation", expected: 1, note: "整页翻译" },
  { route: "selectionTranslation", expected: 3, note: "划词翻译" },
  { route: "inputTranslation", expected: 2, note: "输入框翻译" },
  { route: "videoSubtitles", expected: 2, note: "视频字幕（走 AI 阅读器）" },
  { route: "videoSubtitlesSegmentation", expected: 2, note: "字幕分段（走 AI 阅读器）" },
  { route: "languageDetection", expected: 2, note: "语种识别（走输入翻译）" },
]

describe("I. 功能 → scene 表驱动 + 请求体类型", () => {
  it("I1 每条路由推导出的 scene 与契约一致", () => {
    const actual = TABLE.map(({ route, expected, note }) => {
      const scene = resolveDoubaoScene(route)
      return { route, note, expected, scene }
    })
    const wrong = actual.filter((r) => r.scene !== r.expected)
    expect(wrong, `与期望不符: ${JSON.stringify(wrong)}`).toEqual([])
  })

  it("I2 显式 override 优先：悬停传 6 时必须是 6，且不污染整页翻译", () => {
    // 悬停翻译跑在划词通道上，靠 override 拿到 6
    expect(resolveDoubaoScene("selectionTranslation", DOUBAO_SCENES.hover)).toBe(6)
    // 关键防回归：不给 override 时，整页翻译仍然是 1
    expect(resolveDoubaoScene("pageTranslation")).toBe(1)
    expect(resolveDoubaoScene("pageTranslation", undefined)).toBe(1)
  })

  it("I3 非法 override 退回推导值，不抛错（设计取舍：场景号只影响统计）", () => {
    expect(resolveDoubaoScene("pageTranslation", 99)).toBe(1)
    expect(resolveDoubaoScene("pageTranslation", 0)).toBe(1)
    expect(resolveDoubaoScene("pageTranslation", Number.NaN)).toBe(1)
    expect(resolveDoubaoScene("pageTranslation", 1.5)).toBe(1)
    // 字符串 "2" 也要被挡住（typeof 检查），退回推导值而不是发出去
    expect(resolveDoubaoScene("pageTranslation", "2" as unknown as number)).toBe(1)
    expect(resolveDoubaoScene("selectionTranslation", "6" as unknown as number)).toBe(3)
  })

  it("I4 默认场景常量是 2（AI 阅读器），且属于合法枚举", () => {
    expect(DOUBAO_DEFAULT_SCENE).toBe(2)
    expect(Object.values(DOUBAO_SCENES)).toContain(DOUBAO_DEFAULT_SCENE)
  })

  it("I5 六个场景号最终都以 **number** 进入请求体（逐场景 mock 核对）", async () => {
    const mock = await startMockDoubao()
    const restore = mock.installFetchRewrite()
    try {
      for (const scene of [1, 2, 3, 4, 5, 6]) {
        mock.reset("ok")
        await doubaoTranslate("hello", "zh", { engine: "0", scene })
        expect(mock.requests).toHaveLength(1)
        const body = mock.requests[0]!.body
        expect(typeof body.scene, `scene=${scene} 下发类型不对`).toBe("number")
        expect(body.scene).toBe(scene)
        expect(typeof body.translate_service).toBe("string")
      }
    } finally {
      restore()
      await mock.stop()
    }
  })

  it("I6 默认（不传 scene）时下发 2，且仍是 number", async () => {
    const mock = await startMockDoubao()
    const restore = mock.installFetchRewrite()
    try {
      await doubaoTranslate("hello", "zh", { engine: "0" })
      expect(mock.requests[0]!.body.scene).toBe(DOUBAO_DEFAULT_SCENE)
      expect(typeof mock.requests[0]!.body.scene).toBe("number")
    } finally {
      restore()
      await mock.stop()
    }
  })
})

describe("K. 节点/悬停场景上下文（node-translation-scene）语义与防回归", () => {
  it("K1 窗口内可见、窗口外恢复为 undefined", async () => {
    expect(getNodeTranslationScene()).toBeUndefined()
    const inside = await runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      return getNodeTranslationScene()
    })
    expect(inside).toBe(6)
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("K2 嵌套调用恢复的是**外层值**，不会把外层场景清掉", async () => {
    await runWithNodeTranslationScene(1, async () => {
      expect(getNodeTranslationScene()).toBe(1)
      await runWithNodeTranslationScene(6, async () => {
        expect(getNodeTranslationScene()).toBe(6)
      })
      expect(getNodeTranslationScene()).toBe(1)
    })
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("K3 异常路径也必须恢复（否则整页翻译会一直带着悬停场景）", async () => {
    await expect(
      runWithNodeTranslationScene(6, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(getNodeTranslationScene()).toBeUndefined()

    // 嵌套 + 内层抛错：外层场景号不能被清掉
    await runWithNodeTranslationScene(1, async () => {
      await expect(
        runWithNodeTranslationScene(6, async () => {
          throw new Error("inner")
        }),
      ).rejects.toThrow("inner")
      expect(getNodeTranslationScene()).toBe(1)
    })
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("K4【防回归】未设置节点上下文时，整页翻译仍推导为 1", () => {
    // 悬停改动落地后，这条必须仍然成立
    expect(getNodeTranslationScene()).toBeUndefined()
    expect(resolveDoubaoScene("pageTranslation")).toBe(1)
  })

  it("K5【刻画已声明的竞态】节点上下文是模块级的：飞行中设置会影响到并发的整页推导", async () => {
    // 作者在 node-translation-scene.ts 顶部明确记录了这条有界竞态。
    // 这里把它**变成可执行证据**：证明竞态在机制上真实存在，
    // 同时证明它的影响面仅限"标签"（scene 1-6 服务端都返回 code:0，见 phase1_adversarial §D）。
    let pageSceneDuringHoverWalk: number | undefined

    await runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      // 模拟"整页翻译的 walk 恰好在悬停窗口内读取场景"
      pageSceneDuringHoverWalk = getNodeTranslationScene()
    })

    expect(pageSceneDuringHoverWalk).toBe(6) // 竞态确实存在：此时整页会被标成 6
    expect(getNodeTranslationScene()).toBeUndefined() // 但窗口结束即恢复
    // 关键：窗口外整页仍是 1 —— 日常路径不受影响
    expect(resolveDoubaoScene("pageTranslation")).toBe(1)
  })

  it("K6 setNodeTranslationScene 的直调也能被后续 runWith 正确恢复", async () => {
    setNodeTranslationScene(3)
    expect(getNodeTranslationScene()).toBe(3)
    await runWithNodeTranslationScene(6, async () => {
      expect(getNodeTranslationScene()).toBe(6)
    })
    expect(getNodeTranslationScene()).toBe(3)
    setNodeTranslationScene(undefined)
    expect(getNodeTranslationScene()).toBeUndefined()
  })
})
