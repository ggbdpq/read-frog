/**
 * `mock-doubao-server.mjs` 的类型声明。
 *
 * 该 mock 用 .mjs 写（方便在 vitest 里直接 import，无需构建），
 * 这里补一份声明，避免 `TS7016: implicitly has an 'any' type` 污染 type-check 门禁。
 */

export interface MockRequestRecord {
  url: string | undefined
  headers: Record<string, string | undefined>
  body: Record<string, unknown>
}

export interface MockDoubao {
  readonly origin: string
  scenario: string
  readonly requests: MockRequestRecord[]
  itemOrder: number[] | null
  trickle: boolean
  firstChunkBytes: number
  reset(scenario?: string): void
  /** 把 https://www.doubao.com 的请求改写到本 mock，返回还原函数。 */
  installFetchRewrite(): () => void
  stop(): Promise<void>
}

export declare function startMockDoubao(): Promise<MockDoubao>

export declare function sseJsonFrame(payload: unknown): string
export declare function sseDoneFrame(): string
export declare function sseErrFrame(code: number, msg: string): string

export interface MockItem {
  res: string
  detect_lang: string
  index: number
}

export declare function itemsFor(
  texts: readonly string[],
  order: readonly number[] | null,
): MockItem[]

export declare function permutationFor(n: number): number[]
