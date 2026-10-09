import { Component, type ReactNode } from 'react';
import { t } from '../i18n/i18n';

interface Props {
  children: ReactNode;
  /** Leaves the failed view, e.g. back to the report. */
  onReset: () => void;
}

interface State {
  error: Error | null;
}

/** Keeps one broken view from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="report-error" role="alert">
        <p className="muted">{t('error.view', { reason: this.state.error.message })}</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            this.props.onReset();
            this.setState({ error: null });
          }}
        >
          {t('detail.back')}
        </button>
      </div>
    );
  }
}
