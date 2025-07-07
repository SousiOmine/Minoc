import type { Tool, ToolParameters, ToolResult, ToolExecutionContext } from '../../interfaces/tool.ts';

/**
 * 基本ツール抽象クラス
 */
export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly requiredParameters: string[];
  readonly optionalParameters: string[] = [];
  readonly dangerous: boolean = false;
  readonly requiresApproval: boolean = false;

  /**
   * ツールの実行（サブクラスで実装）
   */
  abstract execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult>;

  /**
   * パラメータの検証
   */
  validateParameters(parameters: ToolParameters): boolean {
    // 必須パラメータの存在チェック
    for (const required of this.requiredParameters) {
      if (!(required in parameters) || parameters[required] === undefined || parameters[required] === null) {
        return false;
      }
    }
    return true;
  }

  /**
   * 成功結果を返すヘルパーメソッド
   */
  protected success(data?: unknown, output?: string): ToolResult {
    return {
      success: true,
      data,
      output,
    };
  }

  /**
   * エラー結果を返すヘルパーメソッド
   */
  protected error(error: string, data?: unknown): ToolResult {
    return {
      success: false,
      error,
      data,
    };
  }

  /**
   * パラメータを安全に取得するヘルパーメソッド
   */
  protected getParameter<T>(parameters: ToolParameters, key: string, defaultValue?: T): T {
    const value = parameters[key];
    if (value === undefined || value === null) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`必須パラメータ '${key}' が指定されていません`);
    }
    return value as T;
  }

  /**
   * パラメータを安全に取得するヘルパーメソッド（オプション）
   */
  protected getOptionalParameter<T>(parameters: ToolParameters, key: string, defaultValue?: T): T | undefined {
    const value = parameters[key];
    if (value === undefined || value === null) {
      return defaultValue;
    }
    return value as T;
  }
} 