import { join } from '@std/path';
import { ensureDir, exists } from '@std/fs';
import { v4 as uuid } from '@std/uuid';
import type { 
  HistoryRecorder as IHistoryRecorder, 
  SessionHistory, 
  Message, 
  SessionMetadata 
} from '../../interfaces/history.ts';
import { ConfigManager } from '../config/manager.ts';

/**
 * 履歴記録実装クラス
 */
export class HistoryRecorder implements IHistoryRecorder {
  private configManager: ConfigManager;
  private activeSessions: Map<string, SessionHistory> = new Map();

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * 新しいセッションを開始
   */
  async startSession(model: string, systemPrompt: string): Promise<string> {
    const sessionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const session: SessionHistory = {
      sessionId,
      timestamp,
      model,
      messages: [],
      metadata: {
        model,
      },
    };

    // システムプロンプトをsystemロールのメッセージとして記録
    const systemMessage: Message = {
      role: 'system',
      content: systemPrompt,
      timestamp,
    };

    session.messages.push(systemMessage);
    this.activeSessions.set(sessionId, session);
    
    return sessionId;
  }

  /**
   * メッセージを記録
   */
  async recordMessage(sessionId: string, message: Message): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`セッション ${sessionId} が見つかりません`);
    }

    // タイムスタンプがない場合は現在時刻を設定
    const messageWithTimestamp = {
      ...message,
      timestamp: message.timestamp || new Date().toISOString(),
    };

    session.messages.push(messageWithTimestamp);

    // 定期的にファイルに保存（メッセージ数が5の倍数の時）
    if (session.messages.length % 5 === 0) {
      await this.saveSessionToFile(session);
    }
  }

  /**
   * セッションを終了
   */
  async endSession(sessionId: string, metadata: SessionMetadata): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`セッション ${sessionId} が見つかりません`);
    }

    // メタデータを更新
    session.metadata = { ...session.metadata, ...metadata };

    // ファイルに保存
    await this.saveSessionToFile(session);

    // アクティブセッションから削除
    this.activeSessions.delete(sessionId);
  }

  /**
   * セッション履歴を取得
   */
  async getSession(sessionId: string): Promise<SessionHistory | null> {
    // アクティブセッションから検索
    const activeSession = this.activeSessions.get(sessionId);
    if (activeSession) {
      return { ...activeSession }; // コピーを返す
    }

    // ファイルから読み込み
    return this.loadSessionFromFile(sessionId);
  }

  /**
   * 全セッション一覧を取得
   */
  async listSessions(limit = 50): Promise<SessionHistory[]> {
    const historyDir = this.configManager.getHistoryDirectory();
    const sessionsDir = join(historyDir, 'sessions');

    if (!await exists(sessionsDir)) {
      return [];
    }

    const sessions: SessionHistory[] = [];
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    try {
      // 日付ディレクトリを検索
      for await (const dateEntry of Deno.readDir(sessionsDir)) {
        if (!dateEntry.isDirectory || !datePattern.test(dateEntry.name)) {
          continue;
        }

        const datePath = join(sessionsDir, dateEntry.name);
        
        // セッションファイルを検索
        for await (const sessionEntry of Deno.readDir(datePath)) {
          if (!sessionEntry.isFile || !sessionEntry.name.endsWith('.json')) {
            continue;
          }

          const sessionPath = join(datePath, sessionEntry.name);
          try {
            const sessionData = await this.loadSessionFromPath(sessionPath);
            if (sessionData) {
              sessions.push(sessionData);
            }
          } catch {
            // ファイル読み込みエラーは無視
          }

          // 制限に達した場合は終了
          if (sessions.length >= limit) {
            break;
          }
        }

        if (sessions.length >= limit) {
          break;
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }

    // タイムスタンプでソート（新しい順）
    sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return sessions.slice(0, limit);
  }

  /**
   * セッションをファイルに保存
   */
  private async saveSessionToFile(session: SessionHistory): Promise<void> {
    const historyDir = this.configManager.getHistoryDirectory();
    const sessionDate = new Date(session.timestamp);
    const dateStr = sessionDate.toISOString().split('T')[0]; // YYYY-MM-DD

    const sessionDir = join(historyDir, 'sessions', dateStr);
    await ensureDir(sessionDir);

    const filename = `session_${session.sessionId}.json`;
    const filePath = join(sessionDir, filename);

    const sessionData = JSON.stringify(session, null, 2);
    await Deno.writeTextFile(filePath, sessionData);
  }

  /**
   * セッションをファイルから読み込み
   */
  private async loadSessionFromFile(sessionId: string): Promise<SessionHistory | null> {
    const historyDir = this.configManager.getHistoryDirectory();
    const sessionsDir = join(historyDir, 'sessions');

    if (!await exists(sessionsDir)) {
      return null;
    }

    // 日付ディレクトリを検索
    try {
      for await (const dateEntry of Deno.readDir(sessionsDir)) {
        if (!dateEntry.isDirectory) continue;

        const datePath = join(sessionsDir, dateEntry.name);
        const filename = `session_${sessionId}.json`;
        const filePath = join(datePath, filename);

        if (await exists(filePath)) {
          return this.loadSessionFromPath(filePath);
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }

    return null;
  }

  /**
   * 指定されたパスからセッションを読み込み
   */
  private async loadSessionFromPath(filePath: string): Promise<SessionHistory | null> {
    try {
      const content = await Deno.readTextFile(filePath);
      const session = JSON.parse(content) as SessionHistory;
      
      // 基本的な検証
      if (!session.sessionId || !session.timestamp || !session.model) {
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  /**
   * 古い履歴を削除
   */
  async cleanupOldSessions(maxAge: number): Promise<number> {
    const historyDir = this.configManager.getHistoryDirectory();
    const sessionsDir = join(historyDir, 'sessions');

    if (!await exists(sessionsDir)) {
      return 0;
    }

    const cutoffDate = new Date(Date.now() - maxAge);
    let deletedCount = 0;

    try {
      for await (const dateEntry of Deno.readDir(sessionsDir)) {
        if (!dateEntry.isDirectory) continue;

        const dateStr = dateEntry.name;
        const entryDate = new Date(dateStr);

        if (entryDate < cutoffDate) {
          const datePath = join(sessionsDir, dateStr);
          try {
            await Deno.remove(datePath, { recursive: true });
            deletedCount++;
          } catch {
            // 削除エラーは無視
          }
        }
      }
    } catch {
      // ディレクトリ読み込みエラーは無視
    }

    return deletedCount;
  }
} 