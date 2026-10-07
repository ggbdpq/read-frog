import type { DoubaoProbeResult } from "@/utils/doubao-auth"
import {
  DOUBAO_CODE_LOGIN_EXPIRED,
  DOUBAO_CODE_PLUGIN_ERROR,
  DOUBAO_CODE_SYSTEM_ERROR,
  DOUBAO_OK_CODE,
} from "@/utils/constants/doubao"

export interface ProbeView {
  ok: boolean
  text: string
}

/** 把探针结果翻译成人话：成功 / 登录已过期 / 网络错误 / 其它服务端错误。 */
export function describeProbe(probe: DoubaoProbeResult): ProbeView {
  if (probe.ok) {
    return { ok: true, text: `鉴权成功（code ${DOUBAO_OK_CODE}）` }
  }
  if (probe.code === DOUBAO_CODE_LOGIN_EXPIRED) {
    return {
      ok: false,
      text: `登录已过期，请重新登录（code ${DOUBAO_CODE_LOGIN_EXPIRED}）`,
    }
  }
  // 网络层失败时服务端没有回过话，`code` 才会是 undefined。
  if (probe.code === undefined) {
    return { ok: false, text: `网络错误：${probe.msg ?? "请求没有拿到响应"}` }
  }
  if (probe.code === DOUBAO_CODE_SYSTEM_ERROR) {
    return { ok: false, text: `服务端系统错误（code ${DOUBAO_CODE_SYSTEM_ERROR}）` }
  }
  if (probe.code === DOUBAO_CODE_PLUGIN_ERROR) {
    return { ok: false, text: `插件层错误（code ${DOUBAO_CODE_PLUGIN_ERROR}）` }
  }
  return {
    ok: false,
    text: `服务端返回错误 code ${probe.code}${probe.msg ? `：${probe.msg}` : ""}`,
  }
}
