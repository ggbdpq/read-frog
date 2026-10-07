import { afterEach, describe, expect, it } from "vitest"
import { DOUBAO_SCENES } from "@/utils/constants/doubao"
import { resolveDoubaoScene } from "../api/doubao"
import {
  getNodeTranslationScene,
  runWithNodeTranslationScene,
  setNodeTranslationScene,
} from "../node-translation-scene"

describe("node translation scene context", () => {
  afterEach(() => {
    setNodeTranslationScene(undefined)
  })

  it("reports no scene outside a node-translation walk", () => {
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("exposes the hover scene for the duration of the walk", async () => {
    let inside: number | undefined
    await runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      inside = getNodeTranslationScene()
    })

    expect(inside).toBe(DOUBAO_SCENES.hover)
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("restores the previous value instead of clearing it (nesting)", async () => {
    const seen: Array<number | undefined> = []

    await runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      seen.push(getNodeTranslationScene())
      await runWithNodeTranslationScene(DOUBAO_SCENES.screenshot, async () => {
        seen.push(getNodeTranslationScene())
      })
      // 内层结束后必须回到外层的值，而不是被清空。
      seen.push(getNodeTranslationScene())
    })

    expect(seen).toEqual([DOUBAO_SCENES.hover, DOUBAO_SCENES.screenshot, DOUBAO_SCENES.hover])
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("restores the previous value when the walk throws", async () => {
    await expect(
      runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
        throw new Error("walk failed")
      }),
    ).rejects.toThrow("walk failed")

    // 节点翻译抛错不能把后续的整页翻译一直标成悬停场景。
    expect(getNodeTranslationScene()).toBeUndefined()
  })

  it("returns the wrapped value and the same promise result", async () => {
    await expect(runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => "ok")).resolves.toBe(
      "ok",
    )
  })

  it("keeps the walk's scene off a concurrent sibling walk", async () => {
    // 模块级上下文是「本帧一次」的状态：两个 walk 并行时后者会覆盖前者，这是已知的
    // 有界竞态（见 node-translation-scene.ts 文件头）。这里钉住的是**不泄漏** ——
    // 两个 walk 都结束后必须回到 undefined，不能永远留在某个场景号上。
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      await gate
      return "first"
    })
    const second = runWithNodeTranslationScene(DOUBAO_SCENES.chooseWords, async () => "second")

    expect(await second).toBe("second")
    releaseFirst()
    expect(await first).toBe("first")
    expect(getNodeTranslationScene()).toBeUndefined()
  })
})

describe("node translation scene wiring", () => {
  it("leaves page translation on scene 1 when no walk is running", () => {
    // 防回归的关键一条：`translateTextUsingPageConfig` 传的是
    // `options.doubaoScene ?? getNodeTranslationScene()`。这条把「两者都缺席时的最终
    // 结果」钉死 —— 没有节点翻译上下文时，整页翻译仍然推导出 scene 1，本次改动没有
    // 把它带偏。
    expect(getNodeTranslationScene()).toBeUndefined()
    expect(resolveDoubaoScene("pageTranslation")).toBe(DOUBAO_SCENES.page)
    expect(resolveDoubaoScene("pageTranslation")).toBe(1)
  })

  it("sends scene 6 only while a hover walk is in flight", async () => {
    let insideDecision: number | undefined
    await runWithNodeTranslationScene(DOUBAO_SCENES.hover, async () => {
      insideDecision = resolveDoubaoScene("pageTranslation", getNodeTranslationScene())
    })

    expect(insideDecision).toBe(DOUBAO_SCENES.hover)
    // walk 结束后同一个推导立刻回到整页场景。
    expect(resolveDoubaoScene("pageTranslation", getNodeTranslationScene())).toBe(
      DOUBAO_SCENES.page,
    )
  })

  it("keeps the other feature routes mapped as before", () => {
    expect(resolveDoubaoScene("selectionTranslation")).toBe(DOUBAO_SCENES.chooseWords)
    expect(resolveDoubaoScene("inputTranslation")).toBe(DOUBAO_SCENES.aiReader)
    expect(resolveDoubaoScene("videoSubtitles")).toBe(DOUBAO_SCENES.aiReader)
  })
})
