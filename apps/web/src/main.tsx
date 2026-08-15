import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import { App } from './App';
import { LangProvider } from './stores/LangContext';
import './styles/index.css';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(e: Error) { return { hasError: true, error: e.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #6366f1, #5558e6)', flexDirection: 'column', fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>{this.state.error || 'The app encountered an unexpected error.'}</div>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} style={{ marginTop: 20, padding: '10px 24px', borderRadius: 10, border: 'none', background: '#fff', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider><App /></LangProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
