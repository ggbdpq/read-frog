/**
 * 豆包翻译请求的**线上契约**（消息层）。
 *
 * 这层运行时校验是故意存在的：`scene` 传字符串（例如 `"2"`）会被豆包服务端判为
 * 非法参数，直接返回 `710010202 系统错误`；而 TypeScript 类型在 `postMessage`
 * 边界上不设防 —— 一个陈旧的内容脚本、一次手写调试、一段 JSON 反序列化都能把
 * `"2"` 塞进来。用 `z.number()` 在这里挡掉，比让整页每一句都失败一次便宜得多。
 */

import { z } from "zod"
import { DOUBAO_SCENES } from "@/utils/constants/doubao"

/** `POST .../stream_article_translate` 里 `scene` 字段的合法取值范围：1–6 的整数。 */
export const doubaoSceneSchema = z
  .number({
    error:
      "doubaoScene 必须是数字（1 整页 / 2 AI 阅读器 / 3 划词 / 4 截图 / 5 图片文字 / 6 悬停），不要传字符串",
  })
  .int("doubaoScene 必须是整数")
  .min(DOUBAO_SCENES.page)
  .max(DOUBAO_SCENES.hover)

/**
 * 消息体上的可选 `doubaoScene`。**显式拒绝字符串**：`"2"` 会在这里解析失败，
 * 而不是在服务端变成一句看不懂的 `710010202`。
 */
export const optionalDoubaoSceneSchema = doubaoSceneSchema.optional()

/**
 * 回环校验：只在值合法时保留它，否则一律降级成「未指定」，交给
 * `resolveDoubaoScene` 按功能推导。用于后台接收消息的信任边界 —— 那里宁可用
 * 默认场景继续翻译，也不能因为一个坏字段把整批请求打死。
 */
export const sanitizedDoubaoSceneSchema = doubaoSceneSchema.optional().catch(undefined)
