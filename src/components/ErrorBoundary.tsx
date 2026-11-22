import React from 'react';
import { isTauriRuntime } from '../api/tauri';
import { CloseIcon, RefreshIcon } from './Icons';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Window route context so recovery controls adapt to main vs frameless standalone windows. */
  route?: 'main' | 'calendar' | 'note';
  /** Optional window/section title displayed in the recovery titlebar. */
  title?: string;
  /** Optional close callback; defaults to closing the current Tauri/browser window. */
  onClose?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function defaultTitleForRoute(route?: 'main' | 'calendar' | 'note'): string {
  if (route === 'calendar') return 'DeskTag — 日历视图';
  if (route === 'note') return 'DeskTag — 独立便签';
  return 'DeskTag';
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[DeskTag ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleClose = async (): Promise<void> => {
    if (this.props.onClose) {
      this.props.onClose();
      return;
    }
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
        return;
      } catch {
        // Fallback below
      }
    }
    if (typeof window !== 'undefined') {
      window.close();
    }
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const title = this.props.title ?? defaultTitleForRoute(this.props.route);
    const message = error.message || String(error);

    return (
      <div
        className="dt-error-boundary"
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          minHeight: 0,
          background: 'var(--bg-panel, #fcfbf7)',
          color: 'var(--text-primary, #2c2824)',
          border: '1px solid var(--border, #e2ded2)',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <header
          data-tauri-drag-region
          style={{
            height: 40,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px 0 14px',
            background: 'var(--bg-header, #f5f2ea)',
            borderBottom: '1px solid var(--border, #e2ded2)',
          }}
        >
          <span
            data-tauri-drag-region
            style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary, #2c2824)' }}
          >
            {title}
          </span>
          <button
            type="button"
            title="关闭窗口"
            aria-label="关闭窗口"
            onClick={() => void this.handleClose()}
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary, #625b53)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>界面渲染遇到异常</div>
          <div
            style={{
              fontSize: 12.5,
              color: 'var(--text-secondary, #625b53)',
              maxWidth: 420,
              lineHeight: 1.55,
            }}
          >
            视图发生意外错误，你的本地数据不会丢失。你可以重新加载此窗口或安全关闭。
          </div>
          <pre
            style={{
              margin: 0,
              padding: '8px 12px',
              maxWidth: 440,
              maxHeight: 120,
              overflow: 'auto',
              borderRadius: 8,
              background: 'var(--bg-surface, #ffffff)',
              border: '1px solid var(--border, #e2ded2)',
              color: 'var(--danger, #d44643)',
              fontSize: 11.5,
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
            }}
          >
            {message}
          </pre>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 9,
                border: 'none',
                background: 'var(--accent, #df6542)',
                color: 'var(--accent-text, #ffffff)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshIcon size={14} />
              <span>重新加载</span>
            </button>
            <button
              type="button"
              onClick={() => void this.handleClose()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 9,
                border: '1px solid var(--border, #e2ded2)',
                background: 'var(--bg-surface, #ffffff)',
                color: 'var(--text-primary, #2c2824)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <CloseIcon size={14} />
              <span>关闭窗口</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
