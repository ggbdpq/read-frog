# 豆包网页版翻译接口契约(逆向)

> 二次开发内部文档,不随上游 PR。接口来自对豆包网页版的抓包逆向,豆包随时可能
> 变动,仅供本 fork 开发参考。本目录的 `client.ts` / `sse.ts` / `batching.ts` /
> `scene.ts` 是该契约的实现。

## 调用方式

无需任何请求签名(无 `a_bogus` 等),仅依赖有效登录 Cookie。

- 端点:`POST https://www.doubao.com/samantha/plugin/stream_article_translate`
- 请求头:
  - `Content-Type: application/json`
  - `Cookie: sessionid=...; sid_tt=...; uid_tt=...`

## 请求体核心参数

| 参数                | 类型     | 说明                                                                                                      |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `raw_text`          | string[] | 待翻译文本列表;上限 100 段,建议单批 ≤50 段且 ≤10000 字符                                                  |
| `target_lang`       | string   | 目标语言代码,如 `"zh"`、`"en"` 等 19 种 ISO 639-1 码                                                      |
| `translate_service` | string   | 翻译引擎:`"0"` 火山引擎、`"1"` 豆包 AI、`"3"` 微软                                                        |
| `scene`             | int      | 场景枚举,**严格要求 int 类型**,不能传字符串或浮点数。常用值:1 整页翻译、2 AI 划词、3 划词翻译、6 悬停翻译 |
| `frontend_source`   | int      | 传 1                                                                                                      |

## 响应与解析注意事项

- 先看 `Content-Type`:参数错误或超限时返回纯 JSON(HTTP 200,但含错误
  `code`);未报错时返回 `text/event-stream`(SSE)。
- SSE 事件约定:
  - `event:json` — 成功;数据在 `data.items[]`,通过 `index` 对应原文下标
  - `event:err` — 异常,需显式捕获
  - `event:done` — 结束标志

## 插件侧集成要点(本 fork 的做法)

- 扩展 manifest 配置 `host_permissions: ["https://www.doubao.com/*"]`,
  请求时使用 `credentials: "include"` 自动携带浏览器的 Cookie 登录态。
- 内置页面支持一键探测登录态、脱离插件显示与 Cookie 导入。
- 智能分批与容错:后台自动将长文按「≤50 段且 ≤10000 字符」拆分请求并严格
  按序号回填;整页翻译与划词/悬停翻译场景的 `scene` 自动适配。
