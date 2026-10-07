import type { Config } from "@/types/config/config"
import type { Point } from "@/types/dom"
import { DOUBAO_SCENES } from "@/utils/constants/doubao"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { getEffectiveSiteRule } from "@/utils/site-rules/effective"
import { isHTMLElement } from "../dom/filter"
import { findNearestAncestorBlockNodeAt } from "../dom/find"
import { walkAndLabelElement } from "../dom/traversal"
import { translateWalkedElement } from "./core/translation-walker"
import { runWithNodeTranslationScene } from "./node-translation-scene"
import { validateTranslationConfigAndToast } from "./translate-text"
import { beginNodeSiteRuleCSSOperation } from "./ui/node-site-rule-css"

// Re-export public APIs
export {
  translateNodes,
  translateNodesBilingualMode,
  translateNodeTranslationOnlyMode,
} from "./core/translation-modes"
export { translateWalkedElement } from "./core/translation-walker"
export { removeAllTranslatedWrapperNodes } from "./dom/translation-cleanup"

// High-level orchestration function
export async function removeOrShowNodeTranslation(point: Point, config: Config): Promise<boolean> {
  const node = findNearestAncestorBlockNodeAt(point, config)

  if (!node || !isHTMLElement(node)) return false

  const id = getRandomUUID()

  if (
    !validateTranslationConfigAndToast({
      providersConfig: config.providersConfig,
      pageTranslation: config.pageTranslation,
      language: config.language,
    })
  ) {
    return false
  }

  const rootNode = node.getRootNode()
  const styleRoot = rootNode instanceof ShadowRoot ? rootNode : document
  const siteRule = getEffectiveSiteRule(config, window.location.href)
  const releaseSiteRuleCSS = await beginNodeSiteRuleCSSOperation(styleRoot, siteRule.injectedCss)

  try {
    walkAndLabelElement(node, id, config)
    // 悬停 / 节点翻译在豆包侧是场景 6。`scene` 不穿进 `translateWalkedElement` 的
    // 位置参数（那要改十几个调用点、动最热路径），而是走本帧的模块级上下文 ——
    // 取舍与已知的有界竞态见 `node-translation-scene.ts` 的文件头注释。
    await runWithNodeTranslationScene(DOUBAO_SCENES.hover, () =>
      translateWalkedElement(
        node,
        id,
        config,
        true,
        undefined,
        undefined,
        config.pageTranslation.node.forceRetranslation,
      ),
    )
  } finally {
    await releaseSiteRuleCSS()
  }
  return true
}
