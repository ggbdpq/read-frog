/**
 * 验证者自建的豆包接口 mock 服务器（真实 HTTP，不是 fetch stub）。
 *
 * 设计目标：把实测到的**真实响应形态**逐个搬进 lab，包括契约文档没写的三种：
 *   - `event:err`（710020702）—— 非法 target_lang，整条请求失败
 *   - `Content-Type: application/json` 的**非 SSE** 错误体（101+ 段 / 缺 target_lang）
 *   - 只有 `event:json` 却没有 `event:done` 的截断流
 *
 * 用法（在 .verify.ts 里）：
 *     const mock = await startMockDoubao()
 *     mock.scenario = "out-of-order"
 *     // 把 https://www.doubao.com 改写到这里
 *     mock.stop()
 */
import http from "node:http"

/** SSE 帧构造：与实测原始字节一致（裸 LF，空行收尾）。 */
export function sseJsonFrame(payload) {
  return `id:0\nevent:json\ndata:${JSON.stringify(payload)}\n\n`
}
export function sseDoneFrame() {
  return `event:done\ndata:\n\n`
}
export function sseErrFrame(code, msg) {
  return `event:err\ndata:${JSON.stringify({ code, msg, data: null })}\n\n`
}

/**
 * 为一批原文生成 items。
 *
 * 译文里**只回显原文**（不带下标），这样「下标回填是否正确」就完全由
 * 「译文是否落到了输入对应的槽位」来判定 —— 若回填错了，文本会出现在错误的槽位，
 * 断言立刻能抓到。带上标反而会把批内下标与全局下标的差异混进来，干扰判断。
 *
 * `order` 为 null 时按自然序；否则按给定顺序输出（必须是**完整排列**，不能少项）。
 */
export function itemsFor(texts, order) {
  const byIndex = texts.map((t, i) => ({ res: `译:${t}`, detect_lang: "en", index: i }))
  if (!order) return byIndex
  return order.map((i) => byIndex[i]).filter(Boolean)
}

/** 完整排列：保证每一项都出现且仅出现一次。4 项用题目指定的 [3,0,2,1]，其余用整段反转。 */
export function permutationFor(n) {
  if (n === 4) return [3, 0, 2, 1]
  return Array.from({ length: n }, (_, i) => n - 1 - i)
}

export async function startMockDoubao() {
  const state = {
    /** 见 switch；默认正常返回。 */
    scenario: "ok",
    /** 收到过的请求（body 已解析），测试用来断言分批次数与请求体字段。 */
    requests: [],
    /** 非 SSE 分支使用的 content-type 覆盖。 */
    itemOrder: null,
    /** 分片写入：把整段响应按 1 字符多次 write，逼出跨 chunk 断行。 */
    trickle: false,
    /** `split-first-chunk` 场景的首块字节数。 */
    firstChunkBytes: 1,
    /** 服务端是否回 500（测 HTTP 层错误）。 */
    httpStatus: null,
  }

  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      let body = null
      try {
        body = JSON.parse(raw)
      } catch {
        /* 保持 null */
      }
      state.requests.push({ url: req.url, headers: req.headers, body })

      const texts = Array.isArray(body?.raw_text) ? body.raw_text : []

      const send = (status, headers, text) => {
        res.writeHead(status, headers)
        if (state.trickle) {
          // 逐字符写，制造跨 chunk 断行（含 \n 与 UTF-8 边界）
          let i = 0
          const timer = setInterval(() => {
            if (i >= text.length) {
              clearInterval(timer)
              res.end()
              return
            }
            res.write(text[i])
            i += 1
          }, 0)
        } else {
          res.end(text)
        }
      }

      const sendSse = (text) =>
        send(200, { "Content-Type": "text/event-stream; charset=utf-8" }, text)

      switch (state.scenario) {
        case "ok": {
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: itemsFor(texts, state.itemOrder) },
            }) + sseDoneFrame(),
          )
          return
        }
        case "out-of-order": {
          // 完整排列：4 项用题目指定的 [3,0,2,1]，其余整段反转。
          // 必须是全排列 —— 只回 4 项会让「批次里有 50 段」的用例失真。
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: itemsFor(texts, permutationFor(texts.length)) },
            }) + sseDoneFrame(),
          )
          return
        }
        case "err-event": {
          // 实测原始帧：只有 err，无 json、无 done
          sendSse(sseErrFrame(710020702, "not a valid Language string"))
          return
        }
        case "err-event-with-items": {
          // 对抗变体：先吐一段 items 再 err，检验是否仍整体抛错
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: itemsFor(texts).slice(0, 1) },
            }) + sseErrFrame(710020702, "partial failure"),
          )
          return
        }
        case "json-plugin-error": {
          // 实测：101+ 段 -> 纯 JSON，application/json，无任何 SSE 帧
          send(
            200,
            { "Content-Type": "application/json; charset=utf-8" },
            JSON.stringify({ code: 710020202, msg: "系统错误", error: { code: 710020202 } }),
          )
          return
        }
        case "json-scene-error": {
          send(
            200,
            { "Content-Type": "application/json; charset=utf-8" },
            JSON.stringify({ code: 710010202, msg: "系统错误" }),
          )
          return
        }
        case "json-login-error": {
          send(
            200,
            { "Content-Type": "application/json; charset=utf-8" },
            JSON.stringify({ code: 710012001, msg: "登录已过期，请重新登录" }),
          )
          return
        }
        case "split-first-chunk": {
          // 忠实还原：把**真实 SSE 报文**在指定字节处切开成两个 chunk，
          // 且**故意不发 content-type**，逼客户端走 looksLikeSSE 的正则兜底。
          const wire =
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: [{ res: "译:ok", detect_lang: "en", index: 0 }] },
            }) + sseDoneFrame()
          const n = state.firstChunkBytes
          res.writeHead(200)
          res.write(wire.slice(0, n))
          setTimeout(() => res.end(wire.slice(n)), 25)
          return
        }
        case "partial-first-chunk": {
          // 无 content-type，把**真实 SSE 报文**在指定字节处切开成两个 chunk，
          // 逼客户端走 looksLikeSSE 的正则兜底。用来逐字节刻画该兜底的判定边界。
          const wire =
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: [{ res: "译:ok", detect_lang: "en", index: 0 }] },
            }) + sseDoneFrame()
          const n = state.firstChunkBytes
          res.writeHead(200)
          res.write(wire.slice(0, n))
          setTimeout(() => res.end(wire.slice(n)), 25)
          return
        }
        case "json-error-no-content-type": {
          // 无 content-type 的纯 JSON 错误体 —— 考 looksLikeSSE 的兜底路径
          res.writeHead(200)
          res.end(JSON.stringify({ code: 710020202, msg: "系统错误" }))
          return
        }
        case "json-error-split-first-chunk": {
          // 无 content-type，且首块恰好是半截帧（模拟 `ev`）—— 考兜底路径的误判
          res.writeHead(200)
          res.write("ev")
          setTimeout(
            () => res.end('ent:json\ndata:{"code":0,"msg":"success","data":{"items":[]}}\n\n'),
            30,
          )
          return
        }
        case "no-done": {
          // 只有 json 帧，没有 done：截断流
          sendSse(sseJsonFrame({ code: 0, msg: "success", data: { items: itemsFor(texts) } }))
          return
        }
        case "done-only": {
          sendSse(sseDoneFrame())
          return
        }
        case "unknown-event": {
          sendSse(`event:mystery\ndata:{"hello":"world"}\n\n` + sseDoneFrame())
          return
        }
        case "unknown-event-with-items": {
          sendSse(
            `event:mystery\ndata:{"hello":"world"}\n\n` +
              sseJsonFrame({ code: 0, msg: "success", data: { items: itemsFor(texts) } }) +
              sseDoneFrame(),
          )
          return
        }
        case "frame-error-in-json": {
          // event:json 里带非 0 code
          sendSse(sseJsonFrame({ code: 710010202, msg: "系统错误" }) + sseDoneFrame())
          return
        }
        case "empty-array-report": {
          sendSse(sseJsonFrame({ code: 0, msg: "success", data: { items: [] } }) + sseDoneFrame())
          return
        }
        case "duplicate-index": {
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: {
                items: [
                  { res: "第一版", detect_lang: "en", index: 0 },
                  { res: "第二版", detect_lang: "en", index: 0 },
                ],
              },
            }) + sseDoneFrame(),
          )
          return
        }
        case "partial-items": {
          // 3 段只回 2 段（缺下标 1）
          const all = itemsFor(texts)
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: { items: [all[0], all[2]].filter(Boolean) },
            }) + sseDoneFrame(),
          )
          return
        }
        case "bad-index-type": {
          sendSse(
            sseJsonFrame({
              code: 0,
              msg: "success",
              data: {
                items: [
                  { res: "字符串下标", index: "0" },
                  { res: "浮点下标", index: 1.5 },
                  { res: "正常", index: 1 },
                  { res: "缺 res" },
                  null,
                ],
              },
            }) + sseDoneFrame(),
          )
          return
        }
        case "http-500": {
          send(500, { "Content-Type": "text/plain" }, "boom")
          return
        }
        case "not-json-not-sse": {
          res.writeHead(200)
          res.end("<html>gateway error</html>")
          return
        }
        default: {
          send(500, { "Content-Type": "text/plain" }, `unknown scenario ${state.scenario}`)
        }
      }
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`

  return {
    origin,
    state,
    /** 便捷访问器 */
    get scenario() {
      return state.scenario
    },
    set scenario(v) {
      state.scenario = v
    },
    get requests() {
      return state.requests
    },
    get itemOrder() {
      return state.itemOrder
    },
    set itemOrder(v) {
      state.itemOrder = v
    },
    get trickle() {
      return state.trickle
    },
    set trickle(v) {
      state.trickle = v
    },
    get firstChunkBytes() {
      return state.firstChunkBytes
    },
    set firstChunkBytes(v) {
      state.firstChunkBytes = v
    },
    reset(scenario = "ok") {
      state.scenario = scenario
      state.requests.length = 0
      state.itemOrder = null
      state.trickle = false
      state.firstChunkBytes = 1
    },
    /** 把 doubao 源站的 URL 改写到本 mock，其余交给真实 fetch。 */
    installFetchRewrite() {
      const realFetch = globalThis.fetch
      const rewritten = (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith("https://www.doubao.com")) {
          return realFetch(url.replace("https://www.doubao.com", origin), init)
        }
        return realFetch(input, init)
      }
      globalThis.fetch = rewritten
      return () => {
        globalThis.fetch = realFetch
      }
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
