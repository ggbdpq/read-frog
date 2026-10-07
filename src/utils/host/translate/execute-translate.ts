import type { PromptResolver } from "./api/ai"
import type { Config } from "@/types/config/config"
import type { ProviderConfig } from "@/types/config/provider"
import type { TranslationTextFormat } from "@/types/config/translate"
import type { MatchedTerm } from "@/utils/glossary/types"
import { ISO6393_TO_6391, LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"
import { isLLMProviderConfig, isNonAPIProvider, isPureAPIProvider } from "@/types/config/provider"
import { DOUBAO_PROVIDER_ENGINE, isDoubaoProviderType } from "@/utils/constants/doubao"
import { getDoubaoCookie } from "@/utils/doubao-auth"
import { aiTranslate } from "./api/ai"
import { deeplTranslate } from "./api/deepl"
import { deeplxTranslate } from "./api/deeplx"
import { DoubaoApiError, doubaoTranslate } from "./api/doubao"
import { googleTranslate } from "./api/google"
import { microsoftTranslate } from "./api/microsoft"
import { prepareTranslationText } from "./text-preparation"
import { normalizeTranslationOutput } from "./translation-output-normalization"

/** 豆包未登录时的统一错误文案（中文，且给出可执行的下一步）。 */
export const DOUBAO_NOT_LOGGED_IN_MESSAGE =
  "未登录豆包账号：请打开扩展的「豆包账号」页登录 www.doubao.com，或在该页粘贴导入 Cookie 后重试。"

export async function executeTranslate<TContext>(
  text: string,
  langConfig: Config["language"],
  providerConfig: ProviderConfig,
  promptResolver: PromptResolver<TContext>,
  options?: {
    isBatch?: boolean
    context?: TContext
    textFormat?: TranslationTextFormat
    // Only Google needs protection: its translateHtml transport collapses
    // "\n" as HTML whitespace. Microsoft preserves newlines in both textTypes
    // (live-verified); LLM prompts already mandate format preservation.
    preserveLineBreaks?: boolean
    signal?: AbortSignal
    glossaryTerms?: readonly MatchedTerm[]
    /**
     * 豆包 `scene`，**必须是数字**（1–6）。只对豆包三个 provider 有效，未指定时
     * 由客户端退到 `DOUBAO_DEFAULT_SCENE`（AI 阅读器）。悬停翻译跑在划词通道上，
     * 必须显式传 6，否则推导出来是 3。
     */
    doubaoScene?: number
  },
) {
  const preparedText = prepareTranslationText(text)
  if (preparedText === "") {
    return ""
  }

  const { provider } = providerConfig
  let translatedText = ""

  if (isNonAPIProvider(provider)) {
    const sourceLang =
      langConfig.sourceCode === "auto" ? "auto" : (ISO6393_TO_6391[langConfig.sourceCode] ?? "auto")
    const targetLang = ISO6393_TO_6391[langConfig.targetCode]
    if (!targetLang) {
      throw new Error(`Invalid target language code: ${langConfig.targetCode}`)
    }
    if (provider === "google-translate") {
      translatedText = await googleTranslate(preparedText, sourceLang, targetLang, {
        textFormat: options?.textFormat,
        preserveLineBreaks: options?.preserveLineBreaks,
        signal: options?.signal,
      })
    } else if (provider === "microsoft-translate") {
      translatedText = await microsoftTranslate(preparedText, sourceLang, targetLang, {
        textFormat: options?.textFormat,
        signal: options?.signal,
      })
    }
  } else if (isPureAPIProvider(provider)) {
    const sourceLang =
      langConfig.sourceCode === "auto" ? "auto" : (ISO6393_TO_6391[langConfig.sourceCode] ?? "auto")
    const targetLang = ISO6393_TO_6391[langConfig.targetCode]
    if (!targetLang) {
      throw new Error(`Invalid target language code: ${langConfig.targetCode}`)
    }
    if (provider === "deeplx") {
      translatedText = await deeplxTranslate(preparedText, sourceLang, targetLang, providerConfig, {
        textFormat: options?.textFormat,
        signal: options?.signal,
      })
    } else if (provider === "deepl") {
      translatedText = await deeplTranslate(text, sourceLang, targetLang, providerConfig, {
        textFormat: options?.textFormat,
        signal: options?.signal,
      })
    } else if (isDoubaoProviderType(provider)) {
      // 引擎由 provider 类型决定（火山 / 豆包 AI / 微软），用户不需要也不应该再配置。
      // Cookie 优先取已保存/可回读的那份（导入通道用它），浏览器里请求仍会通过
      // `credentials: "include"` 自动带上 jar 里的 httpOnly 登录态。
      const cookie = await getDoubaoCookie()
      // 只有在浏览器不可能自动补 Cookie 的环境里才因为「空 Cookie」快速失败。
      // 在真实扩展里，空串可能只是「本地配置没存」——jar 里其实有登录态，拦下来
      // 会把能用的翻译弄坏。Node / 测试环境则相反：没有显式 Cookie 必然 710012001。
      if (cookie === "" && typeof document === "undefined") {
        throw new DoubaoApiError(DOUBAO_NOT_LOGGED_IN_MESSAGE)
      }
      translatedText = await doubaoTranslate(preparedText, targetLang, {
        engine: DOUBAO_PROVIDER_ENGINE[provider],
        scene: options?.doubaoScene,
        cookie,
        textFormat: options?.textFormat,
        signal: options?.signal,
      })
    }
  } else if (isLLMProviderConfig(providerConfig)) {
    const targetLangName = LANG_CODE_TO_EN_NAME[langConfig.targetCode]
    translatedText = await aiTranslate(
      preparedText,
      targetLangName,
      providerConfig,
      promptResolver,
      options,
    )
  } else {
    throw new Error(`Unknown provider: ${provider}`)
  }

  return normalizeTranslationOutput(providerConfig, translatedText).trim()
}
