import type { Config } from "@/types/config/config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG, DEFAULT_TRANSLATE_PROVIDER_ID } from "@/utils/constants/config"
import { DOUBAO_PROVIDER_IDS, DOUBAO_PROVIDER_TYPES } from "@/utils/constants/doubao"
import {
  DEFAULT_PROVIDER_CONFIG,
  GOOGLE_TRANSLATE_PROVIDER_ID,
  MICROSOFT_TRANSLATE_PROVIDER_ID,
} from "@/utils/constants/providers"
import { DOUBAO_ADOPTION_STORAGE_KEY } from "@/utils/constants/storage-keys"

const storageGetItemMock = vi.fn<(...args: any[]) => any>()
const storageSetItemMock = vi.fn<(...args: any[]) => any>()
const getLocalConfigAndMetaMock = vi.fn<(...args: any[]) => any>()
const setLocalConfigMock = vi.fn<(...args: any[]) => any>()

vi.mock("#imports", () => ({
  storage: {
    getItem: storageGetItemMock,
    setItem: storageSetItemMock,
  },
}))

// 必须两个都 mock：WXT 把 `#imports` 解析成一个具体模块路径，只 mock `#imports`
// 拦不住源码里的那次导入，写入会落到真实的（内存）存储上 —— 于是第一个用例把
// 「已采用」标记真写下去，后面的用例全部读到 true 而提前返回，其中「读标记为 true
// 就不读配置」那条还会因此**假绿**。`init.test.ts` 用的是同一套双 mock。
vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: storageGetItemMock,
    setItem: storageSetItemMock,
  },
}))

vi.mock("../storage", () => ({
  getLocalConfigAndMeta: getLocalConfigAndMetaMock,
  setLocalConfig: setLocalConfigMock,
}))

function translateProviderIdsOf(config: Config) {
  return [
    config.pageTranslation.providerId,
    config.selectionToolbar.features.translate.providerId,
    config.inputTranslation.providerId,
    config.videoSubtitles.providerId,
  ]
}

/**
 * 一个「升级前」的存量配置：服务列表是 read-frog 出厂的那几个，翻译槽位停在微软默认，
 * 里面**没有**任何豆包条目 —— 这正是升级到本分支后需要被采用的形态。
 */
function buildPreUpgradeConfig(): Config {
  const config = structuredClone(DEFAULT_CONFIG)
  config.providersConfig = [
    DEFAULT_PROVIDER_CONFIG["google-translate"],
    DEFAULT_PROVIDER_CONFIG["microsoft-translate"],
    DEFAULT_PROVIDER_CONFIG.openai,
    DEFAULT_PROVIDER_CONFIG.deepseek,
  ]
  config.pageTranslation.providerId = MICROSOFT_TRANSLATE_PROVIDER_ID
  config.selectionToolbar.features.translate.providerId = GOOGLE_TRANSLATE_PROVIDER_ID
  config.inputTranslation.providerId = MICROSOFT_TRANSLATE_PROVIDER_ID
  config.videoSubtitles.providerId = MICROSOFT_TRANSLATE_PROVIDER_ID
  return config
}

async function runAdoption() {
  const { selectFreshTranslateProviders } = await import("../default-translate-provider")
  await selectFreshTranslateProviders()
}

function writtenConfig(): Config {
  return setLocalConfigMock.mock.calls[0]?.[0] as Config
}

describe("存量配置的豆包采用（selectFreshTranslateProviders）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageGetItemMock.mockResolvedValue(undefined)
    storageSetItemMock.mockResolvedValue(undefined)
    getLocalConfigAndMetaMock.mockResolvedValue({
      value: buildPreUpgradeConfig(),
      meta: { schemaVersion: 101, lastModifiedAt: 100 },
    })
    setLocalConfigMock.mockResolvedValue(undefined)
  })

  it("补种缺失的三个豆包服务条目", async () => {
    await runAdoption()

    const providers = writtenConfig().providersConfig.map((provider) => provider.id)
    for (const providerId of DOUBAO_PROVIDER_IDS) {
      expect(providers).toContain(providerId)
    }
    // 用户原有的服务一个都不能丢。
    for (const providerId of [
      GOOGLE_TRANSLATE_PROVIDER_ID,
      MICROSOFT_TRANSLATE_PROVIDER_ID,
      DEFAULT_PROVIDER_CONFIG.openai.id,
    ]) {
      expect(providers).toContain(providerId)
    }
  })

  it("把仍停留在出厂默认的翻译槽位改指豆包", async () => {
    await runAdoption()

    expect(translateProviderIdsOf(writtenConfig())).toEqual([
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
    ])
  })

  it("用户自己选过的 provider 一律不碰", async () => {
    const config = buildPreUpgradeConfig()
    config.pageTranslation.providerId = DEFAULT_PROVIDER_CONFIG.openai.id
    getLocalConfigAndMetaMock.mockResolvedValue({
      value: config,
      meta: { schemaVersion: 101, lastModifiedAt: 100 },
    })

    await runAdoption()

    // 用户的选择保住；其余仍是出厂默认的槽位才被改指豆包。
    expect(translateProviderIdsOf(writtenConfig())).toEqual([
      DEFAULT_PROVIDER_CONFIG.openai.id,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
    ])
  })

  it("跳过 LLM 专属槽位：豆包是纯翻译 provider，不是 LLM", async () => {
    const config = buildPreUpgradeConfig()
    // 笔记建议只接受 LLM provider；即便它指向一个已经不存在的 id，也不该被改指豆包。
    config.selectionToolbar.noteSuggestion.providerId = "openai-default"
    getLocalConfigAndMetaMock.mockResolvedValue({
      value: config,
      meta: { schemaVersion: 101, lastModifiedAt: 100 },
    })

    await runAdoption()

    expect(writtenConfig().selectionToolbar.noteSuggestion.providerId).toBe("openai-default")
  })

  it("已经是全豆包配置时不写配置，只落标记", async () => {
    getLocalConfigAndMetaMock.mockResolvedValue({
      value: structuredClone(DEFAULT_CONFIG),
      meta: { schemaVersion: 101, lastModifiedAt: 100 },
    })

    await runAdoption()

    expect(setLocalConfigMock).not.toHaveBeenCalled()
    expect(storageSetItemMock).toHaveBeenCalledWith(`local:${DOUBAO_ADOPTION_STORAGE_KEY}`, true)
  })

  it("采用完成后落一次性标记，之后不再读配置", async () => {
    storageGetItemMock.mockResolvedValue(true)

    await runAdoption()

    expect(getLocalConfigAndMetaMock).not.toHaveBeenCalled()
    expect(setLocalConfigMock).not.toHaveBeenCalled()
  })

  it("配置读取失败时不落标记，下次启动重试", async () => {
    getLocalConfigAndMetaMock.mockRejectedValue(new Error("no config"))

    await runAdoption()

    expect(setLocalConfigMock).not.toHaveBeenCalled()
    expect(storageSetItemMock).not.toHaveBeenCalledWith(
      `local:${DOUBAO_ADOPTION_STORAGE_KEY}`,
      true,
    )
  })

  it("写入失败时不落标记，下次启动重试", async () => {
    setLocalConfigMock.mockRejectedValue(new Error("schema rejected"))

    await runAdoption()

    expect(storageSetItemMock).not.toHaveBeenCalledWith(
      `local:${DOUBAO_ADOPTION_STORAGE_KEY}`,
      true,
    )
  })

  it("新装默认配置本身就是全豆包，无需采用", async () => {
    expect(DEFAULT_CONFIG.providersConfig.map((provider) => provider.provider)).toEqual([
      ...DOUBAO_PROVIDER_TYPES,
    ])
    expect(translateProviderIdsOf(DEFAULT_CONFIG)).toEqual([
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
      DEFAULT_TRANSLATE_PROVIDER_ID,
    ])
  })
})
