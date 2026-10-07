import { describe, expect, it } from "vitest"
import { describeProbe } from "../probe"

describe("describeProbe", () => {
  it("reports a successful probe with the server's success code", () => {
    const view = describeProbe({ ok: true, code: 0 })

    expect(view.ok).toBe(true)
    expect(view.text).toContain("鉴权成功")
    expect(view.text).toContain("0")
  })

  it("names the expired-session code so the user knows to log in again", () => {
    const view = describeProbe({ ok: false, code: 710012001, msg: "登录已过期，请重新登录" })

    expect(view.ok).toBe(false)
    expect(view.text).toContain("登录已过期")
    expect(view.text).toContain("710012001")
  })

  it("calls a probe with no server code a network error", () => {
    const view = describeProbe({ ok: false, msg: "Failed to fetch" })

    expect(view.ok).toBe(false)
    expect(view.text).toContain("网络错误")
    expect(view.text).toContain("Failed to fetch")
  })

  it("still explains a network error that carries no message", () => {
    const view = describeProbe({ ok: false })

    expect(view.text).toContain("网络错误")
  })

  it("falls back to the raw code for an error it does not know", () => {
    const view = describeProbe({ ok: false, code: 710099999, msg: "未知错误" })

    expect(view.text).toContain("710099999")
    expect(view.text).toContain("未知错误")
  })
})
