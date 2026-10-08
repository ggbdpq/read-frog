import type { DoubaoAuthRecord } from "@/utils/doubao-auth"
import { Icon } from "@iconify/react"
import { useEffect } from "react"
import { Badge } from "@/components/ui/base-ui/badge"
import { useDoubaoAuthRecord } from "@/hooks/use-doubao-auth-record"
import { openOptionsPage } from "@/utils/navigation"
import { cn } from "@/utils/styles/utils"

interface StatusView {
  label: string
  icon: string
  className: string
}

function getStatusView(record: DoubaoAuthRecord | null): StatusView {
  if (!record) {
    return {
      label: "未登录",
      icon: "tabler:user-off",
      className: "bg-muted text-muted-foreground",
    }
  }
  if (record.status === "valid") {
    return {
      label: "已登录",
      icon: "tabler:circle-check",
      className: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    }
  }
  if (record.status === "expired") {
    return {
      label: "登录已过期",
      icon: "tabler:clock-exclamation",
      className: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    }
  }
  return {
    label: "未验证",
    icon: "tabler:help-circle",
    className: "bg-muted text-muted-foreground",
  }
}

/** popup 顶部的豆包账号状态；点进去就是 /doubao-account 登录页。 */
export function DoubaoAccountStatus() {
  const { record, refresh } = useDoubaoAuthRecord()

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [refresh])

  const status = getStatusView(record)

  return (
    <button
      type="button"
      onClick={() => {
        void openOptionsPage({ route: "/doubao-account" })
      }}
      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
        <Icon icon="tabler:user-circle" className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">豆包账号</span>
      </span>
      <Badge variant="secondary" className={cn("gap-1 font-normal", status.className)}>
        <Icon icon={status.icon} className="size-3" />
        {status.label}
      </Badge>
    </button>
  )
}
