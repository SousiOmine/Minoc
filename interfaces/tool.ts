/**
 * ツール実行結果の型定義
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  output?: string;
}

/**
 * ツールパラメータの型定義
 */
export interface ToolParameters {
  [key: string]: unknown;
}

/**
 * ツール定義インターフェース
 */
export interface Tool {
  /** ツール名 */
  name: string;
  /** ツールの説明 */
  description: string;
  /** 必須パラメータ */
  requiredParameters: string[];
  /** オプションパラメータ */
  optionalParameters?: string[];
  /** 危険なツールかどうか */
  dangerous: boolean;
  /** 実行前に承認が必要かどうか */
  requiresApproval: boolean;
  
  /**
   * ツールの実行
   */
  execute(parameters: ToolParameters): Promise<ToolResult>;
  
  /**
   * パラメータの検証
   */
  validateParameters(parameters: ToolParameters): boolean;
}

/**
 * ツール呼び出しリクエストの型定義
 */
export interface ToolCallRequest {
  toolName: string;
  parameters: ToolParameters;
  requiresApproval?: boolean;
}

/**
 * ツール実行コンテキスト
 */
export interface ToolExecutionContext {
  workingDirectory: string;
  environment: Record<string, string>;
  sessionId: string;
  timestamp: Date;
} 