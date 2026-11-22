// 'IPC 추정' 표시: 3차를 키워드가 아니라 IPC 코드로 정한 특허 (2026-11 담당자님 피드백)
// IPC→3차 규칙은 규칙마다 표본을 직접 채점해 75% 이상 맞은 9개만 쓴다 (backend/classification/ipc_level3_validation.csv)
export function EstimateBadge() {
  return (
    <span className="estimate-badge" title="명칭·초록에 맞는 키워드가 없어 IPC 코드로 3차를 추정했어요. 표본 채점에서 75% 이상 맞은 IPC 규칙만 써요">
      IPC 추정
    </span>
  )
}
