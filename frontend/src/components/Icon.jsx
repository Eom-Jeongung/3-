// 선 아이콘 모음 (24×24, 글자색을 따라간다). Figma 시안의 사이드바·대시보드 아이콘 자리에 쓴다
const PATHS = {
  layers: <><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  chart: <><path d="M4 20h16" /><path d="m5 15 4-4 3 3 6-7" /><path d="M14 7h4v4" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m12 8 1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5Z" /></>,
  radar: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 12 18 6" /></>,
  docs: <><path d="M8 4h7l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M15 4v4h4M9.5 13h6M9.5 16.5h4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  building: <><path d="M5 20V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14" /><path d="M16 10h2a2 2 0 0 1 2 2v8M3 20h18M9 8h3M9 12h3M9 16h3" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5Z" /></>,
  trend: <><path d="m4 16 5-5 3 3 7-7" /><path d="M15 7h4v4" /></>,
  arrowRight: <path d="m9 6 6 6-6 6" />,
  // 기술 분야 (2차 분류)
  pen: <><path d="m14 5 5 5-9 9H5v-5l9-9Z" /><path d="M5 19 9.5 14.5" /><circle cx="11.5" cy="12.5" r="1.3" /></>,
  stack: <><path d="M12 4 4 8l8 4 8-4-8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>,
  sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l9-11.5h-6L13 3Z" />,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" /></>,
  circuit: <><path d="M4 7h5l3 5h8M4 17h5l3-5" /><circle cx="4" cy="7" r="1.5" /><circle cx="4" cy="17" r="1.5" /><circle cx="20" cy="12" r="1.5" /></>,
  flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></>,
  atom: <><circle cx="12" cy="12" r="1.5" /><ellipse cx="12" cy="12" rx="9" ry="3.8" /><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)" /></>,
}

export default function Icon({ name, className = '' }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name] ?? PATHS.grid}
    </svg>
  )
}
