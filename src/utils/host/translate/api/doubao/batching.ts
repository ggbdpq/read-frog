import { DOUBAO_BATCH_MAX_CHARS, DOUBAO_BATCH_MAX_ITEMS } from "@/utils/constants/doubao"
import { logger } from "@/utils/logger"
import { DoubaoApiError } from "./errors"

/**
 * 一批交给 `stream_article_translate` 的原文，用**下标区间**表示而不是拷贝数组：
 * 响应里的 `items[].index` 是批内下标，有了 `start` 就能直接换算回调用方的下标。
 */
export interface DoubaoBatch {
  /** 在原始 `texts` 数组里的起始下标。 */
  start: number
  /** 这一批的原文（`texts.slice(start, end)`）。 */
  texts: string[]
}

/**
 * 按接口上限切批：单批 ≤ 10000 字符 **且** ≤ 50 段（网页版 `K()` 的策略）。
 *
 * 10000 字符不是防报错而是防**输出劣化**：实测单段 50000 字符服务端仍返回 `code 0`，
 * 但 10001 字符起输出会被截断（10001 字符只回 9981 字符）。所以这条线必须留着。
 *
 * 50 段也比服务端上限保守：实测 100 段成功、101 段起 `710020202`。留 2 倍余量。
 *
 * 「逐段累加，超限即切」与 Python 参考实现逐行对齐。唯一的边界差异在**单段本身就
 * 超限**时：Python 的写法（`if chunk and chars + nxt > MAX: break`）会照发不误，
 * 这里同样把这一段单独成批 —— 宁可让服务端截断这一段，也不能在分批循环里原地打转，
 * 更不能静默丢掉段落。
 *
 * 超长单段会同时走 `710020702` 那条路的风险并不存在：截断是内容层现象，服务端不报错，
 * 所以这里只留一条 warn 级的可诊断日志。
 */
export function splitDoubaoBatches(texts: readonly string[]): DoubaoBatch[] {
  const batches: DoubaoBatch[] = []
  let start = 0

  while (start < texts.length) {
    const textsInBatch: string[] = []
    let characters = 0

    while (
      start + textsInBatch.length < texts.length &&
      textsInBatch.length < DOUBAO_BATCH_MAX_ITEMS
    ) {
      const next = texts[start + textsInBatch.length]!
      if (textsInBatch.length > 0 && characters + next.length > DOUBAO_BATCH_MAX_CHARS) {
        break
      }
      textsInBatch.push(next)
      characters += next.length
    }

    // 内层循环必然推进：`start < texts.length` 保证至少能看一段，而「空批」会把
    // `textsInBatch.length > 0` 短路掉，于是超长的那一段无论如何都会被收下。
    // 因此 `start` 每轮严格增大，不存在死循环，也不需要兜底的 push。
    assertProgress(texts, start, textsInBatch)

    if (textsInBatch.length === 1 && textsInBatch[0]!.length > DOUBAO_BATCH_MAX_CHARS) {
      logger.warn(
        `[Doubao] 单段 ${textsInBatch[0]!.length} 字符超过 ${DOUBAO_BATCH_MAX_CHARS} 字符分批上限，该段译文可能被服务端截断`,
      )
    }

    batches.push({ start, texts: textsInBatch })
    start += textsInBatch.length
  }

  return batches
}

/** 防御性断言：分批是纯计算，任何「空批」都意味着循环不变量被破坏。 */
function assertProgress(
  texts: readonly string[],
  start: number,
  textsInBatch: readonly string[],
): void {
  if (textsInBatch.length === 0) {
    throw new DoubaoApiError(
      `豆包分批失败：下标 ${start} 处切出了空批（共 ${texts.length} 段）。这是分批逻辑的 bug，请报告。`,
      { rawText: texts.slice(start, start + 1) },
    )
  }
}

/** 分批常量对外再导出一份，便于调用方/测试断言上限没有被悄悄改掉。 */
export const DOUBAO_BATCH_LIMITS = {
  characters: DOUBAO_BATCH_MAX_CHARS,
  items: DOUBAO_BATCH_MAX_ITEMS,
} as const
