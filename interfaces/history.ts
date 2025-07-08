/**
 * メッセージの役割
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * メッセージの型定義
 */
export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * セッションメタデータ
 */
export interface SessionMetadata {
  totalTokens?: number;
  duration?: number;
  toolCallsCount?: number;
  errorCount?: number;
  model?: string;
  [key: string]: unknown;
}

/**
 * セッション履歴の型定義
 */
export interface SessionHistory {
  sessionId: string;
  timestamp: string;
  model: string;
  messages: Message[];
  metadata: SessionMetadata;
}

/**
 * 履歴記録インターフェース
 */
export interface HistoryRecorder {
  /**
   * 新しいセッションを開始
   */
  startSession(model: string, systemPrompt: string): Promise<string>;
  
  /**
   * メッセージを記録
   */
  recordMessage(sessionId: string, message: Message): Promise<void>;
  
  /**
   * セッションを終了
   */
  endSession(sessionId: string, metadata: SessionMetadata): Promise<void>;
  
  /**
   * セッション履歴を取得
   */
  getSession(sessionId: string): Promise<SessionHistory | null>;
  
  /**
   * 全セッション一覧を取得
   */
  listSessions(limit?: number): Promise<SessionHistory[]>;
} 