import { ConfigManager } from '../config/manager.ts';
import { HistoryRecorder } from '../history/history_recorder.ts';
import { OpenAIClient } from '../llm/openai_client.ts';
import { buildSystemPrompt } from '../llm/system_prompt.ts';
import type { IProgressManager } from '../../interfaces/progress.ts';
import { NoOpProgressManager } from '../../interfaces/progress.ts';
import type { AgentConfig } from '../../interfaces/agent.ts';

/**
 * セッション管理クラス
 * LLMセッションの開始・終了・設定管理を担当
 */
export class SessionManager {
  private configManager: ConfigManager;
  private historyRecorder: HistoryRecorder;
  private progressManager: IProgressManager;
  private currentSessionId?: string;
  private openaiClient?: OpenAIClient;

  constructor(
    configManager: ConfigManager,
    historyRecorder: HistoryRecorder,
    progressManager?: IProgressManager,
  ) {
    this.configManager = configManager;
    this.historyRecorder = historyRecorder;
    this.progressManager = progressManager || new NoOpProgressManager();
  }

  /**
   * 対話セッションを開始
   */
  async startChat(
    model?: string,
    apiKey?: string,
  ): Promise<{ sessionId: string; openaiClient: OpenAIClient }> {
    // 設定を読み込み
    const appSettings = await this.configManager.getAppSettings();
    const modelSettings = await this.configManager.getModelSettings();

    const selectedModel = model || appSettings.defaultModel;
    const modelConfig = modelSettings[selectedModel];

    if (!modelConfig) {
      throw new Error(`モデル '${selectedModel}' の設定が見つかりません`);
    }

    if (!apiKey && !modelConfig.apiKey) {
      throw new Error(
        'APIキーが設定されていません。--api-key オプションで指定するか、設定ファイルに保存してください。',
      );
    }

    // AgentConfigを構築
    const agentConfig: AgentConfig = {
      ...modelConfig,
      model: selectedModel,
      apiKey: apiKey || modelConfig.apiKey!,
    };

    // OpenAIクライアントを初期化
    this.openaiClient = new OpenAIClient(agentConfig);

    // システムプロンプトを構築
    const systemPrompt = await buildSystemPrompt(modelConfig.customInstructions);

    // セッションを開始
    this.currentSessionId = await this.historyRecorder.startSession(selectedModel, systemPrompt);

    console.log('\n🤖 Minoc LLMエージェントとの対話を開始します');
    console.log(`📋 モデル: ${selectedModel}`);
    console.log('💬 メッセージを入力してください（終了: /quit, ヘルプ: /help）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      sessionId: this.currentSessionId,
      openaiClient: this.openaiClient,
    };
  }

  /**
   * セッションを終了
   */
  async endSession(): Promise<void> {
    if (this.currentSessionId) {
      await this.historyRecorder.endSession(this.currentSessionId, {
        duration: Date.now(),
      });
      this.currentSessionId = undefined;
      this.openaiClient = undefined;
    }
  }

  /**
   * 現在のセッションIDを取得
   */
  getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }

  /**
   * 現在のOpenAIクライアントを取得
   */
  getCurrentOpenAIClient(): OpenAIClient | undefined {
    return this.openaiClient;
  }

  /**
   * アプリケーションを初期化
   */
  async initialize(): Promise<void> {
    await this.progressManager.withProgress('設定ディレクトリを初期化中', async () => {
      await this.configManager.initializeConfigDirectory();
    });

    // 既存のJSON設定ファイルをTOML形式に移行
    await this.progressManager.withProgress('設定ファイルをTOML形式に移行中', async () => {
      await this.configManager.migrateFromJson();
    });

    console.log('✅ Minoc LLMエージェントが初期化されました');
  }

  /**
   * JSONバックアップファイルをクリーンアップ
   */
  async cleanupJsonBackups(): Promise<void> {
    await this.configManager.cleanupJsonBackups();
  }
}
