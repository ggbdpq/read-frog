import {
  DOUBAO_CODE_LOGIN_EXPIRED,
  DOUBAO_CODE_PLUGIN_ERROR,
  DOUBAO_CODE_STREAM_ERROR,
  DOUBAO_CODE_SYSTEM_ERROR,
  DOUBAO_ORIGIN,
} from "@/utils/constants/doubao"
import { attachRequestErrorMeta } from "@/utils/request/retry-policy"

/**
 * 服务端返回了一个明确的错误码（HTTP 200 也算失败 —— 这套接口的错误都走业务码）。
 *
 * `code` / `msg` 原样保留，方便日志与测试断言；`message` 是给人看的中文。
 */
export class DoubaoApiError extends Error {
  readonly code: number | undefined
  /** 服务端原始 `msg`（可能是英文，如 "not a valid Language string"）。 */
  readonly apiMessage: string | undefined
  /** 触发失败的那一批原文，用于日志定位。 */
  readonly rawText: readonly string[] | undefined
  /** 这次请求到底有没有带上登录 Cookie —— 决定「去登录」还是「重新登录」。 */
  readonly hadCookie: boolean | undefined

  constructor(
    message: string,
    options: {
      code?: number
      apiMessage?: string
      rawText?: readonly string[]
      hadCookie?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "DoubaoApiError"
    this.code = options.code
    this.apiMessage = options.apiMessage
    this.rawText = options.rawText
    this.hadCookie = options.hadCookie
  }

  /** 带上 retry-policy 需要的元信息（kind / isRetryable / statusCode），返回自身便于 throw。 */
  withRetryMeta(meta: { statusCode?: number; headers?: Headers }): this {
    return attachRequestErrorMeta(this, {
      kind: classifyDoubaoErrorCode(this.code),
      isRetryable: isTransientDoubaoError(this.code),
      statusCode: meta.statusCode,
      responseHeaders: meta.headers,
    })
  }
}

/**
 * 豆包业务码 → retry-policy 的错误分类。
 *
 * `access-denied` 会让队列**立刻放弃整个积压**（见 `isQueueFatalRequestErrorMeta`），
 * 这正是登录过期该有的行为：剩下几百段的请求会以同样的方式失败。反过来
 * `bad-request` 不重试，因为参数错了重试多少次都一样。
 */
export function classifyDoubaoErrorCode(
  code: number | undefined,
): "access-denied" | "bad-request" | "unknown" {
  switch (code) {
    case DOUBAO_CODE_LOGIN_EXPIRED:
      return "access-denied"
    case DOUBAO_CODE_SYSTEM_ERROR:
    case DOUBAO_CODE_PLUGIN_ERROR:
    case DOUBAO_CODE_STREAM_ERROR:
      return "bad-request"
    default:
      return "unknown"
  }
}

/** 未知码当作「可能只是抖了一下」，允许队列按退避重试。 */
export function isTransientDoubaoError(code: number | undefined): boolean {
  return classifyDoubaoErrorCode(code) === "unknown"
}

/**
 * 把业务码翻译成人话。这几条文案是用户唯一能看到的东西，尽量写清「怎么办」。
 *
 * 注意 `710010202` 的尖括号提示：它是**唯一**一个我们已知根因的服务端错误 ——
 * `scene` 传成字符串就会拿到它（接口档案里卡最久的一条）。把这句话写进错误里，
 * 是为了下一次有人再往里塞 `"2"` 时，一眼能看出问题在哪。
 */
export function describeDoubaoErrorCode(
  code: number | undefined,
  options: { hadCookie?: boolean; apiMessage?: string } = {},
): string {
  switch (code) {
    case DOUBAO_CODE_LOGIN_EXPIRED:
      return options.hadCookie === false
        ? "未登录豆包账号：请到扩展的「豆包账号」页登录 www.doubao.com 后重试。"
        : "豆包登录态已过期：请到扩展的「豆包账号」页重新登录后重试。"
    case DOUBAO_CODE_SYSTEM_ERROR:
      return "豆包返回 710010202 系统错误。最常见的原因是 scene 传成了字符串（必须是数字 1–6），其次是请求参数不合法。"
    case DOUBAO_CODE_PLUGIN_ERROR:
      return "豆包返回 710020202 插件错误：该端点当前不可用。翻译只能用 stream_article_translate，不要改回 plugin/translate。"
    case DOUBAO_CODE_STREAM_ERROR:
      return `豆包翻译流返回 710020702 插件错误${options.apiMessage ? `（${options.apiMessage}）` : ""}。常见原因是 target_lang 不是受支持的语言码。`
    default:
      return code === undefined
        ? "豆包翻译失败，服务端没有给出错误码。"
        : `豆包翻译失败，错误码 ${code}${options.apiMessage ? `：${options.apiMessage}` : ""}。`
  }
}

/**
 * 兜底错误消息：只保留一小段响应体，避免把整页 HTML 错误页塞进日志。
 */
export function summarizeDoubaoResponseBody(body: string, limit = 200): string {
  const collapsed = body.replaceAll(/\s+/g, " ").trim()
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed
}

/** 网络层失败（DNS / 断连 / CORS），可重试。 */
export function createDoubaoNetworkError(
  cause: unknown,
  rawText?: readonly string[],
): DoubaoApiError {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return attachRequestErrorMeta(
    new DoubaoApiError(`豆包翻译网络请求失败：${detail}`, { cause, rawText }),
    { kind: "network", isRetryable: true },
  )
}

/** 非 2xx 的 HTTP 响应。401/403/404 交给 retry-policy 判定为「整队列放弃」。 */
export function createDoubaoHttpError(
  status: number,
  statusText: string,
  body: string,
  rawText?: readonly string[],
): DoubaoApiError {
  const suffix = body === "" ? "" : ` - ${summarizeDoubaoResponseBody(body)}`
  return attachRequestErrorMeta(
    new DoubaoApiError(
      `豆包翻译请求失败：HTTP ${status} ${statusText}${suffix}（端点 ${DOUBAO_ORIGIN}）`,
      { rawText },
    ),
    { statusCode: status },
  )
}
