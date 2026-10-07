import type { TranslationTextFormat } from "@/types/config/translate"
import {
  DOUBAO_DEFAULT_SCENE,
  DOUBAO_LANGUAGE_LIST_URL,
  DOUBAO_PROVIDER_ENGINE,
  DOUBAO_STREAM_ARTICLE_URL,
  isDoubaoProviderType,
  isDoubaoScene,
  toDoubaoLang,
  type DoubaoEngine,
} from "@/utils/constants/doubao"
import { logger } from "@/utils/logger"
import { splitDoubaoBatches } from "./batching"
import {
  DoubaoApiError,
  createDoubaoHttpError,
  createDoubaoNetworkError,
  describeDoubaoErrorCode,
  summarizeDoubaoResponseBody,
} from "./errors"
import { readDoubaoSSEStream } from "./sse"

export interface DoubaoTranslateOptions {
  /**
   * 翻译引擎 `translate_service`。三个 provider 与三个引擎一一对应
   * （`DOUBAO_PROVIDER_ENGINE`），Web 端不读这个字段。
   */
  engine: DoubaoEngine
  /**
   * 场景 `scene`，**必须是数字** 1–6 —— 传字符串就是 `710010202`。
   * 由 `resolveDoubaoScene(feature, override)` 推导，通常不用手填。
   */
  scene?: number
  /**
   * 登录态 Cookie 串。留空时只靠 `credentials: "include"` 让浏览器自动带。
   *
   * 浏览器里手写 `Cookie` 头会被静默丢弃（fetch 禁止头），所以这条是给 Node /
   * 测试环境（以及未来可能的后台代理）用的；传了也不会有害。
   */
  cookie?: string
  /** `html` 片段直接拒绝：`stream_article_translate` 是纯文本端点，不做标记对齐。 */
  textFormat?: TranslationTextFormat
  signal?: AbortSignal
}

/**
 * 上线的 `stream_article_translate` 请求体。导出仅供测试与调试断言：其中两个字段的
 * 类型（`scene` 必须是数字、`translate_service` 必须是字符串）是这套接口最容易踩的坑。
 */
export function buildDoubaoRequestBody(
  texts: readonly string[],
  targetLang: string,
  engine: DoubaoEngine,
  scene: number,
): Record<string, unknown> {
  return {
    raw_text: [...texts],
    target_lang: targetLang,
    translate_service: engine,
    scene,
    frontend_source: 1,
  }
}

/**
 * Cookie 串 → 可安全放进 HTTP 头的 `Cookie` 值。
 * 只要有一个字符超出 latin-1 就整串丢掉：头里塞非 latin-1 会让 `fetch` 直接抛错，
 * 而「丢掉 cookie」至少还能走浏览器自动携带那条路。
 */
function toHeaderSafeCookie(cookie: string | undefined): string | undefined {
  if (!cookie) {
    return undefined
  }
  const trimmed = cookie.trim()
  if (trimmed === "") {
    return undefined
  }
  for (const char of trimmed) {
    if (char.codePointAt(0)! > 0xff) {
      return undefined
    }
  }
  return trimmed
}

/**
 * 请求头只有内容和可选的 Cookie。
 *
 * `User-Agent` / `Origin` / `Referer` 一律不手写：前者是 fetch 禁止头（写了也会被
 * 静默丢弃），后两者交给浏览器按扩展的 host_permissions 自动生成 —— 手写只会造出
 * 与真实来源不一致的跨域面。
 */
function buildHeaders(cookieHeader: string | undefined): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    ...(cookieHeader === undefined ? {} : { Cookie: cookieHeader }),
  }
}

/** 纯 JSON 错误体 → 带 code 的错误。有 code 就按 code 报，没有就按 HTTP 层报。 */
function throwJsonErrorBody(response: Response, rawText: readonly string[], text: string): never {
  let code: number | undefined
  let msg: string | undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null) {
      const frame = parsed as { code?: unknown; msg?: unknown }
      if (typeof frame.code === "number") {
        code = frame.code
      }
      if (typeof frame.msg === "string") {
        msg = frame.msg
      }
    }
  } catch {
    // 不是 JSON —— 下面按 HTTP 层错误报，别把原始响应体丢掉。
  }

  if (code !== undefined) {
    throw new DoubaoApiError(describeDoubaoErrorCode(code, { apiMessage: msg }), {
      code,
      apiMessage: msg,
      rawText,
    }).withRetryMeta({ statusCode: response.status, headers: response.headers })
  }
  throw createDoubaoHttpError(
    response.status,
    response.statusText,
    summarizeDoubaoResponseBody(text),
    rawText,
  )
}

/** 探针阈值：为了判定「是不是 SSE」最多多读这么多字节。 */
const SSE_PROBE_BYTES = 64

/** 把读到的分片拼成一个（可能不完整的）UTF-8 探针字符串。非法字节序列返回 null。 */
function decodeProbe(chunks: readonly Uint8Array[]): string | null {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(merged)
  } catch {
    return null
  }
}

/**
 * 判定响应体是不是 SSE。`content-type` 优先 —— 真实端点总会带
 * `text/event-stream`，走到这里基本已经有答案了。
 *
 * 兜底只在**没有 content-type** 时启用，而且要等够一行再判：之前的写法要求首块里
 * 出现完整 token（`event` / `data` / `id` / `:`），于是「首块恰好是 1 个字节 `i`」
 * 会被误判成非 SSE，然后把 SSE 正文当成 HTTP 错误体贴进错误文案里 —— 仍然是抛错
 * 而不是静默失败，但真实原因被盖掉了。
 *
 * 判据：在读到首个换行前，若出现过 `{` 就是 JSON 错误体；否则当 SSE（SSE 行首是
 * `event:` / `data:` / `id:` / `:` 这类纯 ASCII 标签）。整行读不出且不是合法 UTF-8
 * 的，也当 SSE —— 一个 JSON 错误体不可能不是 UTF-8。
 */
function looksLikeSSE(contentType: string, probe: string | null): boolean {
  const normalized = contentType.toLowerCase()
  if (normalized.includes("text/event-stream")) {
    return true
  }
  if (normalized.includes("application/json")) {
    return false
  }
  if (probe === null) {
    return true
  }
  const line = probe.split(/\r\n|\r|\n/, 1)[0] ?? ""
  if (probe.includes("\n") || probe.includes("\r")) {
    return !line.includes("{")
  }
  // 还没读满一行：出现 JSON 起始大括号就是 JSON，否则继续按 SSE 观察。
  return !probe.includes("{")
}

/**
 * 读一条请求的响应，返回 items（批内下标 + 译文）。
 *
 * **不能无条件按 SSE 解析**：实测这个端点有两种非 SSE 的失败形态 ——
 *   - 段数超过服务端上限（101+）→ `Content-Type: application/json`，body 是
 *     `{"code":710020202,"msg":"系统错误"}`，一帧 SSE 都没有；
 *   - `target_lang` 字段整个缺失 → 同样纯 JSON，`{"code":710010202,...}`。
 * 无条件 `getReader()` 按 SSE 走的话，这两种响应的 `code` 会被丢掉，上层只看到
 * 「一条译文都没有」，而真正的原因（错误码）彻底丢失。
 */
async function readDoubaoResponse(
  response: Response,
  rawText: readonly string[],
): Promise<{ index: number; res: string }[]> {
  const body = response.body
  if (!body) {
    const text = await response.text().catch(() => "")
    throwJsonErrorBody(response, rawText, text)
  }

  const reader = body.getReader()
  const contentType = response.headers.get("content-type") ?? ""

  // 先把判定所需的最小字节读出来（不越过首个换行），再决定走哪条路。
  const probed: Uint8Array[] = []
  let probeText = ""
  let streamEnded = false
  let sseDecided = false
  while (
    probed.reduce((sum, chunk) => sum + chunk.length, 0) < SSE_PROBE_BYTES &&
    !probeText.includes("\n") &&
    !probeText.includes("\r")
  ) {
    const next = await reader.read().catch((error: unknown) => {
      throw createDoubaoNetworkError(error, rawText)
    })
    if (next.done) {
      streamEnded = true
      break
    }
    if (next.value) {
      probed.push(next.value)
      const decoded = decodeProbe(probed)
      if (decoded === null) {
        // 读到的字节不是合法 UTF-8：不可能是 JSON 错误体，只能是 SSE。
        sseDecided = true
        break
      }
      probeText = decoded
    }
    if (contentType !== "") {
      break
    }
  }

  if (!sseDecided && !looksLikeSSE(contentType, probeText)) {
    // 非流式分支：把已经吃掉的部分和剩下的拼回来，整段读完再判 JSON。
    let rest = ""
    try {
      if (!streamEnded) {
        for (;;) {
          const next = await reader.read()
          if (next.done) {
            break
          }
          rest += next.value ? new TextDecoder().decode(next.value) : ""
        }
      }
    } catch (error) {
      throw createDoubaoNetworkError(error, rawText)
    } finally {
      reader.releaseLock()
    }
    throwJsonErrorBody(response, rawText, `${probeText}${rest}`)
  }

  const outcome = await readDoubaoSSEStream(reader, probed, rawText)

  if (outcome.items.length === 0) {
    throw new DoubaoApiError(
      outcome.sawDone
        ? "豆包翻译流正常结束，但没有返回任何译文（items 为空）。"
        : "豆包翻译流意外中断：没有收到 event:done，也没有任何译文。",
      { rawText },
    ).withRetryMeta({ statusCode: response.status, headers: response.headers })
  }
  if (!outcome.sawDone) {
    logger.warn("[Doubao] 翻译流未收到 event:done，结果可能不完整")
  }

  return outcome.items.map((item) => ({ index: item.index, res: item.res }))
}

/**
 * 发一批请求并返回**批内下标 → 译文**的映射。
 *
 * `data.items[].index` 是原文数组下标，**仍按 index 回填** —— 实测 19 次请求
 * （n=2/4/8）返回的 index 全部升序，乱序**没有复现**；但 Python 参考实现与豆包
 * 网页版都按 index 回填，而顺序一旦真的变化就是「整段译文错位」这种最难查的 bug，
 * 所以这里保持防御性回填，不在报告里声称已复现乱序。
 */
async function requestDoubaoBatch(
  texts: readonly string[],
  targetLang: string,
  engine: DoubaoEngine,
  scene: number,
  options: DoubaoTranslateOptions,
): Promise<Map<number, string>> {
  const cookieHeader = toHeaderSafeCookie(options.cookie)
  const body = JSON.stringify(buildDoubaoRequestBody(texts, targetLang, engine, scene))

  const response = await fetch(DOUBAO_STREAM_ARTICLE_URL, {
    method: "POST",
    headers: buildHeaders(cookieHeader),
    body,
    // 浏览器依据 host_permissions 自动带 doubao.com 的 httpOnly 登录态。
    credentials: "include",
    signal: options.signal,
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      throw error
    }
    throw createDoubaoNetworkError(error, texts)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw createDoubaoHttpError(
      response.status,
      response.statusText,
      summarizeDoubaoResponseBody(errorText),
      texts,
    )
  }

  const results = await readDoubaoResponse(response, texts)
  const byIndex = new Map<number, string>()
  for (const { index, res } of results) {
    if (byIndex.has(index)) {
      logger.warn(`[Doubao] 批内下标 ${index} 收到重复译文，保留先到的那条`)
      continue
    }
    byIndex.set(index, res)
  }
  return byIndex
}

async function doubaoTranslateInternal(
  texts: readonly string[],
  targetLang: string,
  options: DoubaoTranslateOptions,
): Promise<string[]> {
  if (texts.length === 0) {
    return []
  }

  // 与 google / microsoft 一致的守卫：这个端点是纯文本的，没有标记对齐模式。
  // translationOnly 页面模式会用 innerHTML 回填 provider 输出，把带 `data-rf-attr`
  // 标记的 HTML 片段发给它，结果无法预料 —— 直接拒绝，让残留路径在源头失败，
  // 而不是把整页标记弄坏。
  if (options.textFormat === "html") {
    throw new DoubaoApiError(
      "豆包翻译不支持 HTML 片段：stream_article_translate 是纯文本端点，没有保留标记的模式。请改用支持标记的 provider（例如 DeepL）。",
      { rawText: texts },
    )
  }

  const lang = toDoubaoLang(targetLang)
  if (!lang) {
    throw new DoubaoApiError(
      `豆包翻译不支持目标语言 "${targetLang}"。受支持的语言码见 ${DOUBAO_LANGUAGE_LIST_URL}`,
      { rawText: texts },
    )
  }

  const { engine } = options
  // 场景号是这套接口最大的坑：传 `"2"` 这类字符串一律 710010202。类型系统在
  // postMessage 边界上不设防，所以**这一层也做一次**运行时判定 —— 非法值退回默认
  // 场景并留痕，而不是把整页每一段都变成系统错误。
  const requestedScene = options.scene
  const scene =
    typeof requestedScene === "number" && isDoubaoScene(requestedScene)
      ? requestedScene
      : DOUBAO_DEFAULT_SCENE
  if (requestedScene !== undefined && scene !== requestedScene) {
    logger.warn(
      `[Doubao] 忽略非法的 scene 值 ${JSON.stringify(requestedScene)}（必须是数字 1–6），已退回默认场景 ${DOUBAO_DEFAULT_SCENE}`,
    )
  }

  const batches = splitDoubaoBatches(texts)
  logger.log(
    `[Doubao] ${texts.length} 段 → ${batches.length} 批（引擎 ${engine}，场景 ${scene}，目标语言 ${lang}）`,
  )

  const results: string[] = Array.from<string>({ length: texts.length }).fill("")

  for (const batch of batches) {
    // 每一批是一次独立的 POST：批之间失败互不影响，已成功的段落保留。
    const byIndex = await requestDoubaoBatch(batch.texts, lang, engine, scene, options)

    for (let offset = 0; offset < batch.texts.length; offset++) {
      const translated = byIndex.get(offset)
      if (translated === undefined) {
        // 少一段就少一段，但必须留痕：静默跳过会让「某几段没翻译」变成不可解释现象。
        logger.warn(
          `[Doubao] 批内下标 ${offset}（原文下标 ${batch.start + offset}）没有返回译文，该段留空`,
        )
        continue
      }
      results[batch.start + offset] = translated
    }
  }

  return results
}

/**
 * 豆包原生翻译客户端。单段/数组双签名与 `microsoftTranslate` 保持一致，方便在
 * `executeTranslate` 里按 provider 分派。
 *
 * 返回值**与输入等长且同序**：批内乱序已经按 `index` 回填，缺译文的位置是空字符串
 * （调用方会把它当「这段没翻出来」）。
 */
export async function doubaoTranslate(
  source: string,
  targetLang: string,
  options: DoubaoTranslateOptions,
): Promise<string>
export async function doubaoTranslate(
  source: readonly string[],
  targetLang: string,
  options: DoubaoTranslateOptions,
): Promise<string[]>
export async function doubaoTranslate(
  source: string | readonly string[],
  targetLang: string,
  options: DoubaoTranslateOptions,
): Promise<string | string[]> {
  const isSingle = typeof source === "string"
  const texts = isSingle ? [source] : [...source]

  const results = await doubaoTranslateInternal(texts, targetLang, options)
  return isSingle ? (results[0] ?? "") : results
}

/** provider 类型 → 引擎，顺便做一次运行时校验（配置是用户可编辑的持久化数据）。 */
export function resolveDoubaoEngine(provider: string): DoubaoEngine {
  if (!isDoubaoProviderType(provider)) {
    throw new DoubaoApiError(`未知的豆包 provider 类型 "${provider}"，无法确定 translate_service。`)
  }
  return DOUBAO_PROVIDER_ENGINE[provider]
}
