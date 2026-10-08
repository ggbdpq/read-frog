import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { getDoubaoAuth } from "@/utils/doubao-auth"

const QUERY_KEY = ["doubao-auth-record"]

/**
 * 豆包登录态记录 —— popup 徽标、翻译服务页、账号页共用同一份查询缓存。
 *
 * 保存 / 清除登录态后调用 `refresh()`，所有订阅方一起更新。
 */
export function useDoubaoAuthRecord() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getDoubaoAuth,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }, [queryClient])

  return { record: query.data ?? null, loading: query.isPending, refresh }
}
