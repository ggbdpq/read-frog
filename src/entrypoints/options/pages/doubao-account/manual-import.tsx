import type { DoubaoProbeResult } from "@/utils/doubao-auth"
import { Icon } from "@iconify/react"
import { useMemo, useState } from "react"
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
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { Label } from "@/components/ui/base-ui/label"
import { Spinner } from "@/components/ui/base-ui/spinner"
import { Switch } from "@/components/ui/base-ui/switch"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { DOUBAO_LOGIN_COOKIE_NAMES } from "@/utils/constants/doubao"
import {
  importCookiesIntoBrowser,
  listPresentRequiredCookies,
  maskCookie,
  parseCookieString,
  probeDoubaoAuth,
  setDoubaoAuth,
} from "@/utils/doubao-auth"
import { MaskedCookieList, RequiredCookieChecklist } from "./masked-cookies"
import { describeProbe } from "./probe"

/** 从外部（豆包 PC 客户端 / 另一台浏览器）导入登录态。 */
export function ManualCookieImport({ onSaved }: { onSaved: () => void }) {
  const [raw, setRaw] = useState("")
  const [writeToBrowser, setWriteToBrowser] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [probe, setProbe] = useState<DoubaoProbeResult | null>(null)

  const pairs = useMemo(() => parseCookieString(raw), [raw])
  const masked = useMemo(() => maskCookie(raw), [raw])
  const present = useMemo(() => listPresentRequiredCookies(pairs), [pairs])
  const missingLoginCookies = DOUBAO_LOGIN_COOKIE_NAMES.filter((name) => !present.includes(name))
  const canSave = pairs.length > 0 && missingLoginCookies.length === 0

  /** 把粘贴内容落盘；`write` 为真时先写回浏览器 jar。 */
  async function commit() {
    setPending(true)
    setResult(null)
    setProbe(null)
    try {
      const imported = writeToBrowser ? await importCookiesIntoBrowser(pairs) : null

      // 浏览器会剥掉 fetch 的 `Cookie` 头，探针只能反映**浏览器 jar 里**的登录态。
      // 没写回 jar 时探针必然是旧的，所以这种情况直接标记为「未验证」。
      const probeResult = writeToBrowser ? await probeDoubaoAuth() : null

      await setDoubaoAuth({
        cookie: pairs.map(({ name, value }) => `${name}=${value}`).join("; "),
        source: "manual",
        savedAt: Date.now(),
        status: probeResult ? (probeResult.ok ? "valid" : "expired") : "unknown",
        checkedAt: probeResult ? Date.now() : null,
      })

      setProbe(probeResult)
      setRaw("")
      if (imported) {
        const failedNote =
          imported.failed.length > 0
            ? `，失败 ${imported.failed.length} 个（${imported.failed.join("、")}）`
            : ""
        setResult({
          ok: probeResult?.ok === true,
          text: `已写入浏览器 ${imported.written} 个 Cookie${failedNote}。`,
        })
      } else {
        setResult({
          ok: true,
          text: "已保存到扩展。未写入浏览器 Cookie，扩展发起的请求暂时还用不上它。",
        })
      }
      onSaved()
    } catch (error) {
      setResult({
        ok: false,
        text: `导入失败：${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setPending(false)
    }
  }

  const probeView = probe ? describeProbe(probe) : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doubao-cookie-paste">粘贴 Cookie</Label>
        <Textarea
          id="doubao-cookie-paste"
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value)
          }}
          rows={5}
          spellCheck={false}
          placeholder={
            "sessionid=...; sid_tt=...; uid_tt=...;\n也支持整行 Set-Cookie 或 Cookie-Editor 的 JSON 导出"
          }
          className="font-mono text-xs"
        />
        <p className="text-[13px] text-muted-foreground">
          只有在浏览器里登录过豆包、或从别处拿到了导出 Cookie
          时才需要这一步。粘贴内容不会被上传到任何服务器。
        </p>
      </div>

      {pairs.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              解析到 {pairs.length} 个 Cookie，命中必需项 {present.length} 个
            </span>
            <RequiredCookieChecklist present={present} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">脱敏预览</span>
            <MaskedCookieList entries={masked} />
          </div>
          {missingLoginCookies.length > 0 && (
            <Alert variant="warning">
              <Icon icon="tabler:alert-triangle" />
              <AlertTitle>缺少登录必需的 Cookie</AlertTitle>
              <AlertDescription>
                缺少 {missingLoginCookies.join("、")}，这样导入进去也仍然算未登录。
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="doubao-cookie-write-browser">同时写入浏览器 Cookie</Label>
          <p className="text-[13px] text-muted-foreground">
            默认关闭。开启后会把这些 Cookie 写进本浏览器的 doubao.com，覆盖同名的既有
            Cookie，包括当前浏览器的豆包登录态。
          </p>
        </div>
        <Switch
          id="doubao-cookie-write-browser"
          checked={writeToBrowser}
          onCheckedChange={(checked) => {
            setWriteToBrowser(checked)
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        {writeToBrowser ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Button
              type="button"
              size="sm"
              disabled={!canSave || pending}
              onClick={() => {
                setConfirmOpen(true)
              }}
            >
              {pending && <Spinner />}
              保存并使用
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认覆盖浏览器 Cookie？</AlertDialogTitle>
                <AlertDialogDescription>
                  即将把 {pairs.length} 个 Cookie 写入本浏览器 doubao.com，同名的既有 Cookie
                  会被替换，本浏览器当前的豆包登录态可能因此失效。这个操作不会同步到其它设备。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void commit()
                  }}
                >
                  确认写入
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!canSave || pending}
            onClick={() => {
              void commit()
            }}
          >
            {pending && <Spinner />}
            保存到扩展
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={raw === "" || pending}
          onClick={() => {
            setRaw("")
            setResult(null)
            setProbe(null)
          }}
        >
          清空
        </Button>
      </div>

      {result && (
        <Alert variant={result.ok ? "default" : "destructive"}>
          <Icon icon={result.ok ? "tabler:circle-check" : "tabler:alert-triangle"} />
          <AlertTitle>{result.ok ? "导入完成" : "导入未成功"}</AlertTitle>
          <AlertDescription>{result.text}</AlertDescription>
        </Alert>
      )}

      {probeView && <p className="text-[13px] text-muted-foreground">鉴权探针：{probeView.text}</p>}
    </div>
  )
}
