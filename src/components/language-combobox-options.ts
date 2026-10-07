import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { GlossaryTargetLang } from "@/utils/glossary/target-language"
import { ISO6393_TO_6391, langCodeISO6393Schema } from "@read-frog/definitions"
import { toDoubaoLang } from "@/utils/constants/doubao"
import { ALL_LANGUAGES } from "@/utils/glossary/target-language"
import { getLanguageLabel, getLanguageName } from "@/utils/language-labels"

/**
 * `T` is only constrained to `string` so a surface can offer a row that is not a
 * language — `auto` below, `all` for the glossary. Every such row is pinned
 * ahead of the languages and named by its caller.
 */
export interface LanguageItem<T extends string = LangCodeISO6393 | "auto"> {
  value: T
  label: string
  name?: string
}

/**
 * 二次开发：只剩豆包三个服务，而豆包只认 19 种目标语言（见 `DOUBAO_LANGS`）。
 * 选一个它产不出的目标语言会在发请求前抛可读错误（不是静默失败），但让用户选到一个
 * 必然失败的项仍然是真实的产品缺陷，所以目标侧列表按后端能力裁剪。
 *
 * 判定必须走一遍 `ISO6393_TO_6391`：扩展内部存的是 ISO 639-3（`cmn` / `jpn`），
 * 而 `toDoubaoLang` 认的是 639-1 系（`zh` / `ja`）—— 直接喂 `cmn` 会得到 null，
 * 把中文这个默认目标语言也误伤掉。
 */
export function isDoubaoTranslatableLanguage(code: LangCodeISO6393): boolean {
  return toDoubaoLang(ISO6393_TO_6391[code] ?? code) !== null
}

/**
 * Every language the extension can name. This is the SOURCE-side list: the page may be
 * written in any of them, and the target backend never has to produce them.
 */
export function getAllLanguageItems(): LanguageItem<LangCodeISO6393>[] {
  return langCodeISO6393Schema.options.map((code) => ({
    value: code,
    label: getLanguageLabel(code),
    name: getLanguageName(code),
  }))
}

/**
 * The TARGET-side list: only what the configured backend can actually produce. Feeding a
 * language it cannot translate into fails the request before it is sent.
 */
export function getTargetLanguageItems(): LanguageItem<LangCodeISO6393>[] {
  return getAllLanguageItems().filter((item) => isDoubaoTranslatableLanguage(item.value))
}

/**
 * `detectedLangCode` names the auto row after what the page turned out to be — for surfaces
 * that sit beside a page. `autoLabel` is for surfaces that have no page to resolve against
 * (the settings page), where auto can only be described.
 *
 * `side` picks the list: `source` offers every language, `target` only what the backend can
 * produce. It defaults to `source` because a caller that names an auto row is describing the
 * page's own language, i.e. the source side.
 */
export function getLanguageItems(
  detectedLangCode?: LangCodeISO6393,
  autoLabel?: string,
  side: "source" | "target" = "source",
): LanguageItem[] {
  const items: LanguageItem[] = side === "target" ? getTargetLanguageItems() : getAllLanguageItems()

  if (detectedLangCode) {
    items.unshift({
      value: "auto",
      label: getLanguageLabel(detectedLangCode),
      name: getLanguageName(detectedLangCode),
    })
  } else if (autoLabel) {
    items.unshift({ value: "auto", label: autoLabel })
  }

  return items
}

/**
 * The languages a glossary term can be written for, with "every language" pinned
 * first — the value a term carries when its wording is language-independent.
 *
 * Deliberately NOT a variant of `getLanguageItems`: a glossary has no page to
 * detect a language from, and offering `auto` beside `all` would put two rows
 * that both mean "not a specific language" next to each other.
 */
export function getGlossaryTargetLanguageItems(
  allLabel: string,
): LanguageItem<GlossaryTargetLang>[] {
  return [{ value: ALL_LANGUAGES, label: allLabel }, ...getTargetLanguageItems()]
}

export function filterLanguage(item: LanguageItem<string>, query: string): boolean {
  const searchLower = query.toLowerCase()
  return (
    item.label.toLowerCase().includes(searchLower) ||
    (item.name?.toLowerCase().includes(searchLower) ?? false) ||
    item.value.toLowerCase().includes(searchLower)
  )
}
