'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';
export class DocumentIntelligenceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(JSON.stringify({ event: 'document_intelligence_ui_error', message: error.message, componentStack: info.componentStack })); }
  render() { return this.state.failed ? <div className="card"><h2>Document workspace unavailable</h2><p className="note">Reload the page or review ingestion status in Admin Activity.</p></div> : this.props.children; }
}
