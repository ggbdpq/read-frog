import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { DOUBAO_DEFAULT_PROVIDER_TYPE, DOUBAO_PROVIDER_TYPES } from "@/utils/constants/doubao"
import { GOOGLE_TRANSLATE_PROVIDER_ID } from "@/utils/constants/providers"
import {
  getTranslationOnlyBlockedReason,
  providerSupportsTranslationOnlyMode,
} from "../translation-only-gate"

// `@/utils/i18n` is globally mocked to echo the key, so the reason's wording is
// unassertable here — only whether one is produced. The rendered sentence is
// verified in the browser.

describe("providerSupportsTranslationOnlyMode", () => {
  it("refuses the providers whose endpoint cannot preserve markup", () => {
    expect(providerSupportsTranslationOnlyMode("microsoft-translate")).toBe(false)
  })

  it("refuses every doubao service — no evidence the plain-text endpoint keeps markers", () => {
    for (const provider of DOUBAO_PROVIDER_TYPES) {
      expect(providerSupportsTranslationOnlyMode(provider)).toBe(false)
    }
  })

  it("allows every provider not on that list", () => {
    expect(providerSupportsTranslationOnlyMode("google-translate")).toBe(true)
    expect(providerSupportsTranslationOnlyMode("deeplx")).toBe(true)
  })
})

describe("getTranslationOnlyBlockedReason", () => {
  it("blocks a fresh profile, which now ships on the doubao default service", () => {
    expect(DOUBAO_PROVIDER_TYPES).toContain(DOUBAO_DEFAULT_PROVIDER_TYPE)
    expect(getTranslationOnlyBlockedReason(DEFAULT_CONFIG)).not.toBeNull()
  })

  it("blocks all three doubao services when assigned to page translation", () => {
    for (const providerId of DEFAULT_CONFIG.providersConfig.map((provider) => provider.id)) {
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: { ...DEFAULT_CONFIG.pageTranslation, providerId },
      }

      expect(getTranslationOnlyBlockedReason(config)).not.toBeNull()
    }
  })

  it("clears once page translation moves to a provider that keeps markup", () => {
    const config = {
      ...DEFAULT_CONFIG,
      // google-translate is no longer seeded into a fresh profile, so it has to
      // be registered by hand for this case to be about the gate and not about
      // a missing provider.
      providersConfig: [
        ...DEFAULT_CONFIG.providersConfig,
        {
          id: GOOGLE_TRANSLATE_PROVIDER_ID,
          name: "Google Translate",
          enabled: true,
          provider: "google-translate" as const,
        },
      ],
      pageTranslation: {
        ...DEFAULT_CONFIG.pageTranslation,
        providerId: GOOGLE_TRANSLATE_PROVIDER_ID,
      },
    }

    expect(getTranslationOnlyBlockedReason(config)).toBeNull()
  })

  it("stays out of the way when the assigned provider no longer exists", () => {
    const config = {
      ...DEFAULT_CONFIG,
      pageTranslation: { ...DEFAULT_CONFIG.pageTranslation, providerId: "deleted-provider" },
    }

    expect(getTranslationOnlyBlockedReason(config)).toBeNull()
  })
})
