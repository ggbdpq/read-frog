# 浏览器内验证豆包扩展 —— runbook

面向下一个要在这台机器上跑「加载扩展 → 断言 Cookie/翻译」的人。
**这里记的都是会给出「假阴性」的坑**：看起来像「扩展不能带 Cookie」或「功能坏了」，
实际是扩展根本没跑起来 / 测的是坏数据。每条都标了实测结论与「别再试」。

实测环境：Windows，Chrome **153.0.8010.53**，Edge 153.0.4234.48（两者同版本，行为一致），
puppeteer-core **25.12.0**。

---

## 坑 1：`--load-extension` 在 Chrome 137+ 已失效（❌ 别再试）

自 Chrome 137 起上游禁用了该命令行开关。扩展**不会**加载，也不报错。

下面 5 种 flag 组合**全部实测无效**，已排除，不要再花时间：

| #   | flag 组合                                                      | 结果    |
| --- | -------------------------------------------------------------- | ------- |
| 1   | 仅 `--load-extension=<dir>`（+ `--disable-extensions-except`） | ❌ 无效 |
| 2   | `--disable-features=DisableLoadExtensionCommandLineSwitch`     | ❌ 无效 |
| 3   | `--enable-unsafe-extension-debugging`                          | ❌ 无效 |
| 4   | 2 + 3 并用                                                     | ❌ 无效 |
| 5   | 2 + 3 + `--enable-features=ExtensionManifestV2Unsupported`     | ❌ 无效 |

判据：`browser.targets()` 里始终只有 `browser` + `page`，没有任何 `chrome-extension://`。
证据：`verify/evidence/phase1_extension_load_diag.txt`。

**替代路径见坑 2。**

---

## 坑 2：正确加载方式 = CDP `Extensions.loadUnpacked`

```js
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: false,
  // 见坑 3 —— 这一行是必须的
  ignoreDefaultArgs: [
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
  ],
  args: ["--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check"],
})

const extId = await browser.installExtension(EXT_DIR) // 内部就是 Extensions.loadUnpacked
```

等价的原生 CDP 调用（不依赖 puppeteer API）：

```js
const session = await browser.target().createCDPSession()
const { id } = await session.send("Extensions.loadUnpacked", { path: EXT_DIR })
```

`path` 需绝对路径，指向含 `manifest.json` 的目录。

---

## 坑 3：⚠️ puppeteer 默认传 `--disable-extensions`（最容易误诊）

**puppeteer 的默认参数里带 `--disable-extensions`**，会禁用所有扩展。

误诊症状极具误导性 —— 三个信号同时出现，看起来「扩展明明装上了」：

1. `Extensions.loadUnpacked` / `browser.installExtension` **返回了合法扩展 id**；
2. Chrome 自己的 histogram 里有 `Extensions.LoadAll2 = 1`、`ExtensionLocation2 = 5`（= unpacked）；
3. 但 **service worker 永不启动**，`browser.targets()` 里始终没有 `chrome-extension://`，
   扩展也从不发起任何网络请求。

**修复**（实测命令行参数 35 → 33）：

```js
ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"]
```

证据：`verify/evidence/phase1_puppeteer_default_args.txt`（A 组命中、B 组消失）。

> 这条如果不知道，很容易得出「扩展 fetch 不带 Cookie」这种**完全错误**的结论。

---

## 坑 4：`goto("chrome-extension://<id>/page.html")` 被拦

从普通标签页导航到扩展页面会被 `ERR_BLOCKED_BY_CLIENT` 拒绝。

**改用「SW 轮询握手」**：让 service worker 主动轮询本机收集器，测试侧用闸门控制放行时机。

```js
// sw.js 侧：先等放行，再干活
async function waitForGo() {
  for (let i = 0; i < 400; i++) {
    const r = await fetch("http://127.0.0.1:PORT/go", { cache: "no-store" })
    if ((await r.json()).go) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
```

顺带解决了一个**时序问题**：必须先 `Network.setCookies` 注入 Cookie，再让 SW 发请求。
不用页面导航就自然拿到了这个顺序。轮询还让 SW 保持存活（每次 fetch 重置 MV3 空闲计时）。

---

## 坑 5：仓库测试环境的 `TextEncoder` 会截断非 ASCII（假绿 + 假红）

`read-frog/vitest.setup.ts:137-153` 把全局 `TextEncoder` 换成了
`ESBuildAndJSDOMCompatibleTextEncoder`（为绕开 vitest#4043 的 jsdom 跨 realm 问题），
但它的实现是 `arr[i] = decodedURI[i].charCodeAt(0)` —— **每个 charCode 被截成低 8 位**。

实测：`new TextEncoder().encode("A你B")` → `[65, 96, 66]`（应为 `[65, 228, 189, 160, 66]`），
`new TextDecoder().decode(...)` → `"A\`B"`。**任何中文都会被静默损坏。**

对本项目的具体危害：

- **假绿**：用 `TextEncoder` 把中文喂给 SSE 解析器，测的是坏字节，真实缺陷测不出来；
- **假红**：undici 发请求时 body 字节数与 `Content-Length` 不符，报
  `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH`。

绕开方式（见 `scripts/verify/verify.setup.ts`）：在 node 环境里换回真实现
（jsdom 的跨 realm 问题在 node 环境并不存在），并做一次往返自检。

```ts
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util"
globalThis.TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder
globalThis.TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder
```

---

## 坑 6：采集门禁证据前，先确认工作树没有正在进行的写入

**证据本身有时效性。** 在多写者并发（Lead + 多个 teammate 同时改 `src/**`）下，
「跑完门禁就把结果当最终态」是不成立的 —— 全量 `pnpm test` 要跑约 **80 秒**，
采集窗口内代码完全可能继续变化。

**真实案例（本项目实际踩到）**：

| 项                                              | 时间         |
| ----------------------------------------------- | ------------ |
| `verify/evidence/phase2_type_check.txt`（快照） | 10:37:18     |
| `verify/evidence/phase2_pnpm_test.txt`（快照）  | 10:38:39     |
| 被验证文件的修复落盘                            | **10:39:42** |

快照比修复**早 84 秒**，于是一份「2 个 lint error + 4 个 test 失败」的中间态被当成最终门禁结论
写进了交付报告。这个错误的方向很危险：它会让团队去"修"一个已经被修好的东西。

**做法**：

1. 采集前先看 `git status` 与关键文件 mtime，确认没有正在进行的写入；有并发就等一个静默窗口。
2. **把采集时间戳写进证据文件头部**（不要只依赖文件 mtime）：

   ```powershell
   $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
   "# 采集时间: $ts" | Out-File evidence\type_check.txt -Encoding utf8
   pnpm run type-check 2>&1 | Tee-Object -FilePath evidence\type_check.txt -Append
   ```

3. 引用任何门禁结论前，**比对「证据文件头时间戳」与「被验证源码的 mtime」**。
4. 发现旧快照失效时：用当前树覆盖重跑，并在报告里**保留一段说明它是中间态**
   （写清时间差、根因、以及当时的推断哪部分对/哪部分错）。
   抹掉这段等于把报告伪装成"一直都对"。

> 附带教训：`vitest.setup.ts` 把 `console.error` 静音了，导致被 `catch` 吞掉的异常
> 在测试输出里**完全不可见** —— 与坑 5 的 `TextEncoder` 属于同一类问题：
> **测试基建本身让证据失真**。排查「两个本该被调用的 mock 都是 0 次调用」这类症状时，
> 先把静音的日志临时打开。

---

## 可复现的最小脚本

| 目标                                             | 路径                                                       | 说明                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 验证「SW 的 fetch 是否自动带 doubao.com Cookie」 | `verify-harness/run-auth-probe.mjs`                        | 读 `%TEMP%\doubao_verify_cookie.txt`；安装最小 MV3 扩展；`credentials` 三取值差分（include / 默认 / omit，omit 是阴性对照） |
| 依赖位置                                         | `verify-harness/node_modules`（`puppeteer-core@^25.12.0`） | 独立于 `read-frog`，不污染交付物依赖                                                                                        |

运行：

```powershell
cd C:\Users\afdsafg\Desktop\doubao\verify-harness
node run-auth-probe.mjs
```

脚本**不打印任何 Cookie 值**，只打印 cookie 名称与数量。

## 契约对抗测试（不依赖浏览器）

```powershell
cd read-frog
pnpm exec vitest run --config scripts/verify/vitest.verify.config.ts
```

用真实本机 HTTP mock（`scripts/verify/mock-doubao-server.mjs`）驱动，独立 include 模式，
**不会**混进交付物的 `pnpm test` 门禁。
