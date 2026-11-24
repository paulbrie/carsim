import { ImageResponse } from 'next/og';

// The picture a link to Carsim shows when it is shared.
export const alt = 'Carsim: humans vs tiny neural networks';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  const human = '#ff7a33', tnn = '#58d6e6';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0d0f14', color: '#f2f3f5', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 40, fontWeight: 700 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <path d="M22.4 8.3A10 10 0 0 0 6 16" fill="none" stroke={human} strokeWidth="4.2" strokeLinecap="round" />
            <path d="M6 16A10 10 0 0 0 22.4 23.7" fill="none" stroke={tnn} strokeWidth="4.2" strokeLinecap="round" />
            <circle cx="22.4" cy="8.3" r="3.4" fill={human} />
            <circle cx="22.4" cy="23.7" r="3.4" fill={tnn} />
          </svg>
          Carsim
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 104, fontWeight: 800, lineHeight: 1.02, letterSpacing: -3 }}>
          <div style={{ display: 'flex' }}><span style={{ color: human }}>Humans</span><span style={{ color: '#6b7280', marginLeft: 28 }}>vs.</span></div>
          <div style={{ display: 'flex' }}><span style={{ color: tnn }}>tiny neural</span></div>
          <div style={{ display: 'flex' }}>networks.</div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#a4a9b6' }}>Same cars, same physics, same tracks. Drive, or train your own.</div>
      </div>
    ),
    size,
  );
}
