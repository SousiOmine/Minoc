import type { Message, SessionHistory } from './history.ts';
import type { ToolCallRequest, ToolResult } from './tool.ts';

/**
 * LLMエージェントの設定
 */
export interface AgentConfig {
  /** APIベースURL */
  baseUrl?: string;
  /** APIキー */
  apiKey: string;
  /** モデル名 */
  model: string;
  /** 生成パラメータ */
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  /** カスタムインストラクション */
  customInstructions?: string;
}

/**
 * エージェント実行オプション
 */
export interface AgentExecutionOptions {
  /** デバッグモード */
  debug?: boolean;
  /** ドライランモード */
  dryRun?: boolean;
  /** 静かモード */
  quiet?: boolean;
  /** プログレスバー表示 */
  showProgress?: boolean;
}

/**
 * LLMエージェント基底インターフェース
 */
export interface Agent {
  /**
   * セッションを開始
   */
  startSession(config: AgentConfig, options?: AgentExecutionOptions): Promise<string>;
  
  /**
   * ユーザーメッセージを処理
   */
  processMessage(sessionId: string, message: string): Promise<void>;
  
  /**
   * ツール呼び出しを実行
   */
  executeToolCall(sessionId: string, toolCall: ToolCallRequest): Promise<ToolResult>;
  
  /**
   * セッションを終了
   */
  endSession(sessionId: string): Promise<void>;
  
  /**
   * セッション履歴を取得
   */
  getSessionHistory(sessionId: string): Promise<SessionHistory | null>;
} 