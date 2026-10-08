/**
 * 豆包账号登录态：Cookie 的采集、校验与持久化。
 *
 * 关键事实（实测，勿改）：
 *   - 鉴权只需要 `www.doubao.com` 的**登录 Cookie**，没有 a_bogus / msToken / aid 等签名参数。
 *   - Cookie 是 httpOnly 的，扩展只能用 `browser.cookies` 读，无法从页面 JS 拿。
 *   - 扩展自己发的 fetch 里 **不能手写 `Cookie` 头**（fetch 禁止头，会被浏览器静默丢弃）。
 *     浏览器会依据 host_permissions 自动带上目标域 Cookie，所以请求侧必须
 *     `credentials: "include"`；本模块保存的 Cookie 串用于「探针校验 + 展示 + 导入」。
 *   - 从外部（豆包 PC 客户端 / 其它浏览器）导入的 Cookie，通过 `browser.cookies.set`
 *     写回本浏览器 jar 后即可被自动携带 —— 这是唯一的注入通道。
 */

import { z } from "zod"
import { browser, storage } from "#imports"
import {
  DOUBAO_COOKIE_DOMAIN,
  DOUBAO_CODE_LOGIN_EXPIRED,
  DOUBAO_OK_CODE,
  DOUBAO_ORIGIN,
  DOUBAO_REQUIRED_COOKIE_NAMES,
  DOUBAO_USER_SETTINGS_URL,
} from "@/utils/constants/doubao"
import { DOUBAO_AUTH_STORAGE_KEY } from "@/utils/constants/storage-keys"
import { logger } from "@/utils/logger"

export interface DoubaoAuthRecord {
  /** `name=value; name=value` 形式的完整 Cookie 串。 */
  cookie: string
  /** 采集方式：浏览器 jar 直读 / 手动粘贴导入。 */
  source: "browser" | "manual"
  savedAt: number
  /** 最近一次鉴权探针结果。 */
  status: "unknown" | "valid" | "expired"
  checkedAt: number | null
}

export interface DoubaoProbeResult {
  ok: boolean
  /** 服务端 code；网络层失败时为 undefined。 */
  code?: number
  msg?: string
}

const doubaoAuthSchema = z.object({
  cookie: z.string().min(1),
  source: z.enum(["browser", "manual"]),
  savedAt: z.number(),
  status: z.enum(["unknown", "valid", "expired"]),
  checkedAt: z.number().nullable(),
})

/** HTTP 头只能装 latin-1，中文/emoji 值会被 fetch 拒绝，直接剔除。 */
function isHeaderSafe(value: string): boolean {
  for (const char of value) {
    if (char.codePointAt(0)! > 0xff) {
      return false
    }
  }
  return true
}

/**
 * 解析用户粘贴的 Cookie 串。容错：换行、`;`/`,` 分隔、`Set-Cookie` 粘贴、
 * JSON 数组（EditThisCookie 导出）都能吃。
 */
export function parseCookieString(raw: string): Array<{ name: string; value: string }> {
  const text = raw.trim()
  if (text === "") {
    return []
  }

  // EditThisCookie / Cookie-Editor 的 JSON 导出
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item): item is { name: string; value: string } =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { name?: unknown }).name === "string" &&
              typeof (item as { value?: unknown }).value === "string",
          )
          .map((item) => ({ name: item.name, value: item.value }))
      }
    } catch {
      // 落到下面的键值对解析
    }
  }

  const pairs: Array<{ name: string; value: string }> = []
  for (const part of text.split(/[;\n,]/)) {
    const trimmed = part.trim()
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue
    }
    // 允许直接粘贴 `Cookie: a=b; c=d` 或 `Set-Cookie: a=b; Path=/`
    const withoutPrefix = trimmed.replace(/^(set-)?cookie\s*:\s*/i, "")
    const separator = withoutPrefix.indexOf("=")
    if (separator <= 0) {
      continue
    }
    const name = withoutPrefix.slice(0, separator).trim()
    const value = withoutPrefix
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
    if (name === "" || !isHeaderSafe(value)) {
      continue
    }
    pairs.push({ name, value })
  }
  return pairs
}

export function buildCookieHeader(pairs: readonly { name: string; value: string }[]): string {
  return pairs.map(({ name, value }) => `${name}=${value}`).join("; ")
}

/** 列出命中的必需 Cookie 名，用于界面展示「已拿到哪些」。 */
export function listPresentRequiredCookies(
  pairs: readonly { name: string; value: string }[],
): string[] {
  const names = new Set(pairs.map((pair) => pair.name))
  return DOUBAO_REQUIRED_COOKIE_NAMES.filter((required) => names.has(required))
}

/**
 * 从本浏览器的 Cookie jar 读取 doubao.com 登录态。
 * 用户在浏览器里登录过豆包（或导入过 Cookie）就能拿到。
 */
export async function readDoubaoCookieFromBrowser(): Promise<string> {
  if (!browser.cookies?.getAll) {
    throw new Error("当前浏览器不支持 cookies API")
  }
  const cookies = await browser.cookies.getAll({ domain: DOUBAO_COOKIE_DOMAIN })
  const pairs = cookies
    .filter((cookie) => cookie.value !== "" && isHeaderSafe(cookie.value))
    .map((cookie) => ({ name: cookie.name, value: cookie.value }))
  return buildCookieHeader(dedupeByName(pairs))
}

/** 同名 Cookie 取第一个，避免 `.doubao.com` 与 `www.doubao.com` 重复写入。 */
function dedupeByName(
  pairs: readonly { name: string; value: string }[],
): Array<{ name: string; value: string }> {
  const seen = new Set<string>()
  const result: Array<{ name: string; value: string }> = []
  for (const pair of pairs) {
    if (seen.has(pair.name)) {
      continue
    }
    seen.add(pair.name)
    result.push(pair)
  }
  return result
}

/**
 * 把 Cookie 写回浏览器 jar，使扩展自身发起的 fetch 能自动携带。
 *
 * 用途：从豆包 PC 客户端或另一台浏览器导出的 Cookie。会覆盖同名的既有
 * Cookie（这正是目的：让当前浏览器认为已登录豆包），所以调用点必须显式
 * 征求用户同意，且默认关闭。
 */
export async function importCookiesIntoBrowser(
  pairs: readonly { name: string; value: string }[],
): Promise<{ written: number; failed: string[] }> {
  if (!browser.cookies?.set) {
    throw new Error("当前浏览器不支持 cookies API")
  }
  let written = 0
  const failed: string[] = []
  for (const { name, value } of dedupeByName(pairs)) {
    try {
      await browser.cookies.set({
        url: DOUBAO_ORIGIN,
        domain: DOUBAO_COOKIE_DOMAIN,
        name,
        value,
        path: "/",
        secure: true,
      })
      written += 1
    } catch (error) {
      failed.push(name)
      logger.warn(`[DoubaoAuth] 写入 Cookie 失败: ${name}`, error)
    }
  }
  return { written, failed }
}

/** 鉴权探针：GET user_settings/get，`code === 0` 视为登录态有效。 */
export async function probeDoubaoAuth(cookie?: string): Promise<DoubaoProbeResult> {
  try {
    const response = await fetch(DOUBAO_USER_SETTINGS_URL, {
      method: "GET",
      // 扩展页面/后台发起时，浏览器按 host_permissions 自动带上 doubao.com Cookie。
      credentials: "include",
      headers: {
        Accept: "*/*",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    })
    if (!response.ok) {
      return { ok: false, msg: `HTTP ${response.status}` }
    }
    const payload: unknown = await response.json()
    const code = (payload as { code?: number } | null)?.code
    const msg = (payload as { msg?: string } | null)?.msg
    if (code === DOUBAO_OK_CODE) {
      return { ok: true, code, msg }
    }
    if (code === DOUBAO_CODE_LOGIN_EXPIRED) {
      return { ok: false, code, msg: msg ?? "登录已过期，请重新登录" }
    }
    return { ok: false, code, msg }
  } catch (error) {
    return { ok: false, msg: error instanceof Error ? error.message : String(error) }
  }
}

export async function getDoubaoAuth(): Promise<DoubaoAuthRecord | null> {
  try {
    const raw = await storage.getItem<DoubaoAuthRecord>(`local:${DOUBAO_AUTH_STORAGE_KEY}`)
    if (!raw) {
      return null
    }
    const parsed = doubaoAuthSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn("[DoubaoAuth] 存储中的登录态无效，已忽略")
      return null
    }
    return parsed.data
  } catch (error) {
    logger.error("[DoubaoAuth] 读取登录态失败", error)
    return null
  }
}

export async function setDoubaoAuth(record: DoubaoAuthRecord): Promise<void> {
  await storage.setItem<DoubaoAuthRecord>(`local:${DOUBAO_AUTH_STORAGE_KEY}`, record)
}

export async function clearDoubaoAuth(): Promise<void> {
  await storage.removeItem(`local:${DOUBAO_AUTH_STORAGE_KEY}`)
}

/** 采集 + 探针 + 落盘，供「获取 Cookie」按钮一次调用。 */
export async function captureDoubaoAuthFromBrowser(): Promise<{
  record: DoubaoAuthRecord | null
  probe: DoubaoProbeResult
  present: string[]
}> {
  const cookie = await readDoubaoCookieFromBrowser()
  const pairs = parseCookieString(cookie)
  const present = listPresentRequiredCookies(pairs)
  if (cookie === "") {
    return { record: null, probe: { ok: false, msg: "浏览器里没有 doubao.com 的 Cookie" }, present }
  }
  const probe = await probeDoubaoAuth(cookie)
  const record: DoubaoAuthRecord = {
    cookie,
    source: "browser",
    savedAt: Date.now(),
    status: probe.ok ? "valid" : "expired",
    checkedAt: Date.now(),
  }
  await setDoubaoAuth(record)
  return { record, probe, present }
}

/**
 * 翻译请求侧使用的 Cookie 串。
 * 优先用已保存的（可能来自导入），否则回读浏览器 jar；两者都空则返回 ""，
 * 交给调用方报「未登录」。绝不在这里抛错 —— 未登录是正常状态。
 */
export async function getDoubaoCookie(): Promise<string> {
  const stored = await getDoubaoAuth()
  if (stored && stored.cookie.trim() !== "") {
    return stored.cookie
  }
  try {
    return await readDoubaoCookieFromBrowser()
  } catch (error) {
    logger.warn("[DoubaoAuth] 回读浏览器 Cookie 失败", error)
    return ""
  }
}

/** 展示用脱敏：`sessionid=abc1…(32 字节)`。已有解析好的键值对时用 `maskCookiePairs` 免去二次解析。 */
export function maskCookie(
  cookie: string,
): Array<{ name: string; preview: string; length: number }> {
  return maskCookiePairs(parseCookieString(cookie))
}

export function maskCookiePairs(
  pairs: readonly { name: string; value: string }[],
): Array<{ name: string; preview: string; length: number }> {
  return pairs.map(({ name, value }) => ({
    name,
    preview: value.length <= 6 ? "…" : `${value.slice(0, 4)}…${value.slice(-2)}`,
    length: value.length,
  }))
}
