import { Command } from '@cliffy/command';
import { ConfigManager } from './core/config/manager.ts';
import { ToolExecutor } from './core/tools/tool_executor.ts';
import { HistoryRecorder } from './core/history/history_recorder.ts';
import { OpenAIClient } from './core/llm/openai_client.ts';
import { buildSystemPrompt } from './core/llm/system_prompt.ts';
import { ProgressManager } from './cli/ui/progress.ts';
import { ApprovalManager } from './cli/ui/approval.ts';
import type { AgentConfig } from './interfaces/agent.ts';
import type { ToolExecutionContext } from './interfaces/tool.ts';

/**
 * メインアプリケーションクラス
 */
class MinocApp {
  private configManager: ConfigManager;
  private toolExecutor: ToolExecutor;
  private historyRecorder: HistoryRecorder;
  private progressManager: ProgressManager;
  private approvalManager: ApprovalManager;
  private openaiClient?: OpenAIClient;
  private currentSessionId?: string;

  constructor() {
    this.configManager = new ConfigManager();
    this.toolExecutor = new ToolExecutor(this.configManager);
    this.historyRecorder = new HistoryRecorder(this.configManager);
    this.progressManager = new ProgressManager();
    this.approvalManager = new ApprovalManager();
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
   * 対話セッションを開始
   */
  async startChat(model?: string, apiKey?: string): Promise<void> {
    // 設定を読み込み
    const appSettings = await this.configManager.getAppSettings();
    const modelSettings = await this.configManager.getModelSettings();
    
    const selectedModel = model || appSettings.defaultModel;
    const modelConfig = modelSettings[selectedModel];
    
    if (!modelConfig) {
      console.error(`❌ モデル '${selectedModel}' の設定が見つかりません`);
      return;
    }

    if (!apiKey && !modelConfig.apiKey) {
      console.error('❌ APIキーが設定されていません。--api-key オプションで指定するか、設定ファイルに保存してください。');
      return;
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

    // 対話ループ
    await this.chatLoop();
  }

  /**
   * 対話ループ
   */
  private async chatLoop(): Promise<void> {
    while (true) {
      try {
        const userInput = await this.getUserInput('> ');
        
        if (userInput.startsWith('/')) {
          const handled = await this.handleCommand(userInput);
          if (!handled) {
            break; // quit コマンド
          }
          continue;
        }

        if (userInput.trim() === '') {
          continue;
        }

        await this.processUserMessage(userInput);
      } catch (error) {
        console.error(`❌ エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * ユーザーメッセージを処理
   */
  private async processUserMessage(message: string): Promise<void> {
    if (!this.openaiClient || !this.currentSessionId) {
      console.error('❌ セッションが初期化されていません');
      return;
    }

    // ユーザーメッセージを記録
    await this.historyRecorder.recordMessage(this.currentSessionId, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    // LLMとの対話ループ（ツールを呼び出さずに返答するまで継続）
    await this.llmLoop();
  }

  /**
   * LLMとの対話ループ（ツール呼び出しがなくなるまで継続）
   */
  private async llmLoop(): Promise<void> {
    const maxIterations = 50; // 無限ループ防止
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      try {
        // LLMに送信
        const session = await this.historyRecorder.getSession(this.currentSessionId!);
        if (!session) {
          console.error('❌ セッション情報の取得に失敗しました');
          return;
        }

        const response = await this.progressManager.withProgress(
          'LLMから応答を取得中',
          () => this.openaiClient!.chatCompletion(session.systemPrompt, session.messages)
        );

        // 応答メッセージを記録
        await this.historyRecorder.recordMessage(this.currentSessionId!, {
          role: 'assistant',
          content: response.content,
          timestamp: new Date().toISOString(),
          metadata: { usage: response.usage },
        });

        // ツール呼び出しをチェック
        const toolCall = this.toolExecutor.parseXmlToolCall(response.content);
        if (toolCall) {
          // ツール呼び出しを実行
          await this.handleToolCall({
            toolName: toolCall.toolName,
            parameters: toolCall.parameters,
          });

          // ツール呼び出しがあったので次のイテレーションを継続
          continue;
        } else {
          // ツール呼び出しがない場合は通常の応答を表示してループ終了
          console.log('\n🤖:', response.content, '\n');
          break;
        }

      } catch (error) {
        console.error(`❌ LLMからの応答取得に失敗: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    if (iteration >= maxIterations) {
      console.log('⚠️  最大イテレーション数に達しました。LLMループを終了します。');
    }
  }

  /**
   * ツール呼び出しを処理
   * @returns ツール実行が成功した場合true、失敗・拒否された場合false
   */
  private async handleToolCall(toolCall: { toolName: string; parameters: Record<string, unknown> }): Promise<boolean> {
    if (!this.currentSessionId) return false;

    console.log(`\n🔧 ツール呼び出し: ${toolCall.toolName}`);

    // 権限チェック
    const permissionResult = await this.toolExecutor.checkPermission(toolCall);
    
    if (!permissionResult.allowed) {
      console.log(`❌ ツール実行が拒否されました: ${permissionResult.reason}`);
      await this.historyRecorder.recordMessage(this.currentSessionId, {
        role: 'tool_response',
        content: `<tool_response>{"success": false, "error": "${permissionResult.reason}"}</tool_response>`,
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // 承認が必要な場合
    if (permissionResult.requiresApproval) {
      const approval = await this.approvalManager.requestApproval(toolCall, permissionResult);
      
      if (approval.choice === 'deny' || approval.choice === 'deny_always') {
        console.log('❌ ユーザーによって実行が拒否されました');
        
        // 設定を更新
        if (approval.remember) {
          const permissionManager = this.toolExecutor.getPermissionManager();
          await permissionManager.addToAutoReject(toolCall.toolName);
        }
        
        await this.historyRecorder.recordMessage(this.currentSessionId, {
          role: 'tool_response',
          content: `<tool_response>{"success": false, "error": "ツール実行がユーザーによって拒否されました"}</tool_response>`,
          timestamp: new Date().toISOString(),
        });
        
        return false;
      }

      // 永続許可の場合は設定を更新
      if (approval.choice === 'allow_always') {
        const permissionManager = this.toolExecutor.getPermissionManager();
        await permissionManager.addToPermanentlyAllowed(toolCall.toolName);
      }
    }

    // ツールを実行
    console.log('⚙️  ツールを実行中...');
    
    const context: ToolExecutionContext = {
      workingDirectory: Deno.cwd(),
      environment: Deno.env.toObject(),
      sessionId: this.currentSessionId,
      timestamp: new Date(),
    };

    const result = await this.toolExecutor.executeTool(toolCall, context);

    // 結果を記録
    await this.historyRecorder.recordMessage(this.currentSessionId, {
      role: 'tool_call',
      content: `ツール: ${toolCall.toolName}\nパラメータ: ${JSON.stringify(toolCall.parameters, null, 2)}`,
      timestamp: new Date().toISOString(),
    });

    await this.historyRecorder.recordMessage(this.currentSessionId, {
      role: 'tool_response',
      content: `<tool_response>${JSON.stringify(result, null, 2)}</tool_response>`,
      timestamp: new Date().toISOString(),
    });

    // 結果を表示
    if (result.success) {
      console.log(`✅ ${result.output || 'ツールが正常に実行されました'}`);
      return true;
    } else {
      console.log(`❌ ツール実行失敗: ${result.error}`);
      return false;
    }
  }

  /**
   * コマンドを処理
   */
  private async handleCommand(command: string): Promise<boolean> {
    const cmd = command.toLowerCase().trim();
    
    switch (cmd) {
      case '/quit':
      case '/q':
        await this.endSession();
        console.log('👋 セッションを終了しました');
        return false;
        
      case '/help':
      case '/h':
        this.showHelp();
        return true;
        
      case '/tools':
        this.showTools();
        return true;
        
      default:
        console.log(`❓ 不明なコマンド: ${command}`);
        console.log('ヘルプを表示するには /help と入力してください');
        return true;
    }
  }

  /**
   * セッションを終了
   */
  private async endSession(): Promise<void> {
    if (this.currentSessionId) {
      await this.historyRecorder.endSession(this.currentSessionId, {
        duration: Date.now(),
      });
      this.currentSessionId = undefined;
    }
  }

  /**
   * ヘルプを表示
   */
  private showHelp(): void {
    console.log('\n📋 利用可能なコマンド:');
    console.log('  /quit, /q    - セッションを終了');
    console.log('  /help, /h    - このヘルプを表示');
    console.log('  /tools       - 利用可能なツール一覧を表示');
    console.log('\n💡 XMLツール呼び出し例:');
    console.log('  <tool_call>');
    console.log('  <read_file>');
    console.log('  <path>example.txt</path>');
    console.log('  </read_file>');
    console.log('  </tool_call>\n');
  }

  /**
   * ツール一覧を表示
   */
  private showTools(): void {
    const tools = this.toolExecutor.listTools();
    
    console.log('\n🔧 利用可能なツール:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    for (const tool of tools) {
      const dangerIcon = tool.dangerous ? '⚠️ ' : '✅ ';
      console.log(`${dangerIcon}${tool.name}`);
      console.log(`   ${tool.description}`);
      console.log(`   必須パラメータ: ${tool.requiredParameters.join(', ') || 'なし'}`);
      if (tool.optionalParameters && tool.optionalParameters.length > 0) {
        console.log(`   オプションパラメータ: ${tool.optionalParameters.join(', ')}`);
      }
      console.log('');
    }
  }

  /**
   * ユーザー入力を取得
   */
  private async getUserInput(prompt: string): Promise<string> {
    // プロンプトを出力
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    
    // 入力読み取り用のバッファ
    const buffer = new Uint8Array(4096); // より大きなバッファ
    const bytesRead = await Deno.stdin.read(buffer);
    
    if (bytesRead === null) {
      return '';
    }
    
    // Windowsのコンソールエンコーディングを考慮
    // CP932 (Shift_JIS) かUTF-8かを自動判定して適切にデコード
    let input: string;
    
    try {
      // まずUTF-8でデコードを試行
      const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
      input = utf8Decoder.decode(buffer.slice(0, bytesRead));
    } catch {
      try {
        // UTF-8で失敗した場合、Shift_JIS（CP932）でデコード
        const shiftJisDecoder = new TextDecoder('shift_jis');
        input = shiftJisDecoder.decode(buffer.slice(0, bytesRead));
      } catch {
        // 最後の手段として、バイナリをそのまま処理
        const fallbackDecoder = new TextDecoder('utf-8', { fatal: false });
        input = fallbackDecoder.decode(buffer.slice(0, bytesRead));
      }
    }
    
    // 改行文字を削除して返す
    return input.replace(/\r?\n$/, '').trim();
  }

  /**
   * JSONバックアップファイルをクリーンアップ
   */
  async cleanupJsonBackups(): Promise<void> {
    await this.configManager.cleanupJsonBackups();
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
