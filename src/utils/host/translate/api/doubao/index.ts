/**
 * 豆包原生翻译接口（`POST /samantha/plugin/stream_article_translate`）客户端。
 *
 * 模块划分：
 *   - `client.ts`  —— 请求构造、响应分流（SSE / 纯 JSON）、按 index 回填
 *   - `sse.ts`     —— 增量 SSE 解析（扛任意 chunk 切分）
 *   - `batching.ts`—— 分批（≤10000 字符且 ≤50 段）
 *   - `scene.ts`   —— 功能 → 数字场景号
 *   - `errors.ts`  —— `DoubaoApiError` 与错误码翻译
 *
 * 三条不变量（接口档案实测，别凭直觉改）：
 *   `scene` 是**数字**；`translate_service` 是**字符串**；只用流式端点。
 */

export {
  buildDoubaoRequestBody,
  doubaoTranslate,
  resolveDoubaoEngine,
  type DoubaoTranslateOptions,
} from "./client"
export { DOUBAO_BATCH_LIMITS, splitDoubaoBatches, type DoubaoBatch } from "./batching"
export { resolveDoubaoScene, DOUBAO_HOVER_SCENE, isDoubaoScene } from "./scene"
export {
  DoubaoApiError,
  classifyDoubaoErrorCode,
  createDoubaoHttpError,
  createDoubaoNetworkError,
  describeDoubaoErrorCode,
  isTransientDoubaoError,
  summarizeDoubaoResponseBody,
} from "./errors"
export {
  DoubaoSSEParser,
  readDoubaoSSEStream,
  type DoubaoSSEEvent,
  type DoubaoStreamItem,
  type DoubaoStreamOutcome,
} from "./sse"
