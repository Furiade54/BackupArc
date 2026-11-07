import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportarError } from '../utils/reportarError';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportarError({
      origen: 'react',
      mensaje: error.message,
      pila: error.stack ?? null,
      componente: info.componentStack ?? null,
    });
  }

  render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="error-fatal" role="alert">
        <h1>Algo salió mal</h1>
        <p>La interfaz encontró un error inesperado. El fallo quedó registrado en el diagnóstico.</p>
        <p className="error-fatal__detalle">{error.message}</p>
        <button type="button" className="boton" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    );
  }
}
