import { describe, expect, it } from "vitest"
import {
  getAllLanguageItems,
  getTargetLanguageItems,
  isDoubaoTranslatableLanguage,
} from "../language-combobox-options"

/**
 * 二次开发后只剩豆包三个服务，而豆包只认 19 种目标语言。让用户选到一个必然失败的
 * 目标语言是真实的产品缺陷，所以目标侧列表被裁剪过；源侧必须保持全量，否则
 * 「用土耳其语写的一页翻成中文」这种组合会被误锁。
 */
describe("doubao target-language filtering", () => {
  it("keeps the shipped default target language selectable", () => {
    // `cmn` is what `DEFAULT_CONFIG.language.targetCode` holds. It has to go through
    // ISO6393_TO_6391 before the doubao check, or the default itself disappears.
    expect(isDoubaoTranslatableLanguage("cmn")).toBe(true)
    expect(getTargetLanguageItems().some((item) => item.value === "cmn")).toBe(true)
  })

  it("drops languages the doubao backend cannot produce", () => {
    // These map to ISO 639-1 codes (`tr`, `hi`, `pl`) that are absent from DOUBAO_LANGS.
    expect(isDoubaoTranslatableLanguage("tur")).toBe(false)
    expect(isDoubaoTranslatableLanguage("hin")).toBe(false)
    expect(isDoubaoTranslatableLanguage("pol")).toBe(false)
  })

  it("offers every supported language on the target side and nothing else", () => {
    const targets = getTargetLanguageItems()
    const all = getAllLanguageItems()

    // A mapping mistake would empty the list or overshoot the 19 doubao languages.
    expect(targets.length).toBeGreaterThanOrEqual(15)
    expect(targets.length).toBeLessThan(all.length)
    expect(targets.every((item) => isDoubaoTranslatableLanguage(item.value))).toBe(true)
  })

  it("leaves the source side wide, so an unsupported source language is still readable", () => {
    const all = getAllLanguageItems()

    expect(all.some((item) => item.value === "tur")).toBe(true)
    expect(all.length).toBeGreaterThan(getTargetLanguageItems().length)
  })
})
