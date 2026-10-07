import { Icon } from "@iconify/react"
import { Link, useLocation } from "react-router"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/base-ui/sidebar"
import { i18n } from "@/utils/i18n"

/**
 * 「翻译服务」与「豆包账号」是二次开发新写的页面，文案按需求硬编码中文，
 * 故意不走 i18n —— 往 locales 里加 key 一旦漏了语言文件，界面就会出现裸 key。
 */
export function SettingsNav() {
  const { pathname } = useLocation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{i18n.t("options.sidebar.settings")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/api-providers" />}
              isActive={pathname === "/api-providers" || pathname === "/"}
              tooltip="翻译服务"
            >
              <Icon icon="tabler:api" />
              <span>翻译服务</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/doubao-account" />}
              isActive={pathname === "/doubao-account"}
              tooltip="豆包账号"
            >
              <Icon icon="tabler:user-circle" />
              <span>豆包账号</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/preference" />}
              isActive={pathname.startsWith("/preference")}
              tooltip={i18n.t("options.preference.title")}
            >
              <Icon icon="tabler:adjustments-horizontal" />
              <span>{i18n.t("options.preference.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/shortcuts" />}
              isActive={pathname === "/shortcuts"}
              tooltip={i18n.t("options.shortcuts.title")}
            >
              <Icon icon="tabler:command" />
              <span>{i18n.t("options.shortcuts.title")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
