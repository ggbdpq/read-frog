import {
  DOUBAO_CODE_STREAM_ERROR,
  DOUBAO_SSE_EVENT_DONE,
  DOUBAO_SSE_EVENT_ERR,
  DOUBAO_SSE_EVENT_JSON,
} from "@/utils/constants/doubao"
import { logger } from "@/utils/logger"
import { DoubaoApiError, describeDoubaoErrorCode } from "./errors"

/**
 * 一帧解析后的 SSE 事件。
 *
 * `data` 是**多行 `data:` 用 `\n` 拼接**的结果（标准 SSE 语义；豆包实际发的都是单行，
 * 但如果哪天变成多行，拼接口径必须和 Python 参考实现一致）。
 */
export interface DoubaoSSEEvent {
  event: string
  data: string
}

/** 行尾：`\r\n` / `\n` / `\r` 都算；`\r` 落在 buffer 末尾时返回 -1（可能是被切开的 `\r\n`）。 */
function findLineEnd(buffer: string, from: number): number {
  for (let index = from; index < buffer.length; index++) {
    const char = buffer[index]!
    if (char === "\n") {
      return index + 1
    }
    if (char === "\r") {
      if (index + 1 >= buffer.length) {
        return -1
      }
      return buffer[index + 1] === "\n" ? index + 2 : index + 1
    }
  }
  return -1
}

/**
 * 增量 SSE 解析器：吃任意切分的 chunk，产出完整事件。
 *
 * 为什么不用 `response.text()` 一把梭：整页翻译一次可能几十秒，先攒完整流再解析等于
 * 把流式的所有好处丢光；更实际的是，服务端**可能在任意字节位置分块**，包括把
 * `event:js` / `on` 切开，或者把 `\r\n` 从中间切开。
 *
 * 实现细节（都是会被真实流量踩到的，见各自的注释）：
 *   - 只有遇到**空行**才算一帧结束（`\n\n`、`\r\n\r\n`、`\r\r` 都识别；实测豆包用裸 LF）；
 *   - 行分隔符 `\r\n` / `\n` / `\r` 都支持，且 `\r` 落在 chunk 末尾时不能急着当成换行
 *     —— 必须等下一个 chunk 看清是不是 `\r\n`；
 *   - 以 `:` 开头的行是注释（心跳），直接丢；
 *   - 字段与值之间的第一个空格按 SSE 规范只吃掉一个；
 *   - **`\r\n` 是整体消费的**：靠 `findLineEnd` 一次性算出下一行的起点，绝不让循环
 *     再回到那个 `\n` 上 —— 那会凭空造出一个空行，而空行会提前派发/清空事件名；
 *   - **空行不清事件名**：`event:` 字段按规范对后续所有帧生效，只有真的派发出去
 *     （或 `flush`）才重置。
 *
 * 已实测：真实接口一个 `\r` 字节都不发，全靠裸 `\n`。CRLF 是 SSE 规范的规范形式，
 * 任何中间层（代理 / CDN / 网关）做行尾归一化就会踩中，所以这里必须支持。
 */
export class DoubaoSSEParser {
  #buffer = ""
  #eventName: string | null = null
  #dataLines: string[] = []

  /** 喂入一段原始文本（已按 UTF-8 解码），返回这轮能确定的完整事件。 */
  push(chunk: string): DoubaoSSEEvent[] {
    this.#buffer += chunk
    const events: DoubaoSSEEvent[] = []

    let cursor = 0
    for (;;) {
      const lineEnd = findLineEnd(this.#buffer, cursor)
      if (lineEnd === -1) {
        break
      }
      const line = this.#buffer.slice(cursor, lineEnd).replace(/[\r\n]+$/, "")
      // 先把游标推进到已消费位置，再处理这一行：`handle` 可能抛错（错误帧），
      // 那时 buffer 必须已经一致，否则重试/续帧会二次解析同一行。
      const rest = this.#buffer.slice(lineEnd)
      this.#buffer = rest
      cursor = 0

      const dispatched = this.#handleLine(line)
      if (dispatched) {
        events.push(dispatched)
      }
    }

    return events
  }

  /** 流结束：把最后一行（无换行收尾）和悬着的 data 一并派发。 */
  flush(): DoubaoSSEEvent[] {
    const events: DoubaoSSEEvent[] = []
    const remainder = this.#buffer
    this.#buffer = ""
    if (remainder !== "") {
      // 末尾可能是被截断的 `\r`，也可能是一整行没有换行的收尾。
      const dispatched = this.#handleLine(remainder.replace(/[\r\n]+$/, ""))
      if (dispatched) {
        events.push(dispatched)
      }
    }
    const pending = this.#takePending()
    if (pending) {
      events.push(pending)
    }
    return events
  }

  #handleLine(line: string): DoubaoSSEEvent | null {
    if (line === "") {
      return this.#takePending()
    }
    if (line.startsWith(":")) {
      return null
    }
    const separator = line.indexOf(":")
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? "" : line.slice(separator + 1)
    if (value.startsWith(" ")) {
      value = value.slice(1)
    }

    if (field === "event") {
      this.#eventName = value
    } else if (field === "data") {
      this.#dataLines.push(value)
    }
    return null
  }

  #takePending(): DoubaoSSEEvent | null {
    if (this.#dataLines.length === 0) {
      // 没有 data 的行组不构成事件 —— 但**事件名必须留着**：SSE 规范里
      // `event:` 对后续帧持续生效，而 `event:X` 与它的 `data:` 之间被空行/注释
      // 隔开是合法写法。这里顺手清空过一次，结果 CRLF 流（多出一个空行）下
      // `event:json` 全部退化成默认事件名 `message`，items 永远为 0。
      return null
    }
    const event: DoubaoSSEEvent = {
      // SSE 规范：没有 `event:` 字段时默认事件名是 "message"。
      event: this.#eventName ?? "message",
      data: this.#dataLines.join("\n"),
    }
    this.#eventName = null
    this.#dataLines = []
    return event
  }
}

/** 一次解析循环里收集到的结果，`client.ts` 用它按 index 回填。 */
export interface DoubaoStreamItem {
  /** **批内**下标（原文数组下标），返回可能不是升序。 */
  index: number
  /** 译文。 */
  res: string
  /** 服务端识别出的源语言码，仅用于日志。 */
  detectLang?: string
}

export interface DoubaoStreamOutcome {
  items: DoubaoStreamItem[]
  /** 是否收到 `event:done`。没收到通常是流被截断。 */
  sawDone: boolean
  /** 未知事件名（去重），供调用方决定要不要当作异常。 */
  unknownEvents: string[]
}

/** 解析 `data` 里的 JSON 帧；解析不了就跳过（不猜、不构造半截结果）。 */
function parseFrame(event: DoubaoSSEEvent): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(event.data)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    logger.warn(`[Doubao] 忽略无法解析的 SSE data 帧（event=${event.event}）`)
    return null
  }
}

function readFrameError(
  frame: Record<string, unknown>,
): { code: number; msg: string | undefined } | null {
  const code = frame.code
  if (typeof code !== "number" || code === 0) {
    return null
  }
  return { code, msg: typeof frame.msg === "string" ? frame.msg : undefined }
}

function throwFrameError(code: number, msg: string | undefined, rawText: readonly string[]): never {
  throw new DoubaoApiError(describeDoubaoErrorCode(code, { apiMessage: msg }), {
    code,
    apiMessage: msg,
    rawText,
  }).withRetryMeta({})
}

/**
 * 消费整条 SSE 响应体，返回按批内下标回填好的 items。
 *
 * 入参是**已经取过第一块的 reader**：调用方需要用第一块区分「SSE 流」和「纯 JSON
 * 错误体」，所以握手在读第一块时就完成了，这里接着往下读。`prefetched` 就是那块
 * 已经被消费掉的字节，必须先喂给解析器，否则会丢掉响应开头。
 *
 * 三条「静默失败」通道在这里被显式堵住：
 *   1. `event:err` → 直接抛错。**只认 `event === "json"` 的解析器会把它吃掉**，
 *      上层于是拿到「0 条译文且没有异常」，表现为翻译不出来但也不报错。
 *   2. 任何未知事件都不会被静默忽略 —— 记进 `unknownEvents` 并打 warn 日志。
 *   3. 没有任何 item 且没看到 `done` → 由调用方按「流被截断」抛错。
 *
 * 实测：`event:err` 是**整条请求失败**（err 帧之前不会吐任何 `event:json`），
 * 所以整体抛错是对的，不需要逐段回退。
 */
export async function readDoubaoSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  prefetched: readonly Uint8Array[],
  rawText: readonly string[],
): Promise<DoubaoStreamOutcome> {
  const parser = new DoubaoSSEParser()
  const decoder = new TextDecoder()
  const items: DoubaoStreamItem[] = []
  const unknownEvents = new Set<string>()
  let sawDone = false

  const handle = (event: DoubaoSSEEvent): void => {
    if (event.event === DOUBAO_SSE_EVENT_ERR) {
      const frame = parseFrame(event)
      const code = typeof frame?.code === "number" ? frame.code : DOUBAO_CODE_STREAM_ERROR
      const msg = typeof frame?.msg === "string" ? frame.msg : undefined
      throwFrameError(code, msg, rawText)
    }

    if (event.event === DOUBAO_SSE_EVENT_DONE) {
      sawDone = true
      // `done` 的 data 是空的；若服务端反常地塞了 JSON，也校验一下错误码。
      const frame = event.data === "" ? null : parseFrame(event)
      if (frame) {
        const frameError = readFrameError(frame)
        if (frameError) {
          throwFrameError(frameError.code, frameError.msg, rawText)
        }
      }
      return
    }

    if (event.event !== DOUBAO_SSE_EVENT_JSON) {
      // 未知事件：留痕，但不在这里抛 —— 它可能是我们没见过的控制帧，
      // 真正的失败会在「一个 item 都没有」时统一暴露。
      unknownEvents.add(event.event)
      logger.warn(`[Doubao] 收到未知 SSE 事件 "${event.event}"，data 长度 ${event.data.length}`)
      return
    }

    const frame = parseFrame(event)
    if (!frame) {
      return
    }
    const frameError = readFrameError(frame)
    if (frameError) {
      throwFrameError(frameError.code, frameError.msg, rawText)
    }

    const frameData = frame.data
    if (typeof frameData !== "object" || frameData === null) {
      return
    }
    const rawItems = (frameData as { items?: unknown }).items
    if (!Array.isArray(rawItems)) {
      return
    }

    for (const rawItem of rawItems) {
      if (typeof rawItem !== "object" || rawItem === null) {
        continue
      }
      const {
        index,
        res,
        detect_lang: detectLang,
      } = rawItem as {
        index?: unknown
        res?: unknown
        detect_lang?: unknown
      }
      if (typeof index !== "number" || !Number.isInteger(index) || typeof res !== "string") {
        continue
      }
      items.push({
        index,
        res,
        detectLang: typeof detectLang === "string" ? detectLang : undefined,
      })
    }
  }

  try {
    for (const chunk of prefetched) {
      for (const event of parser.push(decoder.decode(chunk, { stream: true }))) {
        handle(event)
      }
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          handle(event)
        }
      }
    }

    // `stream: true` 的收尾：让多字节字符的最后一截落地。
    for (const event of parser.push(decoder.decode())) {
      handle(event)
    }
    for (const event of parser.flush()) {
      handle(event)
    }
  } finally {
    reader.releaseLock()
  }

  return { items, sawDone, unknownEvents: [...unknownEvents] }
}
