import type { HostedAiTextStreamRoute } from "@/types/background-stream"
import type { DoubaoScene } from "@/utils/constants/doubao"
import {
  DOUBAO_DEFAULT_SCENE,
  DOUBAO_FEATURE_SCENES,
  DOUBAO_SCENES,
  isDoubaoScene,
} from "@/utils/constants/doubao"

/** `HostedAiTextStreamRoute` → 豆包功能名。功能到场景的固定映射见契约文件。 */
const ROUTE_TO_FEATURE: Record<HostedAiTextStreamRoute, keyof typeof DOUBAO_FEATURE_SCENES> = {
  pageTranslation: "pageTranslation",
  selectionTranslation: "selectionTranslation",
  inputTranslation: "inputTranslation",
  videoSubtitles: "videoSubtitles",
  videoSubtitlesSegmentation: "videoSubtitles",
  languageDetection: "inputTranslation",
}

/**
 * 由功能推导场景号（1 整页 / 2 AI 阅读器 / 3 划词 / 4 截图 / 5 图片文字 / 6 悬停）。
 *
 * `override` 是调用方显式指定的场景（例如悬停翻译要传 6，而它跑在划词通道上，
 * 按功能推导会得到 3）。**只有合法数字才覆盖**，其余值一律退回推导值而不是抛错：
 * 场景号只影响服务端的统计与语料，用它把一个能翻译的请求打死不值得。
 */
export function resolveDoubaoScene(
  feature: HostedAiTextStreamRoute,
  override?: number,
): DoubaoScene {
  if (typeof override === "number" && isDoubaoScene(override)) {
    return override
  }
  const mapped = DOUBAO_FEATURE_SCENES[ROUTE_TO_FEATURE[feature]]
  return mapped ?? DOUBAO_DEFAULT_SCENE
}

/** 悬停翻译：跑在划词通道上，场景号必须显式给 6。 */
export const DOUBAO_HOVER_SCENE: DoubaoScene = DOUBAO_SCENES.hover

export { isDoubaoScene }
