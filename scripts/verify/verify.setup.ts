/**
 * 验证套件专用 setup（在仓库 `vitest.setup.ts` **之后**运行）。
 *
 * ## 为什么需要这个文件
 *
 * 仓库的 `vitest.setup.ts:137-153` 把全局 `TextEncoder` 换成了一个
 * `ESBuildAndJSDOMCompatibleTextEncoder`（为了绕开 vitest#4043 的 jsdom/跨 realm
 * Uint8Array 问题）。但那个 shim 的实现是：
 *
 *     const decodedURI = decodeURIComponent(encodeURIComponent(input))
 *     arr[i] = decodedURI[i].charCodeAt(0)      // <-- 每个 charCode 被截成低 8 位
 *
 * 对本进程实测：`new TextEncoder().encode("A你B")` 返回 `[65, 96, 66]`，
 * 而正确结果应是 `[65, 228, 189, 160, 66]`（`你` = U+4F60 -> 低字节 0x60）。
 * 也就是说**任何非 ASCII 字符都会被静默截断**，`TextDecoder` 也解不回来
 * （它对 `[65,96,66]` 返回 `"A\`B"`）。
 *
 * 这一条对本任务是要害：豆包链路的核心就是**中文流式文本**。若在测试里用
 * `TextEncoder` 把中文喂给 SSE 解析器，测的是被截断的坏字节，
 * 会同时产生两种恶果 —— 真实缺陷测不出来（假绿），以及
 * undici 发请求时 body 字节数与 Content-Length 不符而报
 * `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH`（假红）。
 *
 * 本套件跑在 `environment: "node"` 下，jsdom 的跨 realm 问题并不存在，
 * 所以直接换回 Node 自带的真实 UTF-8 实现 —— 这与 Chrome 里的行为一致，
 * 属于**恢复标准行为**，不是削弱测试。
 */
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util"

const probe = new NodeTextEncoder().encode("你")
if (probe.length !== 3) {
  throw new Error(
    `verify.setup: node:util 的 TextEncoder 也异常（"你" 编码成 ${probe.length} 字节），` +
      `逐字节中文用例无法可信运行，请先修复环境`,
  )
}

globalThis.TextEncoder = NodeTextEncoder
globalThis.TextDecoder = NodeTextDecoder

// 自检：确认覆盖生效，避免 setup 顺序变化导致静默退化
const roundTrip = new TextDecoder().decode(new TextEncoder().encode("你好世界"))
if (roundTrip !== "你好世界") {
  throw new Error(
    `verify.setup: TextEncoder/TextDecoder 覆盖失败，往返得到 ${JSON.stringify(roundTrip)}`,
  )
}
