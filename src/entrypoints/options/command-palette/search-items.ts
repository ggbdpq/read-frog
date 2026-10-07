import type { GeneratedI18nStructure } from "#i18n"

type I18nKey = keyof GeneratedI18nStructure

export interface SearchItem {
  sectionId: string
  route: string
  titleKey: string
  descriptionKey?: string
  pageKey: string
}

type SearchItemDefinition = Omit<SearchItem, "titleKey" | "descriptionKey" | "pageKey"> & {
  titleKey: I18nKey
  descriptionKey?: I18nKey
  pageKey: I18nKey
}

export const SEARCH_ITEMS: SearchItem[] = [
  // Preference page
  {
    // Titled with the section, so "appearance" still finds a row that reads "Theme".
    sectionId: "theme",
    route: "/preference",
    titleKey: "options.preference.appearanceAndLanguage.title",
    descriptionKey: "options.preference.appearanceAndLanguage.theme.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "interface-language",
    route: "/preference",
    titleKey: "options.preference.appearanceAndLanguage.interfaceLanguage.title",
    descriptionKey: "options.preference.appearanceAndLanguage.interfaceLanguage.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "translation-source-language",
    route: "/preference",
    titleKey: "options.preference.translationLanguage.sourceCode.title",
    descriptionKey: "options.preference.translationLanguage.sourceCode.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "translation-target-language",
    route: "/preference",
    titleKey: "options.preference.translationLanguage.targetCode.title",
    descriptionKey: "options.preference.translationLanguage.targetCode.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "manual-config-sync",
    route: "/preference",
    titleKey: "options.preference.config.manualSync.title",
    descriptionKey: "options.preference.config.manualSync.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "reset-config",
    route: "/preference",
    titleKey: "options.preference.config.reset.title",
    descriptionKey: "options.preference.config.reset.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "beta-experience",
    route: "/preference",
    titleKey: "options.preference.userExperience.beta.title",
    descriptionKey: "options.preference.userExperience.beta.description",
    pageKey: "options.preference.title",
  },
  {
    sectionId: "analytics",
    route: "/preference",
    titleKey: "options.preference.userExperience.analytics.title",
    descriptionKey: "options.preference.userExperience.analytics.description",
    pageKey: "options.preference.title",
  },

  // Shortcuts page
  {
    sectionId: "page-translation-shortcut",
    route: "/shortcuts",
    titleKey: "options.shortcuts.pageTranslation.title",
    descriptionKey: "options.shortcuts.pageTranslation.description",
    pageKey: "options.shortcuts.title",
  },
  {
    sectionId: "translation-mode-shortcut",
    route: "/shortcuts",
    titleKey: "options.shortcuts.translationMode.title",
    descriptionKey: "options.shortcuts.translationMode.description",
    pageKey: "options.shortcuts.title",
  },
  {
    sectionId: "selection-translation-shortcut",
    route: "/shortcuts",
    titleKey: "options.shortcuts.selectionTranslation.title",
    descriptionKey: "options.shortcuts.selectionTranslation.description",
    pageKey: "options.shortcuts.title",
  },
  {
    sectionId: "subtitles-toggle-shortcut",
    route: "/shortcuts",
    titleKey: "options.shortcuts.subtitlesToggle.title",
    descriptionKey: "options.shortcuts.subtitlesToggle.description",
    pageKey: "options.shortcuts.title",
  },
  {
    sectionId: "node-translation-hotkey",
    route: "/shortcuts",
    titleKey: "options.shortcuts.nodeTranslation.title",
    descriptionKey: "options.shortcuts.nodeTranslation.description",
    pageKey: "options.shortcuts.title",
  },
  {
    sectionId: "translation-hub-shortcut",
    route: "/shortcuts",
    titleKey: "options.shortcuts.translationHub.title",
    descriptionKey: "options.shortcuts.translationHub.description",
    pageKey: "options.shortcuts.title",
  },

  // Translation page
  {
    sectionId: "translation-mode",
    route: "/page-translation",
    titleKey: "options.translation.preference.translationMode.title",
    descriptionKey: "options.translation.preference.translationMode.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "translate-range",
    route: "/page-translation",
    titleKey: "options.translation.preference.translateRange.title",
    descriptionKey: "options.translation.preference.translateRange.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "translate-title",
    route: "/page-translation",
    titleKey: "options.translation.preference.translateTitle.title",
    descriptionKey: "options.translation.preference.translateTitle.description",
    pageKey: "options.translation.title",
  },
  {
    // Titled with the section, so the row that reads "Enable" is still findable on its own.
    sectionId: "hover-translation",
    route: "/page-translation",
    titleKey: "options.translation.hoverTranslation.title",
    descriptionKey: "options.translation.hoverTranslation.enable.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "translation-style",
    route: "/page-translation",
    titleKey: "options.translation.translationStyle.title",
    descriptionKey: "options.translation.translationStyle.description",
    pageKey: "options.translation.title",
  },
  {
    // Its own page, drilled into from the Translation Display Style section.
    sectionId: "custom-css",
    route: "/page-translation/custom-css",
    titleKey: "options.translation.translationStyle.cssEditor",
    descriptionKey: "options.translation.translationStyle.cssEditorDescription",
    pageKey: "options.translation.title",
  },
  {
    // Its own page, drilled into from the Translation control section.
    sectionId: "auto-translate-website",
    route: "/page-translation/translation-control/auto-translate-websites",
    titleKey: "options.translation.translationControl.autoTranslateWebsite.title",
    descriptionKey: "options.translation.translationControl.autoTranslateWebsite.description",
    pageKey: "options.translation.title",
  },
  {
    // Its own page, drilled into from the Translation control section.
    sectionId: "never-auto-translate-website",
    route: "/page-translation/translation-control/never-auto-translate-websites",
    titleKey: "options.translation.translationControl.neverAutoTranslateWebsite.title",
    descriptionKey: "options.translation.translationControl.neverAutoTranslateWebsite.description",
    pageKey: "options.translation.title",
  },
  {
    // On the Translation control page, drilled into from the Translation page.
    sectionId: "auto-translate-languages",
    route: "/page-translation/translation-control",
    titleKey: "options.translation.translationControl.autoTranslateLanguages.title",
    descriptionKey: "options.translation.translationControl.autoTranslateLanguages.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "skip-languages",
    route: "/page-translation/translation-control",
    titleKey: "options.translation.translationControl.skipLanguages.title",
    descriptionKey: "options.translation.translationControl.skipLanguages.description",
    pageKey: "options.translation.title",
  },
  {
    // On the Translation queue page, drilled into from the Translation page.
    sectionId: "request-rate",
    route: "/page-translation/translation-queue",
    titleKey: "options.translation.translationQueue.requestQueueConfig.title",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "request-batch",
    route: "/page-translation/translation-queue",
    titleKey: "options.translation.translationQueue.batchQueueConfig.title",
    descriptionKey: "options.translation.translationQueue.batchQueueConfig.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "preload-config",
    route: "/page-translation/translation-queue",
    titleKey: "options.translation.translationQueue.preloadConfig.title",
    descriptionKey: "options.translation.translationQueue.preloadConfig.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "small-paragraph-filter",
    route: "/page-translation/translation-control",
    titleKey: "options.translation.translationControl.smallParagraphFilter.title",
    descriptionKey: "options.translation.translationControl.smallParagraphFilter.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "clear-cache",
    route: "/page-translation",
    titleKey: "options.translation.cache.clearCache.title",
    descriptionKey: "options.translation.cache.clearCache.description",
    pageKey: "options.translation.title",
  },
  {
    // Its own page, drilled into from the Translation control section.
    sectionId: "site-rules-user-rules",
    route: "/page-translation/translation-control/site-rules",
    titleKey: "options.siteRules.userRules.title",
    descriptionKey: "options.siteRules.userRules.description",
    pageKey: "options.translation.title",
  },
  {
    sectionId: "site-rules-built-in",
    route: "/page-translation/translation-control/site-rules",
    titleKey: "options.siteRules.builtIn.title",
    descriptionKey: "options.siteRules.builtIn.description",
    pageKey: "options.translation.title",
  },

  // Floating Button page
  {
    sectionId: "floating-button-toggle",
    route: "/floating-button",
    titleKey: "options.floatingButton.enable.title",
    descriptionKey: "options.floatingButton.enable.description",
    pageKey: "options.floatingButton.title",
  },
  {
    sectionId: "floating-button-side",
    route: "/floating-button",
    titleKey: "options.floatingButton.display.side.title",
    descriptionKey: "options.floatingButton.display.side.description",
    pageKey: "options.floatingButton.title",
  },
  {
    sectionId: "floating-button-disabled-sites",
    route: "/floating-button",
    titleKey: "options.floatingButton.display.disabledSites.title",
    descriptionKey: "options.floatingButton.display.disabledSites.description",
    pageKey: "options.floatingButton.title",
  },
  {
    sectionId: "floating-button-click-action",
    route: "/floating-button",
    titleKey: "options.floatingButton.clickAction.title",
    descriptionKey: "options.floatingButton.clickAction.description",
    pageKey: "options.floatingButton.title",
  },

  // Selection Toolbar page
  {
    sectionId: "selection-toolbar-toggle",
    route: "/selection-toolbar",
    titleKey: "options.selectionToolbar.enable.title",
    descriptionKey: "options.selectionToolbar.enable.description",
    pageKey: "options.selectionToolbar.title",
  },
  {
    // Titled with the section, so "translate" and "speak" both find the rows that switch
    // them on without either row's one-word title standing alone in the results.
    sectionId: "selection-toolbar-actions",
    route: "/selection-toolbar",
    titleKey: "options.selectionToolbar.actions.title",
    descriptionKey: "options.selectionToolbar.actions.translate.description",
    pageKey: "options.selectionToolbar.title",
  },
  {
    sectionId: "selection-toolbar-note-suggestion",
    route: "/selection-toolbar",
    titleKey: "options.selectionToolbar.actions.noteSuggestion.title",
    descriptionKey: "options.selectionToolbar.actions.noteSuggestion.description",
    pageKey: "options.selectionToolbar.title",
  },
  {
    sectionId: "selection-toolbar-opacity",
    route: "/selection-toolbar",
    titleKey: "options.selectionToolbar.display.opacity.title",
    descriptionKey: "options.selectionToolbar.display.opacity.description",
    pageKey: "options.selectionToolbar.title",
  },
  {
    sectionId: "selection-toolbar-disabled-sites",
    route: "/selection-toolbar",
    titleKey: "options.selectionToolbar.display.disabledSites.title",
    descriptionKey: "options.selectionToolbar.display.disabledSites.description",
    pageKey: "options.selectionToolbar.title",
  },

  // Context Menu page
  {
    sectionId: "context-menu-translate",
    route: "/context-menu",
    titleKey: "options.contextMenu.enable.title",
    descriptionKey: "options.contextMenu.enable.description",
    pageKey: "options.contextMenu.title",
  },

  // Input Translation page
  {
    // Titled with the section, so the row that reads "Enable" is still findable on its own.
    sectionId: "input-translation-trigger",
    route: "/input-translation",
    titleKey: "options.inputTranslation.trigger.title",
    descriptionKey: "options.inputTranslation.trigger.enable.description",
    pageKey: "options.inputTranslation.title",
  },
  {
    sectionId: "input-translation-threshold",
    route: "/input-translation",
    titleKey: "options.inputTranslation.trigger.threshold.title",
    descriptionKey: "options.inputTranslation.trigger.threshold.description",
    pageKey: "options.inputTranslation.title",
  },
  {
    sectionId: "input-translation-languages",
    route: "/input-translation",
    titleKey: "options.inputTranslation.languages.title",
    descriptionKey: "options.inputTranslation.languages.pair.description",
    pageKey: "options.inputTranslation.title",
  },
  {
    sectionId: "input-translation-cycle",
    route: "/input-translation",
    titleKey: "options.inputTranslation.languages.cycle.title",
    descriptionKey: "options.inputTranslation.languages.cycle.description",
    pageKey: "options.inputTranslation.title",
  },
] satisfies SearchItemDefinition[]
