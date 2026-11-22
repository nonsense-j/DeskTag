import { useEffect, useState } from 'react';
import { loadAppState } from './api/tauri';
import type { AppStateBundle } from './types/models';

export default function App() {
  const [state, setState] = useState<AppStateBundle | null>(null);

  useEffect(() => {
    void loadAppState().then(setState);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#fcfaf8',
        color: '#342e29',
        fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        borderRadius: '14px',
        border: '1px solid #e3e3d8',
        boxSizing: 'border-box',
        padding: '20px',
      }}
    >
      <h1 style={{ margin: '0 0 8px', fontSize: '18px', color: '#e8734a' }}>
        DeskTag — 待办贴
      </h1>
      <p style={{ margin: 0, fontSize: '13px', color: '#7a7268' }}>
        {state
          ? `Ready on ${state.platform.platform} · ${state.data.todos.length} todos · ${state.data.notes.length} notes`
          : 'Loading DeskTag...'}
      </p>
    </div>
  );
}
