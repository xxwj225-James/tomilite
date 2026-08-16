// ═══ App entry point ═══
// Bootstraps the React root inside the Electron renderer:
//   LangProvider  — UI language context (en / zh / ja)
//   ErrorBoundary — top-level crash screen with a Reload button
import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import { App } from './App';
import { LangProvider } from './stores/LangContext';
import './styles/index.css';

// Catches any uncaught render error and shows a full-screen fallback
// (the "Something went wrong" screen) instead of a blank window.
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(e: Error) {
    return { hasError: true, error: e.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: 'linear-gradient(135deg, var(--brand), var(--brand-hover))',
            flexDirection: 'column',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--surface)', marginBottom: 8 }}>
            Something went wrong
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.8)',
              maxWidth: 400,
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            {this.state.error || 'The app encountered an unexpected error.'}
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--surface)',
              color: 'var(--brand)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// React 18 createRoot; StrictMode surfaces double-invocation bugs in dev.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <App />
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
