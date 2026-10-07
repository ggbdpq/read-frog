import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DOUBAO_STREAM_ARTICLE_URL } from "@/utils/constants/doubao"
import { getRequestErrorMeta } from "@/utils/request/retry-policy"
import { doubaoTranslate, DoubaoApiError, splitDoubaoBatches } from "../doubao"

const fetchMock = vi.fn<(...args: any[]) => any>()

/**
 * 构造 SSE 字节流用的编码器。这里**故意用全局 `TextEncoder`**：它现在由
 * `vitest.setup.ts` 提供真正的 UTF-8 实现（此前那个逐字符取低 8 位的 shim 会把中文
 * 编成非法字节，让中文流式用例在乱码上假绿）。测试必须走与真实 `fetch` 相同的
 * 编码路径，而不是自己绕开它。
 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** `event: json` 帧（与服务端实测格式一致：单行 data，裸 LF 空行收尾）。 */
function jsonFrame(index: number, res: string, detectLang = "en"): string {
  return `id:${index}\nevent:json\ndata:${JSON.stringify({ code: 0, msg: "success", data: { items: [{ res, detect_lang: detectLang, index }] } })}\n\n`
}

const DONE_FRAME = "event:done\ndata:\n\n"

function sseBody(text: string): string {
  return `${text}${DONE_FRAME}`
}

/** 构造一个 fetch Response：`chunks` 按给定切分逐块吐出，用来验证跨 chunk 承载能力。 */
function mockResponse(
  chunks: readonly string[],
  options: { status?: number; contentType?: string; statusText?: string } = {},
): unknown {
  const status = options.status ?? 200
  const contentType = options.contentType ?? "text/event-stream"
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: options.statusText ?? "OK",
    headers: new Headers({ "content-type": contentType }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(utf8(chunk))
        }
        controller.close()
      },
    }),
    text: async () => chunks.join(""),
  }
}

function sseResponse(text: string): unknown {
  return mockResponse([text])
}

/** 把整段文本按**每 1 个字符**一块切开 —— 最坏情况的 chunk 边界。 */
function oneCharChunks(text: string): string[] {
  return Array.from(text)
}

function postBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[callIndex]![1].body)
}

function postInit(callIndex = 0): any {
  return fetchMock.mock.calls[callIndex]![1]
}

describe("doubao translate client", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts the exact wire shape: scene is a number, translate_service is a string", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好世界")))),
    )

    const result = await doubaoTranslate("Hello world", "zh", { engine: "0", scene: 2 })

    expect(result).toBe("你好世界")
    expect(String(fetchMock.mock.calls[0]![0])).toBe(DOUBAO_STREAM_ARTICLE_URL)
    expect(postBody()).toEqual({
      raw_text: ["Hello world"],
      target_lang: "zh",
      translate_service: "0",
      scene: 2,
      frontend_source: 1,
    })
    expect(typeof postBody().scene).toBe("number")
    expect(typeof postBody().translate_service).toBe("string")
  })

  it("sends credentials include and only the headers browsers allow", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hi", "zh", { engine: "1", scene: 2 })

    expect(postInit().credentials).toBe("include")
    expect(postInit().headers).toEqual({
      "Content-Type": "application/json",
      Accept: "*/*",
    })
    // User-Agent / Origin / Referer 是 fetch 禁止头或浏览器自有头，手写只会出问题。
    expect(postInit().headers).not.toHaveProperty("User-Agent")
    expect(postInit().headers).not.toHaveProperty("Origin")
    expect(postInit().headers).not.toHaveProperty("Referer")
  })

  it("adds a Cookie header only when one is supplied (Node / test path)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hi", "zh", {
      engine: "1",
      scene: 2,
      cookie: "sessionid=abc; sid_tt=def",
    })

    expect(postInit().headers.Cookie).toBe("sessionid=abc; sid_tt=def")
  })

  it("drops a Cookie value that is not header-safe instead of letting fetch throw", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hi", "zh", { engine: "1", scene: 2, cookie: "sessionid=中文" })

    expect(postInit().headers).not.toHaveProperty("Cookie")
  })

  it("refills by index, not by arrival order (defensive: a misordered batch must not shift text)", async () => {
    // 服务端实测 19 次都是升序，乱序没复现 —— 但一旦发生就是「整段译文错位」，
    // 所以这里用伪造的 [3,0,2,1] 顺序钉住回填逻辑。
    const frames = [
      JSON.stringify({ code: 0, data: { items: [{ res: "D", detect_lang: "en", index: 3 }] } }),
      JSON.stringify({ code: 0, data: { items: [{ res: "A", detect_lang: "en", index: 0 }] } }),
      JSON.stringify({ code: 0, data: { items: [{ res: "C", detect_lang: "en", index: 2 }] } }),
      JSON.stringify({ code: 0, data: { items: [{ res: "B", detect_lang: "en", index: 1 }] } }),
    ]
    const text = frames.map((frame) => `event:json\ndata:${frame}\n\n`).join("")
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(text))))

    const result = await doubaoTranslate(["a", "b", "c", "d"], "zh", { engine: "0", scene: 2 })

    expect(result).toEqual(["A", "B", "C", "D"])
  })

  it("survives a response delivered one character at a time", async () => {
    const text = sseBody(`${jsonFrame(0, "你好世界")}${jsonFrame(1, "第二段")}`)

    // 逐字符切块会把 `event:` 拆成 `event` + `:`、把 `\n\n` 拆成两个块，
    // 这是任何一个「按块 split('\n')」的实现都会挂掉的地方。
    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(oneCharChunks(text))))

    const result = await doubaoTranslate(["Hello world", "Second"], "zh", {
      engine: "0",
      scene: 2,
    })

    expect(result).toEqual(["你好世界", "第二段"])
  })

  it("survives CRLF line endings split across chunk boundaries", async () => {
    const text = `id:0\r\nevent:json\r\ndata:{"code":0,"data":{"items":[{"res":"你好","index":0}]}}\r\n\r\nevent:done\r\ndata:\r\n\r\n`
    // 把每个 `\r\n` 切开：`\r` 与 `\n` 落在不同的块里。
    const chunks: string[] = []
    for (const char of text) {
      chunks.push(char)
    }

    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(chunks)))

    expect(await doubaoTranslate("hello", "zh", { engine: "3", scene: 2 })).toBe("你好")
  })

  it("keeps CRLF event names — a stray empty line must not reset the event field", async () => {
    // 回归：`\r\n` 若被当成两个行尾消费，就会凭空多出一个空行，而空行会提前派发并
    // 丢掉 `event:` 字段 —— 于是 `event:json` / `event:done` 全退化成未知事件
    // "message"，表现为「items 永远为 0 + 流意外中断」。真实接口目前只发裸 LF，
    // 但 CRLF 是 SSE 的规范形式，任何中间层做行尾归一化就会踩中。
    const text = `id:0\r\nevent:json\r\ndata:${JSON.stringify({ code: 0, data: { items: [{ res: "你好世界", index: 0 }] } })}\r\n\r\nevent:done\r\ndata:\r\n\r\n`
    fetchMock.mockImplementation(() =>
      Promise.resolve(mockResponse([text], { contentType: "text/event-stream" })),
    )

    expect(await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })).toBe("你好世界")
  })

  it("classifies SSE correctly even when the first chunk is a single byte and no content-type is sent", async () => {
    // 兜底正则曾要求首块里出现完整 token（`event` / `data` / `id`），于是首块恰好是
    // 一个字节 `i` 时被误判成「非 SSE 的 JSON 错误体」，把 SSE 正文当成 HTTP 错误体
    // 贴进错误文案 —— 仍然是抛错而不是静默失败，但真实原因被盖掉。
    const text = sseBody(jsonFrame(0, "你好"))
    const chunks: string[] = []
    for (const char of text) {
      chunks.push(char)
    }
    fetchMock.mockImplementation(() => Promise.resolve(mockResponse(chunks, { contentType: "" })))

    expect(await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })).toBe("你好")
  })

  it("returns array results in input order and single strings for the single overload", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(sseResponse(sseBody(`${jsonFrame(0, "一")}${jsonFrame(1, "二")}`))),
    )

    expect(await doubaoTranslate("hello", "zh", { engine: "1", scene: 2 })).toBe("一")
    expect(postBody().raw_text).toEqual(["hello"])
  })

  it("returns [] for empty array input without fetching", async () => {
    expect(await doubaoTranslate([], "zh", { engine: "1", scene: 2 })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps target language aliases and refuses unsupported ones loudly", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hi", "zh-TW", { engine: "1", scene: 2 })
    expect(postBody().target_lang).toBe("zh-Hant")

    fetchMock.mockClear()
    await expect(doubaoTranslate("hi", "klingon", { engine: "1", scene: 2 })).rejects.toThrow(
      /不支持目标语言/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses html fragments instead of corrupting the marker protocol", async () => {
    await expect(
      doubaoTranslate('<a data-rf-attr="0">pricing</a>', "zh", {
        engine: "1",
        scene: 2,
        textFormat: "html",
      }),
    ).rejects.toThrow(/不支持 HTML 片段/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe("批内上限", () => {
    it("splits at the 50-segment boundary and posts one request per batch", async () => {
      let batchNo = 0
      fetchMock.mockImplementation(() => {
        const current = batchNo++
        return Promise.resolve(
          sseResponse(sseBody(jsonFrame(current === 0 ? 0 : 0, `batch${current}`))),
        )
      })

      const texts = Array.from({ length: 51 }, (_, index) => `p${index}`)
      const result = await doubaoTranslate(texts, "zh", { engine: "0", scene: 1 })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(postBody(0).raw_text).toHaveLength(50)
      expect(postBody(1).raw_text).toEqual(["p50"])
      expect(result).toHaveLength(51)
    })

    it("keeps 10000 characters in one batch and pushes the next paragraph into a second one", async () => {
      const texts = ["a".repeat(9999), "b", "c"]

      const batches = splitDoubaoBatches(texts)

      expect(batches).toHaveLength(2)
      expect(batches[0]!.texts).toEqual(["a".repeat(9999), "b"])
      expect(batches[1]!.texts).toEqual(["c"])
    })
  })

  describe("静默失败通道", () => {
    // 日志断言走 logger 的 spy：`@/utils/logger` 在非 DEV 下是 no-op，
    // 因此 `console.warn` 的 spy 在这里永远抓不到东西。
    let loggerWarn: any

    beforeEach(async () => {
      const { logger } = await import("@/utils/logger")
      loggerWarn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    })

    afterEach(() => {
      loggerWarn.mockRestore()
    })

    function loggedWarnings(): string {
      return (loggerWarn.mock.calls as unknown[][])
        .map((call) => call.map(String).join(" "))
        .join("\n")
    }

    it("throws on an event:err frame instead of returning empty text", async () => {
      // 实测原始帧：event:err\ndata:{"code":710020702,"msg":"not a valid Language string","data":null}\n\n
      const text = `event:err\ndata:${JSON.stringify({ code: 710020702, msg: "not a valid Language string", data: null })}\n\n`
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([text], { contentType: "text/event-stream" })),
      )

      const error = await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(error).toBeInstanceOf(DoubaoApiError)
      expect((error as DoubaoApiError).code).toBe(710020702)
      expect((error as DoubaoApiError).apiMessage).toBe("not a valid Language string")
      // 只认 `event === "json"` 的实现会在这里静默返回空字符串 —— 那才是 bug。
      expect(getRequestErrorMeta(error)).toMatchObject({ kind: "bad-request", isRetryable: false })
    })

    it("throws the frame code out of a plain-JSON error body (101+ segments / missing target_lang)", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse([JSON.stringify({ code: 710020202, msg: "系统错误", data: null })], {
            contentType: "application/json; charset=utf-8",
          }),
        ),
      )

      const error = await doubaoTranslate(["hello"], "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect(error).toBeInstanceOf(DoubaoApiError)
      expect((error as DoubaoApiError).code).toBe(710020202)
      expect((error as DoubaoApiError).message).toContain("710020202")
    })

    it("detects a plain-JSON body even without a content-type header", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([`{"code":710010202,"msg":"系统错误"}`], { contentType: "" })),
      )

      const error = await doubaoTranslate(["hello"], "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect((error as DoubaoApiError).code).toBe(710010202)
    })

    it("turns a login-expired code into a readable Chinese instruction", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse([JSON.stringify({ code: 710012001, msg: "登录已过期，请重新登录" })], {
            contentType: "application/json",
          }),
        ),
      )

      const error = await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect((error as DoubaoApiError).code).toBe(710012001)
      expect((error as DoubaoApiError).message).toContain("豆包账号")
      expect(getRequestErrorMeta(error)).toMatchObject({ kind: "access-denied" })
    })

    it("does not mistake an error frame inside a json event for a success", async () => {
      const frame = `event:json\ndata:${JSON.stringify({ code: 710010202, msg: "系统错误" })}\n\n`
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([frame], { contentType: "text/event-stream" })),
      )

      const error = await doubaoTranslate(["hello"], "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect((error as DoubaoApiError).code).toBe(710010202)
    })

    it("reports an unknown event instead of swallowing it silently", async () => {
      const text = `event:mystery\ndata:{"whatever":true}\n\n${jsonFrame(0, "你好")}${DONE_FRAME}`
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([text], { contentType: "text/event-stream" })),
      )

      // 未知事件不会被当成译文，但也不该让整条请求失败；关键是它必须留痕。
      expect(await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })).toBe("你好")

      expect(loggedWarnings()).toContain("未知 SSE 事件")
      expect(loggedWarnings()).toContain("mystery")
    })

    it("fails loudly when the stream ends with no items at all", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([DONE_FRAME], { contentType: "text/event-stream" })),
      )

      await expect(doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })).rejects.toThrow(
        /没有返回任何译文/,
      )
    })

    it("fails loudly when the stream is cut off mid-flight", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(mockResponse([`event:json\ndata:{"code":0,"data":{"items":[]}}\n\n`])),
      )

      await expect(doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })).rejects.toThrow(
        /意外中断/,
      )
    })

    it("marks a network failure as retryable instead of reporting a parsing problem", async () => {
      fetchMock.mockImplementation(() => Promise.reject(new Error("Failed to fetch")))

      const error = await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect((error as Error).message).toContain("网络请求失败")
      expect(getRequestErrorMeta(error)).toMatchObject({ kind: "network", isRetryable: true })
    })

    it("surfaces the HTTP status when the endpoint answers with one", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          mockResponse(["nope"], {
            status: 429,
            statusText: "Too Many Requests",
            contentType: "text/plain",
          }),
        ),
      )

      const error = await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 }).catch(
        (e: unknown) => e,
      )

      expect((error as Error).message).toContain("429")
      expect(getRequestErrorMeta(error)).toMatchObject({ statusCode: 429, kind: "rate-limit" })
    })
  })

  it("defaults the scene to the AI reader instead of sending an invalid value", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hello", "zh", { engine: "1" })

    expect(postBody().scene).toBe(2)
  })

  it("falls back to the default scene when a caller forces a string scene in", async () => {
    const { logger } = await import("@/utils/logger")
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    try {
      // 类型层面已挡住；这里模拟运行时被 `as any` 塞进来的字符串 —— 真发出去就是
      // 710010202，所以客户端必须自己再判一次，而不是信任调用方。
      await doubaoTranslate("hello", "zh", { engine: "1", scene: "2" as unknown as number })

      expect(postBody().scene).toBe(2)
      expect(typeof postBody().scene).toBe("number")
      expect(warn.mock.calls.map((call) => call.map(String).join(" ")).join("\n")).toContain(
        "忽略非法的 scene 值",
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("falls back to the default scene for out-of-range numbers", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(sseResponse(sseBody(jsonFrame(0, "你好")))))

    await doubaoTranslate("hello", "zh", { engine: "1", scene: 99 })

    expect(postBody().scene).toBe(2)
  })
})
