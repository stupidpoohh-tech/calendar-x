/**
 * 예상 못 한 렌더 오류의 마지막 그물.
 *
 * React 는 렌더 중에 오류가 나면 트리 전체를 떼어 낸다 — 화면이 **하얗게** 남는다.
 * 사용자에게는 앱이 사라진 것과 구별되지 않고, 다시 여는 것 말고 할 수 있는 일이 없다.
 *
 * 여기서 잡아 무엇이 났는지 적고, 다시 그려 보기와 새로고침을 준다. 자료를 손대지
 * 않는다 — 오류를 0원이나 빈 목록으로 바꿔 화면에 그리는 것이야말로 가장 나쁜 처리다.
 * 그렇게 하면 사용자는 잘못된 숫자를 사실로 읽는다.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** 이 구역의 이름. 어디가 무너졌는지 알린다. */
  label?: string;
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
    // 조용히 삼키지 않는다. 나중에 오류 추적을 붙일 자리이기도 하다.
    console.error('[render]', this.props.label ?? 'app', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash" role="alert">
        <h1 className="crash-t">화면을 그리지 못했습니다</h1>
        <p className="crash-b">
          {this.props.label ? `${this.props.label} 을(를) 그리는 중 ` : ''}
          예상하지 못한 오류가 났습니다. 저장된 자료는 그대로입니다 — 이 화면은 아무것도
          지우거나 바꾸지 않습니다.
        </p>
        <pre className="crash-e">{error.message || String(error)}</pre>
        <div className="crash-a">
          <button className="btn" onClick={this.retry}>다시 그려 보기</button>
          <button className="btn primary" onClick={() => window.location.reload()}>새로고침</button>
        </div>
      </div>
    );
  }
}
