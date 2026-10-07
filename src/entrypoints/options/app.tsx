import type { ComponentType } from "react"
import { lazy, Suspense } from "react"
import { Route, Routes } from "react-router"
import { ROUTE_DEFS } from "./app-sidebar/nav-items"

type RoutePath = (typeof ROUTE_DEFS)[number]["path"]

const PreferencePage = lazy(() =>
  import("./pages/preference").then((module) => ({ default: module.PreferencePage })),
)
const ShortcutsPage = lazy(() =>
  import("./pages/shortcuts").then((module) => ({ default: module.ShortcutsPage })),
)
const ApiProvidersPage = lazy(() =>
  import("./pages/api-providers").then((module) => ({ default: module.ApiProvidersPage })),
)
const DoubaoAccountPage = lazy(() =>
  import("./pages/doubao-account").then((module) => ({ default: module.DoubaoAccountPage })),
)
const TranslationPage = lazy(() =>
  import("./pages/translation").then((module) => ({ default: module.TranslationPage })),
)
const FloatingButtonPage = lazy(() =>
  import("./pages/floating-button").then((module) => ({ default: module.FloatingButtonPage })),
)
const SelectionToolbarPage = lazy(() =>
  import("./pages/selection-toolbar").then((module) => ({ default: module.SelectionToolbarPage })),
)
const ContextMenuPage = lazy(() =>
  import("./pages/context-menu").then((module) => ({ default: module.ContextMenuPage })),
)
const InputTranslationPage = lazy(() =>
  import("./pages/input-translation").then((module) => ({ default: module.InputTranslationPage })),
)
const HelpAndCommunityPage = lazy(() =>
  import("./pages/help-and-community").then((module) => ({ default: module.HelpAndCommunityPage })),
)
const CustomCssPage = lazy(() =>
  import("./pages/translation/translation-style/custom-css").then((module) => ({
    default: module.CustomCssPage,
  })),
)
const AutoTranslateWebsitesPage = lazy(() =>
  import("./pages/translation/translation-control/website-patterns-page").then((module) => ({
    default: module.AutoTranslateWebsitesPage,
  })),
)
const NeverAutoTranslateWebsitesPage = lazy(() =>
  import("./pages/translation/translation-control/website-patterns-page").then((module) => ({
    default: module.NeverAutoTranslateWebsitesPage,
  })),
)
const TranslationControlPage = lazy(() =>
  import("./pages/translation/translation-control/control-page").then((module) => ({
    default: module.TranslationControlPage,
  })),
)
const SiteRulesPage = lazy(() =>
  import("./pages/translation/translation-control/site-rules").then((module) => ({
    default: module.SiteRulesPage,
  })),
)
const TranslationQueuePage = lazy(() =>
  import("./pages/translation/translation-queue/queue-page").then((module) => ({
    default: module.TranslationQueuePage,
  })),
)

const ROUTE_COMPONENTS: Record<RoutePath, ComponentType> = {
  "/": ApiProvidersPage,
  "/preference": PreferencePage,
  "/shortcuts": ShortcutsPage,
  "/api-providers": ApiProvidersPage,
  "/doubao-account": DoubaoAccountPage,
  "/page-translation": TranslationPage,
  "/floating-button": FloatingButtonPage,
  "/selection-toolbar": SelectionToolbarPage,
  "/context-menu": ContextMenuPage,
  "/input-translation": InputTranslationPage,
  "/help-and-community": HelpAndCommunityPage,
  "/page-translation/custom-css": CustomCssPage,
  "/page-translation/translation-control": TranslationControlPage,
  "/page-translation/translation-control/auto-translate-websites": AutoTranslateWebsitesPage,
  "/page-translation/translation-control/never-auto-translate-websites":
    NeverAutoTranslateWebsitesPage,
  "/page-translation/translation-control/site-rules": SiteRulesPage,
  "/page-translation/translation-queue": TranslationQueuePage,
}

function RouteLoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      Loading settings...
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        {ROUTE_DEFS.map(({ path }) => {
          const Component = ROUTE_COMPONENTS[path]
          return <Route key={path} path={path} element={<Component />} />
        })}
      </Routes>
    </Suspense>
  )
}
