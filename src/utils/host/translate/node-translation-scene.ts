/**
 * 悬停 / 节点翻译的豆包场景号（`scene`）上下文。
 *
 * ## 为什么是模块级变量
 *
 * 与 `translation-session.ts` 同源的理由：**每一帧只有一个节点翻译入口**
 * （`removeOrShowNodeTranslation`），而且它会 await 完整个 walk 才返回。所以「当前正在
 * 跑的节点翻译是什么场景」这件事，天然是「本帧一次」的状态，不需要穿透
 * `translateWalkedElement` → `translateNodes` → `translateNodesBilingualMode` /
 * `translateNodeTranslationOnlyMode` → … 这十几个位置参数一路转发 —— 那条链路是被
 * `translate.integration.test.tsx`（4000+ 断言）压着的最热路径，为了一标签做签名手术
 * 不划算。
 *
 * ## 已知取舍（如实记录，不掩盖）
 *
 * 模块级上下文有一个**有界竞态**：如果整页翻译正在飞行，而用户此时触发热键做悬停
 * 翻译，那么在这个 walk 窗口内到达的**整页段落**会被标成悬停场景（6）而不是整页（1）。
 *
 * 接受它的依据是**实测**：`scene` 1–6 全部返回 `code:0` 且译文正确，未观察到任何
 * scene 相关的行为差异。所以这个错标在可观测行为上是零影响的，纯粹是「发给服务端的
 * 场景标签」语义问题。要彻底消除它就需要把 scene 穿透十几个位置参数 —— 那笔交易的
 * 风险（动最热路径）明显大于收益（一个没有可观测效果的标签）。
 */

let currentNodeTranslationScene: number | undefined

/** 当前节点/悬停翻译的豆包场景号；未在节点翻译中时为 `undefined`。 */
export function getNodeTranslationScene(): number | undefined {
  return currentNodeTranslationScene
}

export function setNodeTranslationScene(scene: number | undefined): void {
  currentNodeTranslationScene = scene
}

/**
 * 包住一次节点翻译 walk：窗口内 `getNodeTranslationScene()` 返回传入的场景号。
 *
 * 用 `try/finally` 恢复**上一个值**而不是直接清空，所以嵌套调用不会互相破坏
 * （外层结束后仍是外层的场景号）。异常路径同样恢复 —— 节点翻译抛错不该让后续
 * 整页翻译一直带着悬停场景。
 */
export async function runWithNodeTranslationScene<T>(
  scene: number,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = currentNodeTranslationScene
  currentNodeTranslationScene = scene
  try {
    return await fn()
  } finally {
    currentNodeTranslationScene = previous
  }
}
