import { Icon } from "@iconify/react"
import { i18n } from "@/utils/i18n"
import { openOptionsPage } from "@/utils/navigation"
import { version } from "../../../package.json"
import { DoubaoAccountStatus } from "./components/doubao-account-status"
import { DoubaoServiceSwitcher } from "./components/doubao-service-switcher"
import { MoreMenu } from "./components/more-menu"
import TranslateButton from "./components/translate-button"

/**
 * 二次开发精简版：只剩「豆包账号状态 + 三个翻译服务切换 + 当前页翻译开关」，
 * 以及底部一行工具条。模型选择、内置 AI 用量、账号订阅等入口都已下线。
 */
function App() {
  return (
    <>
      <div className="flex flex-col gap-4 bg-background px-6 pt-5 pb-4">
        <DoubaoAccountStatus />
        <DoubaoServiceSwitcher />
        <TranslateButton className="w-full" />
      </div>
      <div className="flex items-center justify-between bg-neutral-200 px-2 py-1 dark:bg-neutral-800">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-300 dark:hover:bg-neutral-700"
          onClick={() => {
            void openOptionsPage()
          }}
        >
          <Icon icon="tabler:settings" className="size-4" strokeWidth={1.6} />
          <span className="text-[13px] font-medium">{i18n.t("popup.options")}</span>
        </button>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">{version}</span>
        <MoreMenu />
      </div>
    </>
  )
}

export default App
