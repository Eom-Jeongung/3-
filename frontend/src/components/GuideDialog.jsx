import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'

// 1분 사용 안내: 사이드바 아래 버튼으로 연다. 처음 온 사람이 설명 없이 혼자 써 볼 수 있게 화면 5개를 한 장에
const STEPS = [
  {
    icon: 'grid', title: '대시보드', href: '#/',
    text: '최근 12개월에 공개된 특허 수를 자사·삼성·중국 4사로 나눠 보고, 1년 전보다 늘었는지 확인해요. 아래로 내리면 연간 출원 추이와 기술 분야별 비중이 있어요.',
  },
  {
    icon: 'chart', title: '기술 분야별 분석', href: '#/field',
    text: '방식(OLED·LCD…) → 기술 분야(회로·소자…) → 세부 기술 순서로 좁혀 가요. 분야마다 작은 그래프에서 세 회사를 겹쳐 비교하고, 아래 특허 목록을 CSV로 내려받을 수 있어요.',
  },
  {
    icon: 'sparkle', title: 'AI 동향 요약', href: '#/summary',
    text: '분야와 기간을 고르면 자사와 경쟁사를 비교한 요약이 나와요. 숫자는 DB에서 계산한 값이고 AI는 문장만 써요. 지난 요약은 "보관함"에서 다시 보고, 복사하거나 내려받을 수 있어요.',
  },
  {
    icon: 'radar', title: '신기술 탐지', href: '#/emerging',
    text: '최근 2년 특허에서 예전보다 눈에 띄게 많이 나온 용어예요. "초기 신호"는 예전엔 없던 새 용어예요. 용어를 누르면 그 말이 나온 특허를 볼 수 있어요.',
  },
  {
    icon: 'docs', title: '특허 목록', href: '#/patents',
    text: '맨 위 검색창이나 필터로 특허를 찾고, 행을 누르면 초록·대표 청구항·도면·분류 근거·AI 개별 요약을 볼 수 있어요.',
  },
]

const NOTES = [
  '그래프의 회색 음영과 점선은 아직 공개가 덜 된 기간이에요. 특허는 출원 후 약 18개월 뒤 공개돼서, 줄어든 게 아니에요.',
  '새 특허는 90일마다 자동으로 받아와요. 마지막 갱신 시각은 이 메뉴 아래에 있어요.',
  '분류는 규칙 기반 자동 분류(정확도 약 85%)이고, 중국 4사는 한국에 낸 출원만 집계해요.',
]

export default function GuideDialog({ onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="guide-backdrop" onClick={onClose}>
      <section className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="닫기">✕</button>
        <h2 id="guide-title">1분 사용 안내</h2>
        <p className="guide-lead">LG디스플레이와 경쟁사의 한국 공개 특허를 기술 분야별로 나눠, 어디서 출원이 늘고 있는지 보여 주는 도구예요.</p>
        <ol className="guide-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <span className="guide-icon"><Icon name={s.icon} /></span>
              <div>
                <a href={s.href} onClick={onClose}><b>{s.title}</b></a>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="guide-notes">
          {NOTES.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>
    </div>
  )
}
