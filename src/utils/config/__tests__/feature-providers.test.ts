import type { ProviderConfig } from "@/types/config/provider"
import type { HostedAiStatus, HostedAiTierStatus } from "@/utils/hosted-ai/types"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { buildFeatureProviderPatch } from "@/utils/constants/feature-providers"
import { DEFAULT_PROVIDER_CONFIG } from "@/utils/constants/providers"
import { isSystemProviderSelectorItem } from "@/utils/providers/provider-display"
import {
  BUILT_IN_AI_PROVIDER_LOGO,
  getSelectableProvidersForCapability,
} from "@/utils/providers/provider-registry"
import {
  computeLanguageDetectionFallbackAfterDeletion,
  computeProviderFallbacksAfterDeletion,
  computeSelectionToolbarCustomActionFallbacksAfterDeletion,
  findFeatureMissingProvider,
  resolveLanguageDetectionConfigForModeChange,
} from "../helpers"

/**
 * 二次开发后新装 profile 里只剩下三个豆包（纯翻译）provider，但本文件大量用例描述的
 * 是「有多个本地 provider / 有 LLM provider 时如何挑候选人」的行为 —— 那些 provider
 * 仍然合法存在，只是不再默认播种。所以这里按类型直接取默认配置，用例语义不变。
 */
function getProviderById(id: string): ProviderConfig {
  const fromDefaultConfig = DEFAULT_CONFIG.providersConfig.find((item) => item.id === id)
  if (fromDefaultConfig) {
    return fromDefaultConfig
  }
  const seeded = Object.values(DEFAULT_PROVIDER_CONFIG).find((item) => item.id === id)
  if (!seeded) throw new Error(`Provider "${id}" not found in DEFAULT_CONFIG.providersConfig`)
  return seeded
}

/**
 * 语言识别（LLM 模式）只能在**带模型的** provider 上成立，而新装 profile 里三个豆包
 * 都是纯翻译 provider。这里显式补上原来默认播种过的那批，用例语义保持不变。
 */
const providersWithLLM: ProviderConfig[] = [
  ...DEFAULT_CONFIG.providersConfig,
  DEFAULT_PROVIDER_CONFIG.openai,
  DEFAULT_PROVIDER_CONFIG.jalapenocloud,
]

/** Every hosted feature reporting the same verdict on both tiers. */
function statusWithAllTiers(tier: HostedAiTierStatus): HostedAiStatus {
  const entry = { normal: tier, advance: tier }
  return {
    credits: [],
    features: {
      pageTranslation: entry,
      customAction: entry,
      noteSuggestion: entry,
      selectionTranslation: entry,
      videoSubtitles: entry,
      inputTranslation: entry,
      languageDetection: entry,
    },
  }
}

describe("feature providers", () => {
  describe("buildFeatureProviderPatch", () => {
    it("builds patch for a single feature assignment", () => {
      const patch = buildFeatureProviderPatch({
        pageTranslation: "openai-default",
      })

      expect(patch).toEqual({
        pageTranslation: {
          providerId: "openai-default",
        },
      })
    })

    it("builds patch for the note suggestion feature", () => {
      const patch = buildFeatureProviderPatch({
        noteSuggestion: "read-frog-free-ai",
      })

      expect(patch).toEqual({
        selectionToolbar: {
          noteSuggestion: {
            providerId: "read-frog-free-ai",
          },
        },
      })
    })

    it("builds patch for multiple feature assignments", () => {
      const patch = buildFeatureProviderPatch({
        pageTranslation: "google-translate-default",
        selectionTranslation: "openai-default",
      })

      expect(patch).toEqual({
        pageTranslation: {
          providerId: "google-translate-default",
        },
        selectionToolbar: {
          features: {
            translate: {
              providerId: "openai-default",
            },
          },
        },
      })
    })
  })

  describe("getSelectableProvidersForCapability", () => {
    it("marks registry-backed system providers for selector grouping", () => {
      const providers = getSelectableProvidersForCapability("customAction", [])

      expect(providers).toEqual([
        expect.objectContaining({
          kind: "system",
          id: "read-frog-free-ai",
          logo: expect.any(Function),
        }),
        expect.objectContaining({
          kind: "system",
          id: "read-frog-advance-ai",
          logo: expect.any(Function),
        }),
      ])

      const builtInAiProvider = providers[0]
      expect(builtInAiProvider && isSystemProviderSelectorItem(builtInAiProvider)).toBe(true)
      if (!builtInAiProvider || !isSystemProviderSelectorItem(builtInAiProvider)) {
        throw new Error("Built-in AI provider selector item was not returned")
      }
      expect(builtInAiProvider.logo("light")).toBe(BUILT_IN_AI_PROVIDER_LOGO)
    })
  })

  describe("computeProviderFallbacksAfterDeletion", () => {
    it("returns fallback assignments for every affected feature when candidates exist", () => {
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          providerId: "deleted-provider",
        },
        videoSubtitles: {
          ...DEFAULT_CONFIG.videoSubtitles,
          providerId: "deleted-provider",
        },
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          features: {
            ...DEFAULT_CONFIG.selectionToolbar.features,
            translate: { enabled: true, providerId: "deleted-provider", shortcut: "Alt+T" },
          },
        },
        inputTranslation: {
          ...DEFAULT_CONFIG.inputTranslation,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders = [
        getProviderById("google-translate-default"),
        getProviderById("openai-default"),
      ]

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(fallbacks).toEqual({
        pageTranslation: "google-translate-default",
        videoSubtitles: "google-translate-default",
        selectionTranslation: "google-translate-default",
        inputTranslation: "google-translate-default",
      })
    })

    it("keeps a fresh profile on a seeded provider when it deletes its page-translation provider in translationOnly mode", () => {
      // translationOnly page mode needs a provider that preserves markup, and every
      // provider a fresh profile seeds now goes through the doubao plain-text endpoint
      // (translation-only-gate.ts). The picker hides those while the mode is active, so
      // the fallback must at least land on an id that still EXISTS in providersConfig —
      // falling back to a provider the config does not contain is what made the selector
      // crash. The gate is not consulted by the fallback, so this only pins the ids.
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          mode: "translationOnly" as const,
          providerId: "deleted-provider",
        },
      }

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        DEFAULT_CONFIG.providersConfig,
      )

      expect(DEFAULT_CONFIG.providersConfig.map((provider) => provider.id)).toContain(
        fallbacks.pageTranslation,
      )
    })

    it("uses the system Normal tier when page translation has no local fallback", () => {
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders: ProviderConfig[] = []

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(fallbacks.pageTranslation).toBe("read-frog-free-ai")
    })

    it("skips disabled local providers before using the system Normal tier", () => {
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders = [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
      ]

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(fallbacks.pageTranslation).toBe("read-frog-free-ai")
    })

    it("falls back to the system Normal tier for selection toolbar translation when no local provider is available", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          features: {
            ...DEFAULT_CONFIG.selectionToolbar.features,
            translate: { enabled: true, providerId: "deleted-provider", shortcut: "Alt+T" },
          },
        },
      }

      const fallbacks = computeProviderFallbacksAfterDeletion("deleted-provider", config, [])

      expect(fallbacks).toEqual({ selectionTranslation: "read-frog-free-ai" })
    })

    it("falls back to the system Normal tier for note suggestion when no local llm provider remains", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          noteSuggestion: {
            ...DEFAULT_CONFIG.selectionToolbar.noteSuggestion,
            providerId: "deleted-provider",
          },
        },
      }

      const fallbacks = computeProviderFallbacksAfterDeletion("deleted-provider", config, [
        getProviderById("google-translate-default"),
      ])

      expect(fallbacks).toEqual({ noteSuggestion: "read-frog-free-ai" })
    })
  })

  describe("findFeatureMissingProvider", () => {
    // Built-in AI declares every FEATURE_KEYS capability and is synthesized by
    // the registry rather than stored in providersConfig. With no status to
    // judge them by, they count as usable — so deleting local providers cannot
    // report a feature missing. These cases used to report videoSubtitles
    // missing; that was only true while the built-ins lacked the capability.
    // The status-aware cases below cover when they do not count.
    it("returns null even with no local providers left", () => {
      const remainingProviders: ProviderConfig[] = []

      expect(findFeatureMissingProvider(remainingProviders)).toBeNull()
    })

    it("returns null when all features have at least one compatible provider", () => {
      const remainingProviders = [getProviderById("google-translate-default")]

      expect(findFeatureMissingProvider(remainingProviders)).toBeNull()
    })

    it("does not report a feature missing just because every local provider is disabled", () => {
      const remainingProviders = [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
      ]

      expect(findFeatureMissingProvider(remainingProviders)).toBeNull()
    })

    it("keeps llm language detection available on Built-in AI alone", () => {
      // Deleting the last BYOK LLM used to force detection back to basic. It
      // no longer does: the built-ins declare the languageDetection capability,
      // so a hosted provider is always a legal target.
      const config = {
        ...DEFAULT_CONFIG,
        languageDetection: {
          mode: "llm" as const,
          providerId: "deleted-provider",
        },
      }
      const remainingProviders = [getProviderById("google-translate-default")]

      expect(findFeatureMissingProvider(remainingProviders, config)).toBeNull()
    })

    // The built-ins are in every capability list, so "a provider exists" is
    // always true and cannot gate anything. Judged against a status that walls
    // them off, the guard becomes able to fire again.
    describe("when the account cannot run Built-in AI", () => {
      const walledOffTier: HostedAiTierStatus = {
        accessAllowed: true,
        available: false,
        unavailableReason: "ultra_required",
        requiresUltra: true,
        modelRevision: "r1",
      }
      const walledOff = statusWithAllTiers(walledOffTier)

      it("reports the first feature left with nothing that can run it", () => {
        expect(findFeatureMissingProvider([], DEFAULT_CONFIG, walledOff)).toBe("pageTranslation")
      })

      it("stays null while a local provider still covers every feature", () => {
        // Keyless translate providers cover the translation features, so a free
        // account deleting its last LLM key is not left with nothing.
        const remainingProviders = [
          getProviderById("google-translate-default"),
          getProviderById("openai-default"),
        ]

        expect(findFeatureMissingProvider(remainingProviders, DEFAULT_CONFIG, walledOff)).toBeNull()
      })

      it("reports the LLM-only feature when only keyless translate providers remain", () => {
        // Google/Microsoft cover the four translate features; note suggestion
        // needs an LLM, so it is what the guard trips on.
        const remainingProviders = [
          getProviderById("google-translate-default"),
          getProviderById("microsoft-translate-default"),
        ]

        expect(findFeatureMissingProvider(remainingProviders, DEFAULT_CONFIG, walledOff)).toBe(
          "noteSuggestion",
        )
      })

      it("guards a feature the user has switched off, because its providerId is still stored", () => {
        // computeProviderFallbacksAfterDeletion can only reassign a slot when a
        // replacement exists. Letting this through would leave
        // noteSuggestion.providerId pointing at a provider that no longer
        // exists, which resolves to null the moment it is switched back on.
        const config = {
          ...DEFAULT_CONFIG,
          selectionToolbar: {
            ...DEFAULT_CONFIG.selectionToolbar,
            noteSuggestion: { ...DEFAULT_CONFIG.selectionToolbar.noteSuggestion, enabled: false },
          },
        }
        const remainingProviders = [
          getProviderById("google-translate-default"),
          getProviderById("microsoft-translate-default"),
        ]

        expect(findFeatureMissingProvider(remainingProviders, config, walledOff)).toBe(
          "noteSuggestion",
        )
      })

      it("reports languageDetection when only its own tier is walled off", () => {
        // Reachable only because funding is per feature: an LLM provider covers
        // note suggestion, and the built-ins cover it too, while hosted
        // languageDetection is the one tier this account cannot run.
        const languageDetectionWalledOff = statusWithAllTiers({
          accessAllowed: true,
          available: true,
          unavailableReason: null,
          requiresUltra: false,
          modelRevision: "r1",
        })
        languageDetectionWalledOff.features.languageDetection = {
          normal: walledOffTier,
          advance: walledOffTier,
        }
        const config = {
          ...DEFAULT_CONFIG,
          languageDetection: { mode: "llm" as const, providerId: "deleted-provider" },
        }

        expect(findFeatureMissingProvider([], config, languageDetectionWalledOff)).toBe(
          "languageDetection",
        )
      })

      it("does not fire on a merely exhausted quota", () => {
        // Transient: the account can run Built-in AI, just not this minute.
        const exhausted = statusWithAllTiers({
          accessAllowed: true,
          available: false,
          unavailableReason: "quota_exhausted",
          requiresUltra: false,
          modelRevision: "r1",
        })

        expect(findFeatureMissingProvider([], DEFAULT_CONFIG, exhausted)).toBeNull()
      })
    })
  })

  describe("computeSelectionToolbarCustomActionFallbacksAfterDeletion", () => {
    it("reassigns the built-in Dictionary provider without changing custom actions", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          builtInActions: {
            ...DEFAULT_CONFIG.selectionToolbar.builtInActions,
            dictionary: {
              ...DEFAULT_CONFIG.selectionToolbar.builtInActions.dictionary,
              providerId: "deleted-provider",
            },
          },
        },
      }

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        [getProviderById("jalapenocloud-default")],
      )

      expect(result?.builtInActions.dictionary.providerId).toBe("jalapenocloud-default")
      expect(result?.customActions).toEqual([])
    })

    it("reassigns the built-in Sentence Analysis provider and leaves the Dictionary's", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          builtInActions: {
            ...DEFAULT_CONFIG.selectionToolbar.builtInActions,
            sentenceAnalysis: { enabled: false, providerId: "deleted-provider" },
          },
        },
      }

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        [getProviderById("jalapenocloud-default")],
      )

      expect(result?.builtInActions).toEqual({
        dictionary: DEFAULT_CONFIG.selectionToolbar.builtInActions.dictionary,
        sentenceAnalysis: {
          enabled: false,
          providerId: "jalapenocloud-default",
          notebaseConnection: undefined,
        },
        improveWriting: DEFAULT_CONFIG.selectionToolbar.builtInActions.improveWriting,
      })
    })

    it("reassigns affected custom actions to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          customActions: [
            {
              id: "action-a",
              name: "Action A",
              enabled: true,
              icon: "tabler:sparkles",
              providerId: "deleted-provider",
              systemPrompt: "",
              prompt: "{{selection}}",
              outputSchema: [
                {
                  id: "field-a",
                  name: "summary",
                  type: "string" as const,
                  description: "",
                },
              ],
            },
          ],
        },
      }

      const remainingProviders = [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
        getProviderById("jalapenocloud-default"),
      ]

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(result?.customActions).toEqual([
        expect.objectContaining({
          id: "action-a",
          providerId: "jalapenocloud-default",
        }),
      ])
    })

    it("falls back to built-in AI when no enabled llm provider is available", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          customActions: [
            {
              id: "action-a",
              name: "Action A",
              enabled: true,
              icon: "tabler:sparkles",
              providerId: "deleted-provider",
              systemPrompt: "",
              prompt: "{{selection}}",
              outputSchema: [
                {
                  id: "field-a",
                  name: "summary",
                  type: "string" as const,
                  description: "",
                },
              ],
            },
          ],
        },
      }

      const remainingProviders = [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
      ]

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(result?.customActions).toEqual([
        expect.objectContaining({
          id: "action-a",
          providerId: "read-frog-free-ai",
        }),
      ])
    })
  })

  describe("resolveLanguageDetectionConfigForModeChange", () => {
    it("assigns the first enabled llm provider when switching from basic to llm", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        DEFAULT_CONFIG.languageDetection,
        "llm",
        providersWithLLM,
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: "openai-default",
      })
    })

    it("keeps the current provider when it is already an enabled llm provider", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        {
          mode: "basic",
          providerId: "jalapenocloud-default",
        },
        "llm",
        providersWithLLM,
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: "jalapenocloud-default",
      })
    })

    it("falls back to Built-in AI when no enabled local llm provider remains", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        DEFAULT_CONFIG.languageDetection,
        "llm",
        [
          {
            ...getProviderById("openai-default"),
            enabled: false,
          },
          {
            ...getProviderById("jalapenocloud-default"),
            enabled: false,
          },
        ],
      )

      // Switching to llm mode used to be impossible without a BYOK LLM. Built-in
      // AI is always capability-compatible, so the mode is now always reachable
      // and seeds itself with the hosted provider.
      expect(result).toEqual({ mode: "llm", providerId: "read-frog-free-ai" })
    })
  })

  describe("computeLanguageDetectionFallbackAfterDeletion", () => {
    it("reassigns language detection to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        languageDetection: {
          mode: "llm" as const,
          providerId: "deleted-provider",
        },
      }

      const result = computeLanguageDetectionFallbackAfterDeletion("deleted-provider", config, [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
        getProviderById("jalapenocloud-default"),
      ])

      expect(result).toBe("jalapenocloud-default")
    })
  })
})
