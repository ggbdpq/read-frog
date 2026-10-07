/**
 * 豆包（www.doubao.com）原生翻译接口契约 —— 逆向实测版，勿凭直觉修改。
 *
 * 实测来源：`C:\Users\afdsafg\Desktop\doubao\doubao_translate_api.md`
 * 参考实现：`C:\Users\afdsafg\Desktop\doubao\doubao_translate.py`
 *
 * 三条铁律（改坏了整个链路就报错）：
 *   1. `scene` 必须是**数字**。传 `"web"` / `"2"` 这类字符串一律 `710010202 系统错误`。
 *   2. `translate_service` 必须是**字符串** `"0"` / `"1"` / `"3"`。
 *   3. 只用 `stream_article_translate`。同步版 `plugin/translate` 恒报 `710020202`；
 *      `plugin/detect_lang` 只在入参形状不对（`{"text":...}`）时报 `710020202`，
 *      形状对了（`{"raw_text":[...]}`）能返回 `code:0` —— 实测更正，见下。
 *
 * 为什么仍然不接 `detect_lang`：本扩展的源语言识别走本地 franc / LLM 通道，接第二个
 * 端点只会多一份鉴权面与维护面，不换来任何能力。决策不变，但注释必须写事实。
 */

export const DOUBAO_ORIGIN = "https://www.doubao.com" as const

/** 唯一可用的翻译入口（SSE 流式，支持一次传多段）。 */
export const DOUBAO_STREAM_ARTICLE_PATH = "/samantha/plugin/stream_article_translate" as const
export const DOUBAO_STREAM_ARTICLE_URL = `${DOUBAO_ORIGIN}${DOUBAO_STREAM_ARTICLE_PATH}` as const

/** 鉴权探针：`code === 0` 即登录态有效。 */
export const DOUBAO_USER_SETTINGS_PATH = "/samantha/plugin/user_settings/get" as const
export const DOUBAO_USER_SETTINGS_URL =
  `${DOUBAO_ORIGIN}${DOUBAO_USER_SETTINGS_PATH}?frontend_source=1` as const

/** 免登录语言列表。 */
export const DOUBAO_LANGUAGE_LIST_PATH = "/samantha/plugin/translation/language_list" as const
export const DOUBAO_LANGUAGE_LIST_URL = `${DOUBAO_ORIGIN}${DOUBAO_LANGUAGE_LIST_PATH}` as const

/** 业务成功码。 */
export const DOUBAO_OK_CODE = 0 as const
/** 登录已过期，请重新登录。 */
export const DOUBAO_CODE_LOGIN_EXPIRED = 710012001 as const
/** 系统错误。`scene` 传成字符串时就是它。 */
export const DOUBAO_CODE_SYSTEM_ERROR = 710010202 as const
/** 插件层错误。同步版 translate 恒报此码；detect_lang 只在入参形状不对时报它。 */
export const DOUBAO_CODE_PLUGIN_ERROR = 710020202 as const
/**
 * SSE `event:err` 帧携带的插件错误码。
 *
 * 实测补充：`stream_article_translate` 的响应流里除了 `event:json` / `event:done`，
 * 还存在第三种事件 `event:err`。**只认 `json` 而忽略未知事件，等于把服务端错误
 * 静默吞掉** —— 现象是「翻译不出结果，但也不报错」。客户端必须显式处理它。
 */
export const DOUBAO_CODE_STREAM_ERROR = 710020702 as const

/* ──────────────────────────────
  SSE 事件名（`POST .../stream_article_translate` 的响应流）
  ────────────────────────────── */

/** 正常数据帧：`data` 是单行 JSON，含 `data.items[]`。 */
export const DOUBAO_SSE_EVENT_JSON = "json" as const
/** 流结束帧，`data` 为空。 */
export const DOUBAO_SSE_EVENT_DONE = "done" as const
/** 服务端错误帧：`data` 里带 `code` / `msg`，必须抛出而不是忽略。 */
export const DOUBAO_SSE_EVENT_ERR = "err" as const

/* ──────────────────────────────
  翻译引擎 translate_service
  ────────────────────────────── */

export const DOUBAO_ENGINES = ["0", "1", "3"] as const
export type DoubaoEngine = (typeof DOUBAO_ENGINES)[number]

export const DOUBAO_ENGINE_LABELS: Record<DoubaoEngine, string> = {
  "0": "火山引擎",
  "1": "豆包 AI",
  "3": "微软",
}

export const DOUBAO_ENGINE_DESCRIPTIONS: Record<DoubaoEngine, string> = {
  "0": "火山引擎机器翻译，速度最快，适合日常网页",
  "1": "豆包大模型驱动，论文与专业文档更准",
  "3": "微软翻译",
}

export function isDoubaoEngine(value: string): value is DoubaoEngine {
  return (DOUBAO_ENGINES as readonly string[]).includes(value)
}

/* ──────────────────────────────
  场景 scene —— 必须是数字
  ────────────────────────────── */

export const DOUBAO_SCENES = {
  /** 1 整页翻译 */
  page: 1,
  /** 2 AI 阅读器（官方默认推荐） */
  aiReader: 2,
  /** 3 划词翻译 */
  chooseWords: 3,
  /** 4 截图翻译 */
  screenshot: 4,
  /** 5 图片文字提取 */
  imageText: 5,
  /** 6 悬停翻译 */
  hover: 6,
} as const

export type DoubaoScene = (typeof DOUBAO_SCENES)[keyof typeof DOUBAO_SCENES]

export const DOUBAO_SCENE_LABELS: Record<DoubaoScene, string> = {
  1: "整页翻译",
  2: "AI 阅读器",
  3: "划词翻译",
  4: "截图翻译",
  5: "图片文字提取",
  6: "悬停翻译",
}

/** 未指定场景时的默认值：AI 阅读器。 */
export const DOUBAO_DEFAULT_SCENE: DoubaoScene = DOUBAO_SCENES.aiReader

export function isDoubaoScene(value: number): value is DoubaoScene {
  return (Object.values(DOUBAO_SCENES) as number[]).includes(value)
}

/**
 * 扩展功能 → 豆包场景。按功能语义固定映射，不暴露给用户改。
 *
 * 截图（4）与图片文字提取（5）不属于本扩展能力范围，故意不映射。
 */
export const DOUBAO_FEATURE_SCENES = {
  /** 整页翻译 */
  pageTranslation: DOUBAO_SCENES.page,
  /** 划词翻译工具条 */
  selectionTranslation: DOUBAO_SCENES.chooseWords,
  /** 输入框翻译 / AI 阅读器 */
  inputTranslation: DOUBAO_SCENES.aiReader,
  /** 悬停翻译 */
  hoverTranslation: DOUBAO_SCENES.hover,
  /** 视频字幕（批量长文本，走 AI 阅读器） */
  videoSubtitles: DOUBAO_SCENES.aiReader,
} as const

export type DoubaoFeature = keyof typeof DOUBAO_FEATURE_SCENES

/* ──────────────────────────────
  分批策略：单批 ≤ 10000 字符且 ≤ 50 段
  ────────────────────────────── */

export const DOUBAO_BATCH_MAX_CHARS = 10000 as const
export const DOUBAO_BATCH_MAX_ITEMS = 50 as const

/* ──────────────────────────────
  语言码（服务端 language_list 原样返回，四引擎一致）
  ────────────────────────────── */

export const DOUBAO_LANGS = [
  "en",
  "ar",
  "de",
  "es",
  "es-ES",
  "fil",
  "fr",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "pt",
  "ru",
  "th",
  "uz",
  "vi",
  "zh",
  "zh-Hant",
] as const

export type DoubaoLang = (typeof DOUBAO_LANGS)[number]

/** 扩展内部（ISO 639-1 系）语言码 → 豆包语言码。 */
const DOUBAO_LANG_ALIASES: Record<string, DoubaoLang> = {
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-sg": "zh",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-hant": "zh-Hant",
  "zh-mo": "zh-Hant",
  "pt-br": "pt",
  "pt-pt": "pt",
  "es-419": "es",
  "es-mx": "es",
  "es-es": "es-ES",
  fil: "fil",
  tl: "fil",
}

/**
 * 把扩展内部的 ISO 639-1 语言码规整成豆包语言码。
 * 返回 `null` 表示服务端不支持该目标语言 —— 由调用方抛错，绝不静默回退成别的语言。
 */
export function toDoubaoLang(code: string | undefined | null): DoubaoLang | null {
  if (!code) {
    return null
  }
  const raw = code.trim()
  if (raw === "") {
    return null
  }
  const exact = DOUBAO_LANGS.find((lang) => lang === raw)
  if (exact) {
    return exact
  }
  const lower = raw.toLowerCase()
  const alias = DOUBAO_LANG_ALIASES[lower]
  if (alias) {
    return alias
  }
  const caseInsensitive = DOUBAO_LANGS.find((lang) => lang.toLowerCase() === lower)
  if (caseInsensitive) {
    return caseInsensitive
  }
  const base = lower.split("-")[0]!
  const baseAlias = DOUBAO_LANG_ALIASES[base]
  if (baseAlias) {
    return baseAlias
  }
  return DOUBAO_LANGS.find((lang) => lang.toLowerCase() === base) ?? null
}

/* ──────────────────────────────
  三个翻译服务（provider 类型）
  ────────────────────────────── */

/**
 * 只保留三个翻译服务，与 `translate_service` 三个引擎一一对应。
 * 引擎由 provider 类型决定，用户不需要也不应该再单独配置。
 */
export const DOUBAO_PROVIDER_TYPES = ["doubao-huoshan", "doubao-llm", "doubao-microsoft"] as const

export type DoubaoProviderType = (typeof DOUBAO_PROVIDER_TYPES)[number]

export const DOUBAO_PROVIDER_ENGINE: Record<DoubaoProviderType, DoubaoEngine> = {
  "doubao-huoshan": "0",
  "doubao-llm": "1",
  "doubao-microsoft": "3",
}

export const DOUBAO_PROVIDER_LABELS: Record<DoubaoProviderType, string> = {
  "doubao-huoshan": "豆包翻译 · 火山引擎",
  "doubao-llm": "豆包翻译 · 豆包 AI",
  "doubao-microsoft": "豆包翻译 · 微软",
}

export const DOUBAO_PROVIDER_DESCRIPTIONS: Record<DoubaoProviderType, string> = {
  "doubao-huoshan": DOUBAO_ENGINE_DESCRIPTIONS["0"],
  "doubao-llm": DOUBAO_ENGINE_DESCRIPTIONS["1"],
  "doubao-microsoft": DOUBAO_ENGINE_DESCRIPTIONS["3"],
}

/** 默认翻译服务：豆包 AI（长文阅读质量最好）。 */
export const DOUBAO_DEFAULT_PROVIDER_TYPE: DoubaoProviderType = "doubao-llm"

export function isDoubaoProviderType(provider: string): provider is DoubaoProviderType {
  return (DOUBAO_PROVIDER_TYPES as readonly string[]).includes(provider)
}

/** provider 配置实例 id（写入 providersConfig 的稳定标识）。 */
export function getDoubaoProviderId(provider: DoubaoProviderType): `${DoubaoProviderType}-default` {
  return `${provider}-default`
}

export const DOUBAO_PROVIDER_IDS = DOUBAO_PROVIDER_TYPES.map(getDoubaoProviderId)

/* ──────────────────────────────
  Cookie
  ────────────────────────────── */

/** 字节 passport 体系的必需 Cookie（httpOnly，只能靠浏览器带）。 */
export const DOUBAO_REQUIRED_COOKIE_NAMES = [
  "sessionid",
  "sessionid_ss",
  "sid_tt",
  "sid_guard",
  "uid_tt",
  "uid_tt_ss",
  "sid_ucp_v1",
  "ssid_ucp_v1",
  "ttwid",
  "odin_tt",
  "multi_sids",
  "passport_csrf_token",
  "s_v_web_id",
] as const

/** 判定登录态是否成立的最小集合。 */
export const DOUBAO_LOGIN_COOKIE_NAMES = ["sessionid", "sid_tt", "uid_tt"] as const

export const DOUBAO_COOKIE_DOMAIN = "doubao.com" as const
export const DOUBAO_LOGIN_URL = `${DOUBAO_ORIGIN}/chat/` as const
