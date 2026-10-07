import type { DoubaoProviderType } from "@/utils/constants/doubao"
import { Icon } from "@iconify/react"
import { useAtomValue, useSetAtom } from "jotai"
import { configAtom, writeConfigAtom } from "@/utils/atoms/config"
import {
  DOUBAO_PROVIDER_DESCRIPTIONS,
  DOUBAO_PROVIDER_LABELS,
  DOUBAO_PROVIDER_TYPES,
  getDoubaoProviderId,
} from "@/utils/constants/doubao"
import { buildFeatureProviderPatch } from "@/utils/constants/feature-providers"
import { cn } from "@/utils/styles/utils"

/**
 * 三个豆包翻译服务之间切换。切换会同时改掉页面翻译 / 划词翻译 / 输入翻译的默认服务 ——
 * 它们在产品上就是同一个选择的三个入口，分开设只会让用户对不上号。
 *
 * 这里只认豆包契约里的三个类型，别的 provider 一律不出现。
 */
export function DoubaoServiceSwitcher() {
  const config = useAtomValue(configAtom)
  const writeConfig = useSetAtom(writeConfigAtom)
  const activeProviderId = config.pageTranslation.providerId

  const selectService = (provider: DoubaoProviderType) => {
    const providerId = getDoubaoProviderId(provider)
    if (providerId === activeProviderId) return
    void writeConfig(
      buildFeatureProviderPatch({
        pageTranslation: providerId,
        selectionTranslation: providerId,
        inputTranslation: providerId,
      }),
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[13px] font-medium">翻译服务</span>
      <div className="flex flex-col gap-1">
        {DOUBAO_PROVIDER_TYPES.map((provider) => {
          const active = getDoubaoProviderId(provider) === activeProviderId
          return (
            <button
              key={provider}
              type="button"
              aria-pressed={active}
              onClick={() => {
                selectService(provider)
              }}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                active
                  ? "border-accent-blue bg-accent-blue/8"
                  : "border-transparent hover:bg-muted",
              )}
            >
              <Icon
                icon={active ? "tabler:circle-check-filled" : "tabler:circle"}
                className={cn("mt-0.5 size-4 shrink-0", active && "text-accent-blue")}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">{DOUBAO_PROVIDER_LABELS[provider]}</span>
                <span className="text-[12px] leading-4 text-muted-foreground">
                  {DOUBAO_PROVIDER_DESCRIPTIONS[provider]}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
