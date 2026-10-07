import type { DoubaoAuthRecord, DoubaoProbeResult } from "@/utils/doubao-auth"
import { Icon } from "@iconify/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { browser } from "#imports"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/base-ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/base-ui/card"
import { Separator } from "@/components/ui/base-ui/separator"
import { Spinner } from "@/components/ui/base-ui/spinner"
import { DOUBAO_LOGIN_URL } from "@/utils/constants/doubao"
import {
  captureDoubaoAuthFromBrowser,
  clearDoubaoAuth,
  getDoubaoAuth,
  listPresentRequiredCookies,
  maskCookie,
  parseCookieString,
} from "@/utils/doubao-auth"
import { cn } from "@/utils/styles/utils"
import { PageLayout } from "../../components/page-layout"
import { ManualCookieImport } from "./manual-import"
import { MaskedCookieList, RequiredCookieChecklist } from "./masked-cookies"
import { describeProbe } from "./probe"

type StatusTone = "none" | "valid" | "expired" | "unknown"

const STATUS_STYLES = {
  none: {
    icon: "tabler:user-off",
    title: "未登录",
    hint: "还没有采集到豆包登录态。点上面的按钮登录豆包后回来获取 Cookie。",
    className: "border-muted-foreground/25 bg-muted/40 text-foreground",
  },
  valid: {
    icon: "tabler:circle-check",
    title: "已登录（鉴权有效）",
    hint: "鉴权探针通过，翻译请求可以直接使用当前登录态。",
    className: "border-emerald-500/30 bg-emerald-500/8 text-foreground dark:bg-emerald-500/10",
  },
  expired: {
    icon: "tabler:clock-exclamation",
    title: "登录已过期",
    hint: "豆包返回 710012001。重新登录豆包后再次获取 Cookie 即可。",
    className: "border-amber-500/30 bg-amber-500/8 text-foreground dark:bg-amber-500/10",
  },
  unknown: {
    icon: "tabler:help-circle",
    title: "登录态未验证",
    hint: "已保存登录态，但还没跑过鉴权探针。点「获取 Cookie」验证一次。",
    className: "border-muted-foreground/25 bg-muted/40 text-foreground",
  },
} as const satisfies Record<
  StatusTone,
  { icon: string; title: string; hint: string; className: string }
>

function getStatusTone(record: DoubaoAuthRecord | null): StatusTone {
  if (!record) return "none"
  if (record.status === "valid") return "valid"
  if (record.status === "expired") return "expired"
  return "unknown"
}

function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—"
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
}

export function DoubaoAccountPage() {
  const [record, setRecord] = useState<DoubaoAuthRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [capture, setCapture] = useState<{
    present: string[]
    probe: DoubaoProbeResult
    savedAt: number | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const next = await getDoubaoAuth()
    setRecord(next)
  }, [])

  useEffect(() => {
    let active = true
    void getDoubaoAuth()
      .then((next) => {
        if (active) setRecord(next)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function handleCapture() {
    setCapturing(true)
    setError(null)
    try {
      const result = await captureDoubaoAuthFromBrowser()
      setCapture({
        present: result.present,
        probe: result.probe,
        savedAt: result.record?.savedAt ?? null,
      })
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCapturing(false)
    }
  }

  async function handleClear() {
    setError(null)
    await clearDoubaoAuth()
    setCapture(null)
    await reload()
  }

  const tone = getStatusTone(record)
  const status = STATUS_STYLES[tone]
  const masked = useMemo(() => (record ? maskCookie(record.cookie) : []), [record])
  const presentCookies = useMemo(
    () => (record ? listPresentRequiredCookies(parseCookieString(record.cookie)) : []),
    [record],
  )

  return (
    <PageLayout
      title="豆包账号"
      description="翻译请求只用 www.doubao.com 的登录 Cookie 鉴权，没有 a_bogus / msToken 之类的签名参数。这里负责把登录态采集进扩展。"
      innerClassName="flex flex-col gap-10"
    >
      <Card className={cn("border", status.className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon icon={status.icon} className="size-4" />
            {status.title}
          </CardTitle>
          <CardDescription className="text-foreground/70">{status.hint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">采集方式</dt>
              <dd>{record ? (record.source === "browser" ? "浏览器读取" : "手动导入") : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">采集时间</dt>
              <dd>{formatTime(record?.savedAt)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">最近校验</dt>
              <dd>{formatTime(record?.checkedAt)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">命中必需项</dt>
              <dd>{record ? `${presentCookies.length} 项` : "—"}</dd>
            </div>
          </dl>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void browser.tabs.create({ url: DOUBAO_LOGIN_URL })
              }}
            >
              <Icon icon="tabler:external-link" className="size-4" />
              打开豆包登录
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={capturing}
              onClick={() => {
                void handleCapture()
              }}
            >
              {capturing ? <Spinner /> : <Icon icon="tabler:cookie" className="size-4" />}
              获取 Cookie
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button type="button" size="sm" variant="destructive" />}>
                <Icon icon="tabler:trash" className="size-4" />
                清除登录态
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清除扩展里保存的登录态？</AlertDialogTitle>
                  <AlertDialogDescription>
                    只会删掉扩展保存的 Cookie 串和校验结果，不会动浏览器里豆包自己的登录
                    Cookie。清除后翻译请求会回到「未登录」状态，需要重新获取。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      void handleClear()
                    }}
                  >
                    确认清除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <p className="text-[13px] text-muted-foreground">
          <Spinner className="mr-2 inline size-3.5" />
          正在读取已保存的登录态…
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <Icon icon="tabler:alert-triangle" />
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {capture && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon
                icon={capture.probe.ok ? "tabler:circle-check" : "tabler:alert-triangle"}
                className={cn("size-4", capture.probe.ok ? "text-emerald-600" : "text-amber-600")}
              />
              最近一次获取结果
            </CardTitle>
            <CardDescription>
              采集时间 {formatTime(capture.savedAt)} · 鉴权探针 {describeProbe(capture.probe).text}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">
                必需 Cookie 命中 {capture.present.length} 项
              </span>
              <RequiredCookieChecklist present={capture.present} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">已保存的 Cookie（脱敏）</h2>
          <p className="text-[13px] text-muted-foreground">
            只显示名字和掩码后的片段，完整值不会出现在这个页面上。
          </p>
        </div>
        {masked.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">还没有保存任何 Cookie。</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">必需项</span>
              <RequiredCookieChecklist present={presentCookies} />
            </div>
            <MaskedCookieList entries={masked} />
          </>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">手动导入</h2>
          <p className="text-[13px] text-muted-foreground">
            在无法直接读取浏览器 Cookie 的场合（豆包 PC 客户端、另一台机器）用粘贴方式导入。
          </p>
        </div>
        <ManualCookieImport
          onSaved={() => {
            void reload()
          }}
        />
      </div>
    </PageLayout>
  )
}
