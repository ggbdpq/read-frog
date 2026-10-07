import { Icon } from "@iconify/react"
import { Badge } from "@/components/ui/base-ui/badge"
import { DOUBAO_REQUIRED_COOKIE_NAMES } from "@/utils/constants/doubao"
import { cn } from "@/utils/styles/utils"

/**
 * 脱敏 Cookie 展示。只接受 `maskCookie()` 的输出，**永远不要把明文 Cookie
 * 传进这个组件** —— 渲染层是明文泄漏最容易发生的地方。
 */
export function MaskedCookieList({
  entries,
}: {
  entries: Array<{ name: string; preview: string; length: number }>
}) {
  if (entries.length === 0) {
    return <p className="text-[13px] text-muted-foreground">暂无可展示的 Cookie。</p>
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={entry.name}
          className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2.5 py-1.5"
        >
          <span className="truncate font-mono text-xs text-foreground">{entry.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{entry.preview}</span>
            <span className="text-[11px] text-muted-foreground">{entry.length} 字节</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 必需 Cookie 命中清单：缺哪个一眼能看出来。 */
export function RequiredCookieChecklist({ present }: { present: readonly string[] }) {
  const presentSet = new Set(present)

  return (
    <div className="flex flex-wrap gap-1.5">
      {DOUBAO_REQUIRED_COOKIE_NAMES.map((name) => {
        const hit = presentSet.has(name)
        return (
          <Badge
            key={name}
            variant="secondary"
            className={cn(
              "gap-1 font-mono text-[11px] font-normal",
              hit
                ? "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon icon={hit ? "tabler:check" : "tabler:minus"} className="size-3" />
            {name}
          </Badge>
        )
      })}
    </div>
  )
}
