import { PageLayout } from "../../components/page-layout"
import { DoubaoServiceList } from "./doubao-services"

/**
 * 「翻译服务」页。页面文案按二次开发需求硬编码中文，不进 locales。
 */
export function ApiProvidersPage() {
  return (
    <PageLayout
      title="翻译服务"
      description="只提供三个豆包翻译服务，共用同一个豆包登录态。引擎由服务本身决定，不需要配置模型、API Key 或请求地址。"
      innerClassName="flex flex-col gap-10"
    >
      <DoubaoServiceList />
    </PageLayout>
  )
}
