---
"@read-frog/extension": minor
---

feat(translation): add Doubao native translation and trim the product to three services

Read Frog now translates through ByteDance Doubao's own plugin endpoint
(`POST https://www.doubao.com/samantha/plugin/stream_article_translate`) using the
doubao.com login cookie, and ships with exactly three translation services —
火山引擎 (`translate_service: "0"`), 豆包 AI (`"1"`) and 微软 (`"3"`).

- New "豆包账号" settings page: opens doubao.com to sign in, captures and probes the
  login cookie, shows which required cookies were found in masked form, clears the
  stored session, and accepts a manually pasted cookie (writing it back into the
  browser cookie jar stays off unless explicitly confirmed).
- The cookie is attached by the browser itself: requests are sent with
  `credentials: "include"`, so the httpOnly login cookies go along without the
  extension ever handling the `Cookie` header (which `fetch` forbids anyway).
- Batch translation with the endpoint's real limits (≤ 50 segments / ≤ 10,000
  characters per request, two-times margin under the server's 100-segment cap and
  under the length where output quality degrades), with results placed back by
  `data.items[].index`.
- Translation scenes use the endpoint's numeric enum: full page (1), AI reader (2),
  selection (3) and hover (6). The value is always sent as a **number** — a string
  makes the server answer `710010202 系统错误`.
- Straightforward failures instead of silent ones: the `event:err` SSE frame, the
  plain-JSON error bodies this endpoint returns for over-limit or malformed
  requests, and a request stream that ends without `event:done`.
- Model configuration is gone: the provider page lists only the three services with
  an enable switch, and the model / reasoning / provider options / base URL / API key
  fields no longer appear. The popup is reduced to the account status, the three
  services and the current-page translate toggle, and the settings for video
  subtitles, text-to-speech, custom actions, the glossary and Google Drive sync are
  no longer reachable.
