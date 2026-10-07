import type { FeatureKey } from "@/utils/constants/feature-providers"
import { storage } from "#imports"
import { mergeWithArrayOverwrite } from "@/utils/atoms/config"
import {
  DOUBAO_DEFAULT_PROVIDER_TYPE,
  DOUBAO_PROVIDER_TYPES,
  getDoubaoProviderId,
} from "@/utils/constants/doubao"
import {
  buildFeatureProviderPatch,
  FEATURE_KEYS,
  FEATURE_PROVIDER_DEFS,
} from "@/utils/constants/feature-providers"
import {
  DEFAULT_PROVIDER_CONFIG,
  GOOGLE_TRANSLATE_PROVIDER_ID,
  MICROSOFT_TRANSLATE_PROVIDER_ID,
} from "@/utils/constants/providers"
import { DOUBAO_ADOPTION_STORAGE_KEY } from "@/utils/constants/storage-keys"
import { logger } from "@/utils/logger"
import { getLocalConfigAndMeta, setLocalConfig } from "./storage"

const DOUBAO_DEFAULT_PROVIDER_ID = getDoubaoProviderId(DOUBAO_DEFAULT_PROVIDER_TYPE)

/**
 * read-frog 出厂自带的两个翻译服务。只有**仍然指向它们**的槽位才会被改指豆包 ——
 * 也就是「用户自己没动过这个选择」的槽位。用户手动选过别的 provider 的槽位一律不碰。
 */
const STOCK_TRANSLATE_PROVIDER_IDS: ReadonlySet<string> = new Set([
  MICROSOFT_TRANSLATE_PROVIDER_ID,
  GOOGLE_TRANSLATE_PROVIDER_ID,
])

/**
 * 让**已存在的用户**也用上豆包三个服务。
 *
 * 为什么需要这一步：`initializeConfig` 只在「没有存量配置」或「存量配置校验失败被重建」
 * 时才报告 `isFreshInstall`，而新装默认值只在那一刻写入。一个配置合法、此前一直在用
 * read-frog 的用户升级到本分支后，既不会走迁移（我们没动 schema 版本）、也不会走这条
 * 钩子 —— 结果是他的翻译仍然跑在微软/Google 上，而设置页里只列得出三个豆包服务，
 * 界面与实际行为对不上。
 *
 * 两个动作，都是加法或等价替换，都可重复执行：
 *   1. 配置里缺哪个豆包服务条目就补进去（这才是 `resolvePageTranslationProvider`
 *      抛 `No page translation provider` 的真正触发条件 —— 槽位指向一个不存在的条目）
 *   2. 仍停留在 read-frog 出厂默认的翻译槽位改指豆包 AI
 *
 * `noteSuggestion` 一类的 LLM 专属槽位会被跳过：豆包是纯翻译 provider，
 * `isLLMProvider` 对它为 false。
 *
 * 一次性由 `DOUBAO_ADOPTION_STORAGE_KEY` 保证，而不是每次启动都跑 —— 否则用户日后
 * 手工把配置改回别的 provider 也会被反复改回来。
 */
/**
 * 读取一次性标记。`null` 表示读不出来 —— 与「读到了 false」区分开：
 * 前者要放弃本次采用（连标记都读不到时不该去改用户的配置），后者才继续。
 */
async function isDoubaoAdoptionDone(): Promise<boolean | null> {
  try {
    return (await storage.getItem<boolean>(`local:${DOUBAO_ADOPTION_STORAGE_KEY}`)) === true
  } catch (error) {
    logger.warn("[Config] 读取豆包采用标记失败，本次跳过", error)
    return null
  }
}

export async function selectFreshTranslateProviders(): Promise<void> {
  const adopted = await isDoubaoAdoptionDone()
  if (adopted === null || adopted) {
    return
  }

  try {
    const { value: config } = await getLocalConfigAndMeta()
    let next = config
    let changed = false

    const existingIds = new Set(next.providersConfig.map((provider) => provider.id))
    const missingProviders = DOUBAO_PROVIDER_TYPES.map(
      (providerType) => DEFAULT_PROVIDER_CONFIG[providerType],
    ).filter((providerConfig) => !existingIds.has(providerConfig.id))

    if (missingProviders.length > 0) {
      next = {
        ...next,
        providersConfig: [...next.providersConfig, ...missingProviders],
      }
      changed = true
    }

    const assignments: Partial<Record<FeatureKey, string>> = {}
    for (const featureKey of FEATURE_KEYS) {
      const def = FEATURE_PROVIDER_DEFS[featureKey]
      // 能力不匹配的槽位直接跳过：豆包是纯翻译 provider，不是 LLM。
      if (!def.isProvider(DOUBAO_DEFAULT_PROVIDER_TYPE)) {
        continue
      }
      if (STOCK_TRANSLATE_PROVIDER_IDS.has(def.getProviderId(next))) {
        assignments[featureKey] = DOUBAO_DEFAULT_PROVIDER_ID
      }
    }

    if (Object.keys(assignments).length > 0) {
      next = mergeWithArrayOverwrite(next, buildFeatureProviderPatch(assignments))
      changed = true
    }

    if (changed) {
      await setLocalConfig(next)
      logger.info(
        `[Config] 已为存量配置启用豆包翻译服务（补种 ${missingProviders.length} 个条目，改指 ${Object.keys(assignments).length} 个槽位）`,
      )
    }

    await storage.setItem<boolean>(`local:${DOUBAO_ADOPTION_STORAGE_KEY}`, true)
  } catch (error) {
    // 不设标记：下次启动再试。用户配置此刻读不出来或写不进去，
    // 把标记落下会让这次采用永久丢失。
    logger.error("[Config] 为存量配置启用豆包服务失败，下次启动重试", error)
  }
}
