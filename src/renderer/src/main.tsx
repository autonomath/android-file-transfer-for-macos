import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

interface RendererErrorBoundaryState {
  error: Error | null;
}

function StartupFailure(): JSX.Element {
  return (
    <main className="startup-failure">
      <section>
        <h1>Android File Transfer for macOS could not finish opening.</h1>
        <p>
          The window loaded, but the Mac helper connection did not start. Close the app and open the
          newest build again. If this message stays here, the app package is missing its startup helper.
        </p>
      </section>
    </main>
  );
}

class RendererErrorBoundary extends Component<{ children: ReactNode }, RendererErrorBoundaryState> {
  state: RendererErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed before the file-transfer UI could continue.', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <main className="startup-failure">
        <section>
          <h1>Android File Transfer for macOS hit a display problem.</h1>
          <p>
            The app window is open, but the file-transfer view stopped before it could continue.
            Relaunch the window and keep the phone connected.
          </p>
          <p className="startup-error-detail">{error.message || 'Unknown renderer error.'}</p>
          <div className="startup-actions">
            <button type="button" onClick={() => window.location.reload()}>
              Relaunch Window
            </button>
            {window.mtp && (
              <button type="button" onClick={() => void window.mtp.openLog()}>
                Open Log
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RendererErrorBoundary>{window.mtp ? <App /> : <StartupFailure />}</RendererErrorBoundary>
  </React.StrictMode>
);
