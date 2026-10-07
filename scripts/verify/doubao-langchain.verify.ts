/**
 * 端到端语言码映射核对（验证者加的针对性用例）。
 *
 * 起因：新装默认 `language.targetCode === "cmn"`（ISO 639-3），
 * 而豆包只接受 ISO 639-1 系语言码（`zh` / `zh-Hant` …）。
 * 若映射链在某一环断掉，**新装默认配置就会直接翻译失败**，且失败文案会是
 * 「豆包翻译不支持目标语言 "cmn"」—— 这是最典型的「装完就不能用」缺陷。
 *
 * 本用例把「新装默认配置」一路追到「真正下发给豆包的 target_lang」，钉死这条链。
 */
import fs from "node:fs"
import { ISO6393_TO_6391 } from "@read-frog/definitions"
import { describe, expect, it } from "vitest"
import {
  getAllLanguageItems,
  getLanguageItems,
  getTargetLanguageItems,
  isDoubaoTranslatableLanguage,
} from "@/components/language-combobox-options"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { toDoubaoLang } from "@/utils/constants/doubao"
import { doubaoTranslate } from "@/utils/host/translate/api/doubao/client"
import { startMockDoubao } from "./mock-doubao-server.mjs"

describe("H. 新装默认配置 → 豆包 target_lang 全链路", () => {
  it("H1 默认 targetCode 经 ISO6393→6391 后必须被豆包接受", () => {
    const defaultTarget = DEFAULT_CONFIG.language.targetCode
    const iso1 = ISO6393_TO_6391[defaultTarget]
    expect(iso1, `ISO6393_TO_6391["${defaultTarget}"] 缺失`).toBeTruthy()
    const doubaoLang = toDoubaoLang(iso1)
    expect(
      doubaoLang,
      `默认目标语言链 ${defaultTarget} -> ${iso1} -> ${String(doubaoLang)} 断掉了`,
    ).toBeTruthy()
  })

  it("H2【刻画】扩展可选目标语言 vs 豆包支持语言的覆盖缺口", () => {
    const rows = Object.entries(ISO6393_TO_6391).map(([iso3, iso1]) => ({
      iso3,
      iso1: iso1 ?? null,
      doubao: iso1 ? toDoubaoLang(iso1) : null,
    }))
    const supported = rows.filter((r) => r.doubao !== null)
    const unsupported = rows.filter((r) => r.doubao === null)

    // 把缺口写出来供报告引用（不靠断言传递信息）
    fs.writeFileSync(
      "scripts/verify/_langgap.json",
      JSON.stringify(
        {
          total: rows.length,
          supportedCount: supported.length,
          unsupportedCount: unsupported.length,
          supported: supported.map((r) => `${r.iso3}->${r.iso1}->${r.doubao}`),
          unsupported: unsupported.filter((r) => r.iso1).map((r) => `${r.iso3}->${r.iso1}`),
          unsupportedNoIso1: unsupported.filter((r) => !r.iso1).map((r) => r.iso3),
        },
        null,
        1,
      ),
      "utf8",
    )

    // 豆包只支持 19 个语言码，而扩展的语言表远大于此 —— 缺口存在是**事实**，
    // 关键是不能出现「静默失败」：选了不支持的语言必须抛可读错误（见 H3b）。
    expect(supported.length).toBeGreaterThanOrEqual(19)
    expect(supported.length + unsupported.length).toBe(rows.length)

    // 中文用户最可能选的目标语言必须全部命中
    const mustWork = ["cmn", "eng", "jpn", "kor", "fra", "deu", "spa", "rus", "por", "ita"]
    const broken = mustWork.filter((iso3: string) => {
      const iso1 = ISO6393_TO_6391[iso3 as keyof typeof ISO6393_TO_6391]
      return !iso1 || toDoubaoLang(iso1) === null
    })
    expect(broken, `这些常用目标语言在豆包侧不可用: ${broken.join(", ")}`).toEqual([])
  })

  it("H2b 选了豆包不支持的目标语言时，必须抛可读中文错误而不是静默返回空", async () => {
    const mock = await startMockDoubao()
    const restore = mock.installFetchRewrite()
    try {
      // mri(毛利语) -> mi，豆包不支持
      const iso1 = ISO6393_TO_6391.mri ?? "mi"
      let thrown: unknown = null
      try {
        await doubaoTranslate("Hello", iso1, { engine: "0", scene: 2 })
      } catch (error) {
        thrown = error
      }
      expect(thrown, "不支持的目标语言必须报错，不能静默返回空串").toBeTruthy()
      const msg = (thrown as Error).message
      expect(msg).toContain(iso1)
      // 且不应把请求发出去
      expect(mock.requests).toHaveLength(0)
    } finally {
      restore()
      await mock.stop()
    }
  })

  it("H3 用默认配置的值真实下发请求，target_lang 必须是 zh 而不是 cmn", async () => {
    const mock = await startMockDoubao()
    const restore = mock.installFetchRewrite()
    try {
      const iso1 = ISO6393_TO_6391[DEFAULT_CONFIG.language.targetCode]!
      await doubaoTranslate("Hello world", iso1, { engine: "1", scene: 2 })
      expect(mock.requests).toHaveLength(1)
      const body = mock.requests[0]!.body
      expect(body.target_lang).toBe("zh")
      expect(body.target_lang).not.toBe("cmn")
      expect(typeof body.scene).toBe("number")
      expect(body.scene).toBe(2)
      expect(body.translate_service).toBe("1")
    } finally {
      restore()
      await mock.stop()
    }
  })

  it("H4 toDoubaoLang 边界：常见地区码与大小写", () => {
    expect(toDoubaoLang("zh")).toBe("zh")
    expect(toDoubaoLang("cmn")).toBeNull() // 639-3 不该直接喂给豆包
    expect(toDoubaoLang("zh-CN")).toBe("zh")
    expect(toDoubaoLang("zh-TW")).toBe("zh-Hant")
    expect(toDoubaoLang("zh-Hant")).toBe("zh-Hant")
    expect(toDoubaoLang("EN")).toBe("en")
    expect(toDoubaoLang("")).toBeNull()
    expect(toDoubaoLang(undefined)).toBeNull()
  })
})

describe("J. D8 修复核对：目标侧语言列表必须按豆包能力裁剪", () => {
  it("J1 目标侧每一项都可被豆包翻译，且数量远小于源侧", () => {
    const target = getTargetLanguageItems()
    const all = getAllLanguageItems()

    const bad = target.filter((item) => !isDoubaoTranslatableLanguage(item.value))
    expect(
      bad.map((b) => b.value),
      "目标侧仍存在豆包不支持的语言",
    ).toEqual([])

    // 豆包 19 个语言码；ISO6393 表里能对上的应当是同一个量级
    expect(target.length).toBeGreaterThanOrEqual(15)
    expect(target.length).toBeLessThanOrEqual(25)
    expect(target.length).toBeLessThan(all.length / 4)
  })

  it("J2 默认目标语言中文必须仍在目标侧（防误伤 cmn）", () => {
    const values = getTargetLanguageItems().map((i) => i.value)
    // 默认 language.targetCode = "cmn"
    expect(values).toContain(DEFAULT_CONFIG.language.targetCode)
    expect(values).toContain("cmn")
    expect(values).toContain("eng")
    expect(values).toContain("jpn")
  })

  it("J3 豆包不支持的常见语言必须从目标侧移除，但源侧保留", () => {
    const targetValues = new Set(getTargetLanguageItems().map((i) => i.value))
    const allValues = new Set(getAllLanguageItems().map((i) => i.value))
    for (const code of ["tur", "hin", "pol", "ukr", "nld", "swe", "ell", "heb"]) {
      expect(targetValues.has(code as never), `${code} 不该出现在目标侧`).toBe(false)
      expect(allValues.has(code as never), `${code} 应保留在源侧`).toBe(true)
    }
  })

  it("J4 getLanguageItems 的 side 参数行为正确（source 全量 / target 裁剪）", () => {
    const src = getLanguageItems(undefined, "Auto", "source")
    const tgt = getLanguageItems(undefined, "Auto", "target")
    // auto 行两侧都要在
    expect(src[0]!.value).toBe("auto")
    expect(tgt[0]!.value).toBe("auto")
    expect(tgt.length).toBeLessThan(src.length)
    expect(tgt.slice(1).every((i) => isDoubaoTranslatableLanguage(i.value as never))).toBe(true)

    // 默认（不传 side）等价于 source
    expect(getLanguageItems(undefined, "Auto").length).toBe(src.length)
  })
})
