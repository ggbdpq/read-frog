import type { InputTranslationLang } from "@/types/config/config"
import { getAllLanguageItems, getTargetLanguageItems } from "@/components/language-combobox-options"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { getLanguageLabel } from "@/utils/language-labels"
import { cn } from "@/utils/styles/utils"
import { SELECT_CONTENT_PROPS } from "../../../components/select-content-props"

/**
 * One side of the pair, at the size every other settings select renders at. The caller sizes
 * the trigger — the label it has to hold is a language's name, which the caller knows more
 * about fitting than this does.
 *
 * `side` picks the language rows: the target side offers only what the translation backend can
 * produce, the source side offers every language the text might be written in. The two pinned
 * rows (`sourceCode` / `targetCode`) are not languages themselves and stay on both.
 */
export function LangSelect({
  value,
  onValueChange,
  getDisplayLabel,
  side = "source",
  className,
}: {
  value: InputTranslationLang
  onValueChange: (value: InputTranslationLang) => void
  getDisplayLabel: (value: InputTranslationLang) => string
  side?: "source" | "target"
  className?: string
}) {
  const languageItems = side === "target" ? getTargetLanguageItems() : getAllLanguageItems()

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as InputTranslationLang)}>
      <SelectTrigger size="sm" className={cn("w-full min-w-0", className)}>
        <SelectValue render={<span className="min-w-0 flex-1" />}>
          <span className="block min-w-0 truncate">{getDisplayLabel(value)}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64" {...SELECT_CONTENT_PROPS}>
        <SelectGroup>
          <SelectItem value="targetCode">{getDisplayLabel("targetCode")}</SelectItem>
          <SelectItem value="sourceCode">{getDisplayLabel("sourceCode")}</SelectItem>
          {languageItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {getLanguageLabel(item.value)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
