/**
 * プログレス表示のインターフェイス
 */
export interface IProgressManager {
  /**
   * 長時間処理の実行とプログレス表示
   */
  withProgress<T>(
    taskName: string,
    operation: () => Promise<T>,
    immediate?: boolean,
  ): Promise<T>;

  /**
   * 即座にプログレスバーを表示する処理
   */
  withImmediateProgress<T>(
    taskName: string,
    operation: () => Promise<T>,
  ): Promise<T>;

  /**
   * プログレス表示の有効/無効を切り替え
   */
  setEnabled(enabled: boolean): void;

  /**
   * 閾値を設定
   */
  setThreshold(threshold: number): void;
}

/**
 * プログレス表示なしの実装（NoOp実装）
 */
export class NoOpProgressManager implements IProgressManager {
  async withProgress<T>(
    _taskName: string,
    operation: () => Promise<T>,
    _immediate?: boolean,
  ): Promise<T> {
    return operation();
  }

  async withImmediateProgress<T>(
    _taskName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  setEnabled(_enabled: boolean): void {
    // NoOp
  }

  setThreshold(_threshold: number): void {
    // NoOp
  }
} 