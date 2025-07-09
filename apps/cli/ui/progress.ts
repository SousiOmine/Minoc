import type { IProgressManager } from '../../../packages/interfaces/progress.ts';

/**
 * プログレスバー表示クラス
 */
export class ProgressManager implements IProgressManager {
  private isActive = false;
  private intervalId?: number;
  private startTime = 0;
  private taskName = '';
  private showProgress = true;
  private threshold = 5000; // 5秒

  constructor(showProgress = true, threshold = 5000) {
    this.showProgress = showProgress;
    this.threshold = threshold;
  }

  /**
   * 長時間処理の開始
   */
  async withProgress<T>(
    taskName: string,
    operation: () => Promise<T>,
    immediate = false,
  ): Promise<T> {
    if (!this.showProgress) {
      return operation();
    }

    this.taskName = taskName;
    this.startTime = Date.now();

    let timeoutId: number | undefined;

    // 閾値後にプログレスバーを開始
    if (!immediate) {
      timeoutId = setTimeout(() => {
        this.start();
      }, this.threshold);
    } else {
      this.start();
    }

    try {
      const result = await operation();

      // タイムアウトをクリア
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      this.stop();
      return result;
    } catch (error) {
      // タイムアウトをクリア
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      this.stop();
      throw error;
    }
  }

  /**
   * プログレスバーを開始
   */
  private start(): void {
    if (this.isActive) return;

    this.isActive = true;
    this.clearLine();

    // アニメーション文字
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerIndex = 0;

    this.intervalId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const spinner = spinners[spinnerIndex % spinners.length];

      this.clearLine();
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `${spinner} ${this.taskName} (${elapsed}s経過)`,
        ),
      );

      spinnerIndex++;
    }, 100);
  }

  /**
   * プログレスバーを停止
   */
  private stop(): void {
    if (!this.isActive) return;

    this.isActive = false;

    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.clearLine();

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    console.log(`✓ ${this.taskName} 完了 (${elapsed}s)`);
  }

  /**
   * 現在の行をクリア
   */
  private clearLine(): void {
    Deno.stdout.writeSync(new TextEncoder().encode('\r\x1B[K'));
  }

  /**
   * プログレス表示の有効/無効を切り替え
   */
  setEnabled(enabled: boolean): void {
    this.showProgress = enabled;
  }

  /**
   * 閾値を設定
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /**
   * 即座にプログレスバーを表示する処理
   */
  async withImmediateProgress<T>(
    taskName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.withProgress(taskName, operation, true);
  }

  /**
   * 静的メソッド：一時的なプログレス表示
   */
  static async withProgress<T>(
    taskName: string,
    operation: () => Promise<T>,
    options: {
      showProgress?: boolean;
      threshold?: number;
      immediate?: boolean;
    } = {},
  ): Promise<T> {
    const manager = new ProgressManager(
      options.showProgress ?? true,
      options.threshold ?? 5000,
    );

    return manager.withProgress(taskName, operation, options.immediate);
  }
}
