import { useCallback, useEffect, useRef, useState } from 'react'

export const PAGE_SIZE = 10 // 서버에서 한 번에 받는 건수 ("더보기" 한 번에 늘어나는 건수)

/** 필터에 맞는 특허 목록을 나눠 받는다. 필터·정렬이 바뀌거나 새로고침하면 첫 페이지부터 다시 받는다 */
export function usePatentList(params, refreshKey) {
  const [data, setData] = useState(null) // items는 지금까지 받은 만큼, total은 필터에 맞는 전체 건수
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0) // 필터를 바꾼 뒤 늦게 도착한 이전 응답을 버리기 위한 번호
  const paramKey = JSON.stringify(params)

  const fetchPage = useCallback(async (offset) => {
    const q = new URLSearchParams({ ...JSON.parse(paramKey), limit: PAGE_SIZE, offset })
    const res = await fetch(`/api/patents?${q}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    return body
  }, [paramKey])

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    fetchPage(0)
      .then((body) => {
        if (id !== requestId.current) return
        setData(body)
        setError(null)
      })
      .catch((err) => {
        if (id === requestId.current) setError(`목록을 불러오지 못했습니다: ${err.message}`)
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [fetchPage, refreshKey])

  async function loadMore() {
    const id = ++requestId.current
    setLoadingMore(true)
    try {
      const body = await fetchPage(data.items.length)
      if (id === requestId.current) setData({ ...body, items: [...data.items, ...body.items] })
    } catch (err) {
      if (id === requestId.current) setError(`목록을 불러오지 못했습니다: ${err.message}`)
    } finally {
      setLoadingMore(false)
    }
  }

  const collapse = () => setData((d) => ({ ...d, items: d.items.slice(0, PAGE_SIZE) }))

  return { data, error, loading, loadingMore, loadMore, collapse }
}
