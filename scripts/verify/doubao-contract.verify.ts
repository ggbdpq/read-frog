/**
 * 豆包接口契约对抗测试（验证者独立编写，不依赖实现者的自测）。
 *
 * 用**真实本机 HTTP mock 服务器**（`mock-doubao-server.mjs`）驱动，不是纯 fetch stub ——
 * 除了几个必须精确控制字节边界的用例才改用 ReadableStream stub。
 *
 * 跑法：
 *     cd read-frog
 *     pnpm exec vitest run --config scripts/verify/vitest.verify.config.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { splitDoubaoBatches } from "@/utils/host/translate/api/doubao/batching"
import { doubaoTranslate } from "@/utils/host/translate/api/doubao/client"
import { DoubaoApiError } from "@/utils/host/translate/api/doubao/errors"
import { DoubaoSSEParser } from "@/utils/host/translate/api/doubao/sse"
import { startMockDoubao } from "./mock-doubao-server.mjs"

let mock: Awaited<ReturnType<typeof startMockDoubao>>
let restoreFetch: () => void

beforeAll(async () => {
  mock = await startMockDoubao()
})

afterAll(async () => {
  await mock.stop()
})

beforeEach(() => {
  mock.reset("ok")
  restoreFetch = mock.installFetchRewrite()
})

afterEach(() => {
  restoreFetch()
})

/** 抓错误对象，方便断言 code / 文案。 */
async function grab(promise: Promise<unknown>): Promise<DoubaoApiError> {
  try {
    await promise
  } catch (error) {
    return error as DoubaoApiError
  }
  throw new Error("预期抛错，但调用正常返回了")
}

const lastBody = () => mock.requests[mock.requests.length - 1]!.body

// ════════════════════════════════════════════════════════════════════════════
describe("A. 请求体契约（scene 必须是数字 / translate_service 必须是字符串）", () => {
  it("A1 scene 以**数字**下发，且 translate_service 是字符串", async () => {
    await doubaoTranslate("hello", "zh", { engine: "0", scene: 2 })
    const body = lastBody()
    expect(typeof body.scene).toBe("number")
    expect(body.scene).toBe(2)
    expect(typeof body.translate_service).toBe("string")
    expect(body.translate_service).toBe("0")
    expect(body.frontend_source).toBe(1)
    expect(body.target_lang).toBe("zh")
    expect(body.raw_text).toEqual(["hello"])
  })

  it('A2 三个引擎分别下发字符串 "0" / "1" / "3"', async () => {
    for (const engine of ["0", "1", "3"] as const) {
      mock.reset("ok")
      await doubaoTranslate("hello", "zh", { engine, scene: 2 })
      const body = lastBody()
      expect(body.translate_service).toBe(engine)
      expect(typeof body.translate_service).toBe("string")
    }
  })

  it('A3【本地拦截】scene 传字符串 "2" 时，绝不能把字符串真的发出去', async () => {
    // 真实服务端对字符串 scene 回 710010202。这里断言的是「本地就不该发字符串」。
    await doubaoTranslate("hello", "zh", { engine: "0", scene: "2" as unknown as number })
    for (const req of mock.requests) {
      expect(typeof req.body.scene).toBe("number")
      expect(req.body.scene).not.toBe("2")
    }
    // 必须完全没有任何一个请求把 scene 发成字符串
    const stringScenes = mock.requests.filter((r) => typeof r.body.scene === "string")
    expect(stringScenes).toHaveLength(0)
  })

  it("A4 未给 scene 时退回默认场景；且下发的 scene 必须是 1–6 的整数", async () => {
    await doubaoTranslate("hello", "zh", { engine: "0" })
    expect(lastBody().scene).toBe(2) // DOUBAO_DEFAULT_SCENE
  })

  it("A4b【边界】scene 传 NaN / Infinity 时不得把 null 发出去", async () => {
    // `typeof NaN === "number"` 为真，所以只查 typeof 的守卫会放行 NaN，
    // 而 JSON.stringify(NaN) === "null" —— 服务端会把它当非法 scene。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      mock.reset("ok")
      await doubaoTranslate("hello", "zh", { engine: "0", scene: bad })
      const scene = lastBody().scene
      expect(
        typeof scene === "number" && Number.isInteger(scene) && scene >= 1 && scene <= 6,
        `scene=${String(bad)} 被下发成 ${JSON.stringify(scene)}，不是 1–6 的整数`,
      ).toBe(true)
    }
  })

  it("A4c 非整数 / 越界 scene 也不该原样下发", async () => {
    for (const bad of [1.5, 0, 7, -1, 99]) {
      mock.reset("ok")
      await doubaoTranslate("hello", "zh", { engine: "0", scene: bad })
      const scene = lastBody().scene
      expect(
        typeof scene === "number" && Number.isInteger(scene) && scene >= 1 && scene <= 6,
        `scene=${bad} 被下发成 ${JSON.stringify(scene)}`,
      ).toBe(true)
    }
  })

  it("A5 六个合法场景号原样下发且都是数字", async () => {
    for (const scene of [1, 2, 3, 4, 5, 6]) {
      mock.reset("ok")
      await doubaoTranslate("hello", "zh", { engine: "0", scene })
      expect(lastBody().scene).toBe(scene)
      expect(typeof lastBody().scene).toBe("number")
    }
  })

  it("A6 Cookie 通过请求头下发（Node 路径），且是 latin-1 安全时才下发", async () => {
    await doubaoTranslate("hello", "zh", { engine: "0", cookie: "sessionid=abc; sid_tt=def" })
    expect(mock.requests[0]!.headers.cookie).toBe("sessionid=abc; sid_tt=def")

    mock.reset("ok")
    // 含非 latin-1 的 cookie 必须整串丢弃，而不是让 fetch 抛错
    await doubaoTranslate("hello", "zh", { engine: "0", cookie: "a=中文" })
    expect(mock.requests[0]!.headers.cookie).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("B. SSE 跨 chunk 断行（1 字节一 chunk）", () => {
  /** 用 pull 逐字节喂，保证每次 read() 只拿到 1 个字节。 */
  function byteChunkedResponse(text: string, contentType?: string) {
    const bytes = new TextEncoder().encode(text)
    let i = 0
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (i >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(i, i + 1))
        i += 1
      },
    })
    const headers = contentType === undefined ? undefined : { "content-type": contentType }
    return { response: new Response(stream, { status: 200, headers }), pulls: () => pulls }
  }

  it("B1 解析器逐字节喂仍然产出完整事件（含中文多字节被切开）", () => {
    const parser = new DoubaoSSEParser()
    const text = `id:0\nevent:json\ndata:${JSON.stringify({
      code: 0,
      msg: "success",
      data: { items: [{ res: "你好世界", detect_lang: "en", index: 0 }] },
    })}\n\nevent:done\ndata:\n\n`
    const bytes = new TextEncoder().encode(text)
    const decoder = new TextDecoder()
    const events: { event: string; data: string }[] = []
    for (const b of bytes) {
      events.push(...parser.push(decoder.decode(Uint8Array.of(b), { stream: true })))
    }
    events.push(...parser.push(decoder.decode()))
    events.push(...parser.flush())

    expect(events.map((e) => e.event)).toEqual(["json", "done"])
    expect(JSON.parse(events[0]!.data).data.items[0].res).toBe("你好世界")
  })

  it("B2 解析器必须正确吃 `\\r\\n` 行尾（含把 \\r 与 \\n 切开）", () => {
    // 真实 SSE 规范用 CRLF 行尾。这里喂一条完整 CRLF 流，并按会切开 \r\n 的方式分块。
    const payload = { code: 0, msg: "success", data: { items: [{ res: "x", index: 0 }] } }
    const wire = `id:0\r\nevent:json\r\ndata:${JSON.stringify(payload)}\r\n\r\nevent:done\r\ndata:\r\n\r\n`
    const parser = new DoubaoSSEParser()
    const events: { event: string; data: string }[] = []
    // 每次切 3 个字符：足以把 \r\n 从中间切开
    for (let i = 0; i < wire.length; i += 3) {
      events.push(...parser.push(wire.slice(i, i + 3)))
    }
    events.push(...parser.flush())

    expect(events.map((e) => e.event)).toEqual(["json", "done"])
    expect(JSON.parse(events[0]!.data).code).toBe(0)
  })

  it("B2b 整段 CRLF 一次性喂，事件名与 data 都要正确", () => {
    const payload = { code: 0, msg: "success", data: { items: [{ res: "x", index: 0 }] } }
    const wire = `id:0\r\nevent:json\r\ndata:${JSON.stringify(payload)}\r\n\r\nevent:done\r\ndata:\r\n\r\n`
    const parser = new DoubaoSSEParser()
    const events = [...parser.push(wire), ...parser.flush()]
    expect(events.map((e) => e.event)).toEqual(["json", "done"])
    expect(JSON.parse(events[0]!.data).data.items[0].res).toBe("x")
  })

  it("B3 端到端：整个响应被拆成 1 字节一 chunk，译文仍然正确", async () => {
    const text = `id:0\nevent:json\ndata:${JSON.stringify({
      code: 0,
      msg: "success",
      data: {
        items: [
          { res: "一二三", detect_lang: "en", index: 0 },
          { res: "第二段的译文", detect_lang: "en", index: 1 },
        ],
      },
    })}\n\nevent:done\ndata:\n\n`
    const { response, pulls } = byteChunkedResponse(text, "text/event-stream")
    const realFetch = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(response)
    try {
      const out = await doubaoTranslate(["a", "b"], "zh", { engine: "0", scene: 2 })
      expect(out).toEqual(["一二三", "第二段的译文"])
      // 证明确实发生了多次跨 chunk 读取，否则这个用例没有意义
      expect(pulls()).toBeGreaterThan(10)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it("B4 真实 HTTP 逐字符 trickle 写入，结果仍正确（跨 chunk 断行的集成版）", async () => {
    mock.trickle = true
    const out = await doubaoTranslate(["alpha", "beta"], "zh", { engine: "0", scene: 2 })
    expect(out).toEqual(["译:alpha", "译:beta"])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("C. 乱序回填（服务端本次未复现乱序，此处用 mock 强制伪造）", () => {
  it("C1 items 顺序 [3,0,2,1] 时必须按原文下标严格对齐", async () => {
    mock.scenario = "out-of-order"
    const input = ["第一段", "第二段", "第三段", "第四段"]
    const out = await doubaoTranslate(input, "zh", { engine: "0", scene: 2 })
    expect(out).toEqual(["译:第一段", "译:第二段", "译:第三段", "译:第四段"])
  })

  it("C2 乱序 + 多批：跨批下标回填不能串位", async () => {
    mock.scenario = "out-of-order"
    // 每条 10 字符，60 条 -> 每批 50 条 -> 2 批；第 2 批只有 10 条，乱序退回自然序
    const input = Array.from({ length: 60 }, (_, i) => `s${String(i).padStart(8, "0")}`)
    const out = await doubaoTranslate(input, "zh", { engine: "0", scene: 2 })
    expect(out).toHaveLength(60)
    for (let i = 0; i < 60; i++) {
      expect(out[i]).toBe(`译:${input[i]}`)
    }
  })

  it("C3 重复下标：保留先到的那条，不静默覆盖", async () => {
    mock.scenario = "duplicate-index"
    const out = await doubaoTranslate(["x"], "zh", { engine: "0", scene: 2 })
    expect(out).toEqual(["第一版"])
  })

  it("C4 批内缺段：缺失位置留空串，且长度仍与输入等长", async () => {
    mock.scenario = "partial-items"
    const out = await doubaoTranslate(["a", "b", "c"], "zh", { engine: "0", scene: 2 })
    expect(out).toHaveLength(3)
    expect(out[0]).toBe("译:a")
    expect(out[1]).toBe("")
    expect(out[2]).toBe("译:c")
  })

  it("C5 非法 index/res 类型被丢弃，不污染结果", async () => {
    mock.scenario = "bad-index-type"
    const out = await doubaoTranslate(["a", "b"], "zh", { engine: "0", scene: 2 })
    expect(out).toEqual(["", "正常"])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("D. 分批边界（≤10000 字符 且 ≤50 段）", () => {
  it("D1 51 段必须拆成 2 次请求，且结果与原文严格对齐", async () => {
    const input = Array.from({ length: 51 }, (_, i) => `S${i}`)
    const out = await doubaoTranslate(input, "zh", { engine: "0", scene: 2 })

    expect(mock.requests).toHaveLength(2)
    expect((mock.requests[0]!.body.raw_text as string[]).length).toBe(50)
    expect((mock.requests[1]!.body.raw_text as string[]).length).toBe(1)
    expect(out).toHaveLength(51)
    for (let i = 0; i < 51; i++) expect(out[i]).toBe(`译:${input[i]}`)
  })

  it("D2 50 段只需 1 次请求", async () => {
    await doubaoTranslate(
      Array.from({ length: 50 }, (_, i) => `S${i}`),
      "zh",
      { engine: "0", scene: 2 },
    )
    expect(mock.requests).toHaveLength(1)
  })

  it("D3 字符边界：9999+1=10000 合批；10000+1=10001 必须分 2 批", async () => {
    const a9999 = "a".repeat(9999)
    await doubaoTranslate([a9999, "x"], "zh", { engine: "0", scene: 2 })
    expect(mock.requests).toHaveLength(1)

    mock.reset("ok")
    const a10000 = "a".repeat(10000)
    await doubaoTranslate([a10000, "x"], "zh", { engine: "0", scene: 2 })
    expect(mock.requests).toHaveLength(2)
    expect((mock.requests[0]!.body.raw_text as string[])[0]!.length).toBe(10000)
  })

  it("D4 单段自身超限：单独成批、不丢段、不死循环", () => {
    const batches = splitDoubaoBatches(["a".repeat(15000), "b"])
    expect(batches).toHaveLength(2)
    expect(batches[0]!.texts[0]!.length).toBe(15000)
    expect(batches[1]!.texts).toEqual(["b"])
    // 下标连续覆盖，无空洞
    expect(batches[0]!.start).toBe(0)
    expect(batches[1]!.start).toBe(1)
  })

  it("D5 空输入不发请求", async () => {
    const out = await doubaoTranslate([], "zh", { engine: "0", scene: 2 })
    expect(out).toEqual([])
    expect(mock.requests).toHaveLength(0)
  })

  it("D6 分批不变量：任意输入下下标连续覆盖、无空批", () => {
    for (const sizes of [[1], [1, 1], [10000, 1], [5000, 5000, 1], [20000, 1, 1]]) {
      const texts = sizes.map((n, i) => String(i).repeat(n))
      const batches = splitDoubaoBatches(texts)
      expect(batches.every((b) => b.texts.length > 0)).toBe(true)
      let cursor = 0
      for (const b of batches) {
        expect(b.start).toBe(cursor)
        cursor += b.texts.length
      }
      expect(cursor).toBe(texts.length)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("E. 错误码映射（三个码都要给出可读中文且不吞异常）", () => {
  it("E1 710012001 登录已过期 -> 抛 DoubaoApiError 且 code 正确", async () => {
    mock.scenario = "json-login-error"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.code).toBe(710012001)
    expect(err.message).toContain("登录")
  })

  it("E2 710010202 系统错误 -> 文案点明 scene 必须是数字", async () => {
    mock.scenario = "json-scene-error"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err.code).toBe(710010202)
    expect(err.message).toContain("710010202")
    expect(err.message).toContain("scene")
    expect(err.message).toContain("数字")
  })

  it("E3 710020202 插件错误 -> 文案说明端点不可用", async () => {
    mock.scenario = "json-plugin-error"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err.code).toBe(710020202)
    expect(err.message).toContain("710020202")
    expect(err.message).toContain("stream_article_translate")
  })

  it("E4 event:json 里带非 0 code 也要抛错", async () => {
    mock.scenario = "frame-error-in-json"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err.code).toBe(710010202)
  })

  it("E5 HTTP 500 走 HTTP 层错误，带上状态码", async () => {
    mock.scenario = "http-500"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.message).toContain("500")
  })

  it("E6 未知目标语言在**本地**就报错，不发请求", async () => {
    const err = await grab(doubaoTranslate("x", "zz", { engine: "0", scene: 2 }))
    expect(err.message).toContain("zz")
    expect(mock.requests).toHaveLength(0)
  })

  it("E7 HTML 片段直接拒绝（纯文本端点）", async () => {
    const err = await grab(
      doubaoTranslate("x", "zh", { engine: "0", scene: 2, textFormat: "html" }),
    )
    expect(err.message).toContain("HTML")
    expect(mock.requests).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("F.【静默失败通道 1】event:err 必须整体抛错，不能被吞成空结果", () => {
  it("F1 只有 event:err 帧 -> 抛 710020702，而不是返回空译文", async () => {
    mock.scenario = "err-event"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.code).toBe(710020702)
    expect(err.message).toContain("710020702")
    expect(err.apiMessage).toBe("not a valid Language string")
  })

  it("F2 先有 items 再 err -> 仍然整体抛错（不静默返回半截结果）", async () => {
    mock.scenario = "err-event-with-items"
    const err = await grab(doubaoTranslate(["a", "b", "c"], "zh", { engine: "0", scene: 2 }))
    expect(err.code).toBe(710020702)
  })

  it("F3 未知事件不得被静默忽略：有 items 时正常返回，但无 items 时抛错", async () => {
    mock.scenario = "unknown-event-with-items"
    const ok = await doubaoTranslate(["a"], "zh", { engine: "0", scene: 2 })
    expect(ok).toEqual(["译:a"])

    mock.reset("unknown-event")
    const err = await grab(doubaoTranslate(["a"], "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
  })

  it("F4 只有 done、没有 items -> 必须抛错而不是静默返回空串", async () => {
    mock.scenario = "done-only"
    const err = await grab(doubaoTranslate(["a"], "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.message).toContain("items")
  })

  it("F5 没有 done 且没有 items -> 按流中断抛错", async () => {
    mock.scenario = "empty-array-report"
    const err = await grab(doubaoTranslate(["a"], "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
  })

  it("F6 有 items 但没有 done -> 返回结果（并 warn），不当作失败", async () => {
    mock.scenario = "no-done"
    const out = await doubaoTranslate(["a"], "zh", { engine: "0", scene: 2 })
    expect(out).toEqual(["译:a"])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe("G.【静默失败通道 2】非 SSE 的纯 JSON 错误体必须解出 code", () => {
  it("G1 Content-Type: application/json + 710020202 -> 抛带 code 的可读错误", async () => {
    mock.scenario = "json-plugin-error"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.code).toBe(710020202)
    // 不能是"解析失败"这类糊掉的文案
    expect(err.message).not.toContain("解析失败")
    expect(err.message).toContain("710020202")
  })

  it("G2 Content-Type: application/json + 710010202 -> 抛带 code 的错误", async () => {
    mock.scenario = "json-scene-error"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err.code).toBe(710010202)
  })

  it("G3 没有 content-type 的纯 JSON 错误体也要解出 code（兜底路径）", async () => {
    mock.scenario = "json-error-no-content-type"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.code).toBe(710020202)
  })

  it("G4【Lead 指定】无 content-type 时，首块被切成半截帧也必须仍识别为 SSE（逐字节刻画）", async () => {
    // 真实 SSE 报文以 `id:0\n` 开头。这里把**同一条真实报文**在 1..6 字节处切开，
    // 且不发 content-type，逼客户端走 looksLikeSSE 的正则兜底。
    // 兜底正则 `/^\s*(event|data|id|:)/` 要求前缀里出现**完整** token，
    // 因此首块只有 1 个字节（"i"）时会判成非 SSE -> 走 JSON 分支 ->
    // 抛 "HTTP 200 OK" 并把 SSE 正文当成错误体，真实原因被盖掉。
    const results: Record<string, string> = {}
    for (let n = 1; n <= 6; n++) {
      mock.reset("ok")
      mock.scenario = "partial-first-chunk"
      mock.firstChunkBytes = n
      try {
        const out = await doubaoTranslate("x", "zh", { engine: "0", scene: 2 })
        results[`首块${n}字节`] = out === "译:ok" ? "OK" : `异常结果 ${JSON.stringify(out)}`
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        results[`首块${n}字节`] = `抛错: ${msg.slice(0, 40)}`
      }
    }

    const failures = Object.entries(results).filter(([, v]) => v !== "OK")
    expect(failures, `逐字节刻画结果: ${JSON.stringify(results, null, 2)}`).toEqual([])
  })

  it("G5 既不是 JSON 也不是 SSE 的响应体 -> 按 HTTP 层错误报告，且带上响应体片段", async () => {
    mock.scenario = "not-json-not-sse"
    const err = await grab(doubaoTranslate("x", "zh", { engine: "0", scene: 2 }))
    expect(err).toBeInstanceOf(DoubaoApiError)
    expect(err.message).toContain("gateway error")
  })
})
