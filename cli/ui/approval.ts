import type { ToolCallRequest } from '../../interfaces/tool.ts';
import type { PermissionResult } from '../../core/permission/permission_manager.ts';

/**
 * 承認選択肢
 */
export type ApprovalChoice = 'allow_once' | 'allow_always' | 'deny';

/**
 * 承認結果
 */
export interface ApprovalResult {
  choice: ApprovalChoice;
  remember: boolean;
}

/**
 * 承認UI管理クラス
 */
export class ApprovalManager {
  
  /**
   * ツール実行の承認を求める
   */
  async requestApproval(
    toolCall: ToolCallRequest,
    permissionResult: PermissionResult
  ): Promise<ApprovalResult> {
    console.log('\n🔐 ツール実行の承認が必要です');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 ツール名: ${toolCall.toolName}`);
    console.log(`📝 説明: ${this.getToolDescription(toolCall.toolName)}`);
    
    // パラメータを表示
    if (Object.keys(toolCall.parameters).length > 0) {
      console.log('📊 パラメータ:');
      for (const [key, value] of Object.entries(toolCall.parameters)) {
        const displayValue = this.formatParameterValue(value);
        console.log(`   ${key}: ${displayValue}`);
      }
    }

    // セキュリティ情報を表示
    if (permissionResult.securityResult) {
      const risk = permissionResult.securityResult.riskLevel;
      const riskIcon = this.getRiskIcon(risk);
      console.log(`${riskIcon} リスクレベル: ${risk.toUpperCase()}`);
      
      if (permissionResult.securityResult.warning) {
        console.log(`⚠️  警告: ${permissionResult.securityResult.warning}`);
      }
    }

    console.log('\n選択肢:');
    console.log('  1) 今回だけ許可 (allow_once)');
    console.log('  2) 永続的に許可 (allow_always)');
    console.log('  3) 拒否 (deny)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    while (true) {
      const input = await this.getUserInput('選択してください (1-3): ');
      
      switch (input.trim()) {
        case '1':
          return { choice: 'allow_once', remember: false };
        case '2':
          return { choice: 'allow_always', remember: true };
        case '3':
          return { choice: 'deny', remember: false };
        default:
          console.log('❌ 無効な選択です。1-3の数字を入力してください。');
      }
    }
  }

  /**
   * 危険な操作の追加確認
   */
  async requestDangerousConfirmation(operation: string): Promise<boolean> {
    console.log('\n⚠️  危険な操作の実行確認');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚨 実行内容: ${operation}`);
    console.log('⚠️  この操作はシステムに影響を与える可能性があります。');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    while (true) {
      const input = await this.getUserInput('本当に実行しますか？ (yes/no): ');
      const answer = input.trim().toLowerCase();
      
      if (answer === 'yes' || answer === 'y') {
        return true;
      } else if (answer === 'no' || answer === 'n') {
        return false;
      } else {
        console.log('❌ "yes" または "no" で回答してください。');
      }
    }
  }

  /**
   * ユーザー入力を取得
   */
  private async getUserInput(prompt: string): Promise<string> {
    // プロンプトを出力
    await Deno.stdout.write(new TextEncoder().encode(prompt));
    
    // 入力読み取り用のバッファ
    const buffer = new Uint8Array(4096);
    const bytesRead = await Deno.stdin.read(buffer);
    
    if (bytesRead === null) {
      return '';
    }
    
    // Windowsのコンソールエンコーディングを考慮
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
   * ツールの説明を取得
   */
  private getToolDescription(toolName: string): string {
    const descriptions: Record<string, string> = {
      'read_file': 'ファイルの内容を読み込みます',
      'write_to_file': 'ファイルに内容を書き込みます（ファイルを変更・作成）',
      'create_directory': 'ディレクトリを作成します',
      'search_files': 'ファイルパターンに基づいてファイルを検索します',
      'execute_command': 'シェルコマンドを実行します（システムを変更する可能性）',
    };
    
    return descriptions[toolName] || '不明なツール';
  }

  /**
   * パラメータ値を表示用にフォーマット
   */
  private formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // 長い文字列は切り詰める
      if (value.length > 100) {
        return `"${value.substring(0, 97)}..."`;
      }
      return `"${value}"`;
    }
    
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    
    return String(value);
  }

  /**
   * リスクレベルのアイコンを取得
   */
  private getRiskIcon(risk: string): string {
    switch (risk) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * 選択肢を日本語で表示
   */
  private getChoiceDescription(choice: ApprovalChoice): string {
    switch (choice) {
      case 'allow_once':
        return '今回だけ許可';
      case 'allow_always':
        return '永続的に許可';
      case 'deny':
        return '拒否';
      default:
        return '不明';
    }
  }
} 