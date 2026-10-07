/**
 * 豆包账号登录态（Cookie 串 + 探针结果）。local，而不是 session ——
 * service worker 每次被回收都会重启，session 存储会把用户刚导入的登录态丢掉。
 */
export const DOUBAO_AUTH_STORAGE_KEY = "doubaoAuth" as const

/**
 * 一次性标记：已经为**已存在的用户**做过豆包服务采用（补种服务条目 + 把仍停留在
 * read-frog 出厂默认的翻译槽位改指豆包）。
 *
 * 用标记而不是 schema 版本迁移，是因为迁移链是硬约束：`buildMigrationRegistry`
 * 要求 v1→最新**连续无断链**，一断就是整份配置加载失败。而这个采用过程是幂等的、
 * 只读一次配置的轻量操作，不值得为它承担那条链的风险。
 */
export const DOUBAO_ADOPTION_STORAGE_KEY = "doubaoAdoption" as const

export const TRANSLATION_STATE_KEY_PREFIX = "session:translationState" as const

export function getTranslationStateKey(tabId: number): `session:translationState.${number}` {
  return `${TRANSLATION_STATE_KEY_PREFIX}.${tabId}` as const
}

export function parseTabIdFromStorageKey(key: string): number {
  const parts = key.split(".")
  return Number.parseInt(parts[1] ?? "", 10)
}

export const DETECTED_CODE_STATE_KEY_PREFIX = "session:detectedCode" as const

export function getDetectedCodeStateKey(tabId: number): `session:detectedCode.${number}` {
  return `${DETECTED_CODE_STATE_KEY_PREFIX}.${tabId}` as const
}
