import { ToolExecutor } from '../../../packages/core/tools/tool_executor.ts';

/**
 * CLIコマンドハンドラークラス
 * 対話中のコマンド処理を管理
 */
export class CommandHandler {
  private toolExecutor: ToolExecutor;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  /**
   * コマンドを処理
   * @param command 実行するコマンド
   * @returns コマンド処理が続行可能な場合true、終了する場合false
   */
  async handleCommand(command: string): Promise<boolean> {
    const cmd = command.toLowerCase().trim();

    switch (cmd) {
      case '/quit':
      case '/q':
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
}
