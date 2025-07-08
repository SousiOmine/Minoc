import { BaseTool } from './base_tool.ts';
import type { ToolParameters, ToolResult, ToolExecutionContext } from '../../interfaces/tool.ts';

/**
 * ユーザーへの応答表示ツール
 * LLMがユーザーに対して回答を表示するために使用
 */
export class RespondToUserTool extends BaseTool {
  override readonly name = 'respond_to_user';
  override readonly description = 'ユーザーに対して回答や情報を表示するためのツール';
  override readonly requiredParameters = ['message'];
  override readonly optionalParameters = ['type'];
  override readonly dangerous = false;
  override readonly requiresApproval = false;

  async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    const message = this.getParameter<string>(parameters, 'message');
    const type = this.getOptionalParameter<string>(parameters, 'type', 'success');

    // メッセージタイプの検証（successとerrorのみ許可）
    if (type !== 'success' && type !== 'error') {
      return this.error(`無効なメッセージタイプです。'success' または 'error' のみ指定可能です: ${type}`);
    }

    // メッセージタイプに応じたプレフィックス
    let prefix = '';
    switch (type) {
      case 'error':
        prefix = '❌ ';
        break;
      case 'success':
      default:
        prefix = '✅ ';
        break;
    }

    // コンソールに出力
    console.log(`\n${prefix}${message}\n`);

    return this.success(
      { message, type, timestamp: new Date().toISOString() },
      `ユーザーに応答を表示しました`
    );
  }
} 