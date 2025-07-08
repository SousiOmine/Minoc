import { ToolExecutor } from '../tools/tool_executor.ts';
import { HistoryRecorder } from '../history/history_recorder.ts';
import { OpenAIClient } from '../llm/openai_client.ts';
import { ProgressManager } from '../../cli/ui/progress.ts';
import type { ToolExecutionContext } from '../../interfaces/tool.ts';

/**
 * 対話エンジンクラス
 * LLMとの対話ループとツール呼び出し処理を管理
 */
export class ChatEngine {
  private toolExecutor: ToolExecutor;
  private historyRecorder: HistoryRecorder;
  private progressManager: ProgressManager;
  private openaiClient?: OpenAIClient;
  private currentSessionId?: string;

  constructor(toolExecutor: ToolExecutor, historyRecorder: HistoryRecorder) {
    this.toolExecutor = toolExecutor;
    this.historyRecorder = historyRecorder;
    this.progressManager = new ProgressManager();
  }

  /**
   * OpenAIクライアントを設定
   */
  setOpenAIClient(client: OpenAIClient): void {
    this.openaiClient = client;
  }

  /**
   * 現在のセッションIDを設定
   */
  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /**
   * ユーザーメッセージを処理
   */
  async processUserMessage(message: string): Promise<void> {
    if (!this.openaiClient || !this.currentSessionId) {
      throw new Error('ChatEngineが適切に初期化されていません');
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
          throw new Error('セッション情報の取得に失敗しました');
        }

        const response = await this.progressManager.withProgress(
          'LLMから応答を取得中',
          () => this.openaiClient!.chatCompletion(session.messages)
        );

        // LLMからの出力をassistantとして記録
        await this.historyRecorder.recordMessage(this.currentSessionId!, {
          role: 'assistant',
          content: response.content,
          timestamp: new Date().toISOString(),
          metadata: { usage: response.usage },
        });

        // 応答メッセージ内の <tool_call> ブロックを抽出
        const allToolCalls = [...response.content.matchAll(/<tool_call>[\s\S]*?<\/tool_call>/g)];
        if (allToolCalls.length > 1) {
          // 複数ツール呼び出しエラーを即座に返す
          await this.historyRecorder.recordMessage(this.currentSessionId!, {
            role: 'user',
            content: `<tool_response>{"success": false, "error": "複数のツールを同時に呼び出すことはできません"}</tool_response>`,
            timestamp: new Date().toISOString(),
          });
          continue;
        } else if (allToolCalls.length === 1) {
          const block = allToolCalls[0][0];
          const parsed = this.toolExecutor.parseXmlToolCall(block);
          if (parsed) {
            const toolExecuted = await this.handleToolCall({ toolName: parsed.toolName, parameters: parsed.parameters }, block);
            // respond_to_user ツールが正常に実行された場合はループを終了
            if (toolExecuted && parsed.toolName === 'respond_to_user') {
              break;
            }
          }
          continue;
        } else {
          // ツール呼び出しがない場合は警告メッセージを返してループ継続
          const warningMessage = `ツールを呼び出してください。ユーザーへの応答を表示する場合は respond_to_user ツールを使用してください。

利用可能なツール:
- respond_to_user: ユーザーに回答や情報を表示
- read_file: ファイルを読み込み
- write_to_file: ファイルに書き込み
- execute_command: コマンドを実行
- list_directory: ディレクトリ内容を一覧表示
- search_files: ファイルを検索
- read_files: 複数ファイルを一括読み込み
- create_directory: ディレクトリを作成

必ずいずれかのツールを呼び出してください。`;

          await this.historyRecorder.recordMessage(this.currentSessionId!, {
            role: 'user',
            content: warningMessage,
            timestamp: new Date().toISOString(),
            metadata: { warning: 'no_tool_call' },
          });
          continue;
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
  private async handleToolCall(toolCall: { toolName: string; parameters: Record<string, unknown> }, xmlString?: string): Promise<boolean> {
    if (!this.currentSessionId) return false;

    console.log(`\n🔧 ツール呼び出し: ${toolCall.toolName}`);

    // 権限チェック
    const permissionResult = await this.toolExecutor.checkPermission(toolCall);
    
    if (!permissionResult.allowed) {
      console.log(`❌ ツール実行が拒否されました: ${permissionResult.reason}`);
      await this.historyRecorder.recordMessage(this.currentSessionId, {
        role: 'user',
        content: `<tool_response>{"success": false, "error": "${permissionResult.reason}"}</tool_response>`,
        timestamp: new Date().toISOString(),
      });
      return false;
    }

    // 承認が必要な場合（ApprovalManagerは外部から注入される必要がある）
    if (permissionResult.requiresApproval) {
      // この部分は後で外部からの依存注入に変更する
      const { ApprovalManager } = await import('../../cli/ui/approval.ts');
      const approvalManager = new ApprovalManager();
      
      const approval = await approvalManager.requestApproval(toolCall, permissionResult);
      
      if (approval.choice === 'deny') {
        console.log('❌ ユーザーによって実行が拒否されました');
        
        await this.historyRecorder.recordMessage(this.currentSessionId, {
          role: 'user',
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

    // stdout と stderr を最大 100 行に制限
    if (toolCall.toolName === 'execute_command' && result.success && result.data && typeof (result.data as any).stdout === 'string') {
      const data = result.data as any;
      const stdoutLines = data.stdout.split('\n');
      if (stdoutLines.length > 100) {
        data.stdout = stdoutLines.slice(0, 100).join('\n') + '\n...[省略]...';
      }
      if (typeof data.stderr === 'string') {
        const stderrLines = data.stderr.split('\n');
        if (stderrLines.length > 100) {
          data.stderr = stderrLines.slice(0, 100).join('\n') + '\n...[省略]...';
        }
      }
    }

    await this.historyRecorder.recordMessage(this.currentSessionId, {
      role: 'user',
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
} 