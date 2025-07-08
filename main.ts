import { Command } from '@cliffy/command';
import { ConfigManager } from './core/config/manager.ts';
import { ToolExecutor } from './core/tools/tool_executor.ts';
import { HistoryRecorder } from './core/history/history_recorder.ts';
import { ProgressManager } from './cli/ui/progress.ts';
import { SessionManager } from './core/session/session_manager.ts';
import { ChatEngine } from './core/chat/chat_engine.ts';
import { CommandHandler } from './cli/commands/command_handler.ts';
import { InputHandler } from './cli/prompt/input_handler.ts';

/**
 * メインアプリケーションクラス
 * 各モジュールの初期化と連携のみを担当
 */
class MinocApp {
  private configManager: ConfigManager;
  private toolExecutor: ToolExecutor;
  private historyRecorder: HistoryRecorder;
  private progressManager: ProgressManager;
  private sessionManager: SessionManager;
  private chatEngine: ChatEngine;
  private commandHandler: CommandHandler;
  private inputHandler: InputHandler;

  constructor() {
    this.configManager = new ConfigManager();
    this.toolExecutor = new ToolExecutor(this.configManager);
    this.historyRecorder = new HistoryRecorder(this.configManager);
    this.progressManager = new ProgressManager();
    this.sessionManager = new SessionManager(this.configManager, this.historyRecorder, this.progressManager);
    this.chatEngine = new ChatEngine(this.toolExecutor, this.historyRecorder);
    this.commandHandler = new CommandHandler(this.toolExecutor);
    this.inputHandler = new InputHandler(this.chatEngine, this.commandHandler);
  }

  /**
   * アプリケーションを初期化
   */
  async initialize(): Promise<void> {
    await this.sessionManager.initialize();
  }

  /**
   * 対話セッションを開始
   */
  async startChat(model?: string, apiKey?: string): Promise<void> {
    try {
      // セッションを開始
      const { sessionId, openaiClient } = await this.sessionManager.startChat(model, apiKey);
      
      // ChatEngineに必要な情報を設定
      this.chatEngine.setCurrentSession(sessionId);
      this.chatEngine.setOpenAIClient(openaiClient);

      // 対話ループを開始
      await this.inputHandler.startChatLoop();
      
      // セッション終了
      await this.sessionManager.endSession();
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * JSONバックアップファイルをクリーンアップ
   */
  async cleanupJsonBackups(): Promise<void> {
    await this.sessionManager.cleanupJsonBackups();
  }
}

/**
 * メインCLIコマンド定義
 */
async function main() {
  const app = new MinocApp();

  await new Command()
    .name('minoc')
    .version('0.1.0')
    .description('Minoc - LLMエージェント PC操作支援ツール')
    .option('-m, --model <model:string>', 'LLMモデル名')
    .option('-k, --api-key <key:string>', 'OpenAI APIキー')
    .option('--init', '設定を初期化')
    .option('--cleanup-json', 'JSONバックアップファイルを削除')
    .action(async (options) => {
      if (options.init) {
        await app.initialize();
        return;
      }

      if (options.cleanupJson) {
        await app.initialize();
        await app.cleanupJsonBackups();
        console.log('✅ JSONバックアップファイルのクリーンアップが完了しました');
        return;
      }

      await app.initialize();
      await app.startChat(options.model, options.apiKey);
    })
    .parse(Deno.args);
}

// エラーハンドリング付きでメイン関数を実行
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error('❌ アプリケーションエラー:', error);
    Deno.exit(1);
  }
}
