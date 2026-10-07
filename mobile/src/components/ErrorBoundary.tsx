import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportReactError } from '../platform/errorTrap';

/**
 * 兜住 React 渲染期异常。
 * 没有它时，任何一个页面渲染出错都会让 React 卸载整棵树 → 用户只看到白屏，
 * 且不知道是哪个页面、什么原因（真机反馈的采集页/检索页白屏就是这种情况）。
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportReactError(error, info.componentStack ?? '');
  }

  render() {
    // 浮层已经把细节显示出来了；这里放一个最小占位，避免白屏
    if (this.state.failed) {
      return (
        <div className="min-h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-[15px] text-slate-700">页面出错了</p>
          <p className="text-xs text-slate-400 leading-5">
            详细信息已显示在浮层中，请截图发给开发者
          </p>
          <button
            onClick={() => this.setState({ failed: false })}
            className="min-h-[44px] px-6 rounded-xl bg-emerald-600 text-white text-sm"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
