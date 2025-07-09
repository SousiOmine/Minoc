import type { SecuritySettings } from '../config/types.ts';
import { ConfigManager } from '../config/manager.ts';

/**
 * リスクレベル
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * セキュリティチェック結果
 */
export interface SecurityCheckResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  blockedReason?: string;
  warning?: string;
}

/**
 * セキュリティ管理クラス
 */
export class SecurityManager {
  private configManager: ConfigManager;
  private securitySettings: SecuritySettings | null = null;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * セキュリティ設定を読み込み
   */
  private async loadSettings(): Promise<SecuritySettings> {
    if (!this.securitySettings) {
      this.securitySettings = await this.configManager.getSecuritySettings();
    }
    return this.securitySettings;
  }

  /**
   * セキュリティ設定を更新
   */
  async updateSettings(settings: SecuritySettings): Promise<void> {
    await this.configManager.saveSecuritySettings(settings);
    this.securitySettings = settings;
  }

  /**
   * コマンドのセキュリティチェック
   */
  async checkCommand(command: string): Promise<SecurityCheckResult> {
    const settings = await this.loadSettings();

    if (!settings.enableBlocklist) {
      return {
        allowed: true,
        riskLevel: 'low',
      };
    }

    // 高リスクコマンドのチェック
    const highRiskMatch = this.findMatchingPattern(command, settings.riskLevels.high);
    if (highRiskMatch) {
      return {
        allowed: false,
        riskLevel: 'high',
        blockedReason: `高リスクコマンドが検出されました: ${highRiskMatch}`,
      };
    }

    // カスタムブロックリストのチェック
    const customBlockMatch = this.findMatchingPattern(command, settings.customBlocklist);
    if (customBlockMatch) {
      return {
        allowed: false,
        riskLevel: 'high',
        blockedReason: `カスタムブロックリストに該当します: ${customBlockMatch}`,
      };
    }

    // 中リスクコマンドのチェック
    const mediumRiskMatch = this.findMatchingPattern(command, settings.riskLevels.medium);
    if (mediumRiskMatch) {
      return {
        allowed: true,
        riskLevel: 'medium',
        warning: settings.showSecurityWarnings
          ? `中リスクコマンドが含まれています: ${mediumRiskMatch}`
          : undefined,
      };
    }

    // 低リスクコマンドのチェック
    const lowRiskMatch = this.findMatchingPattern(command, settings.riskLevels.low);
    if (lowRiskMatch) {
      return {
        allowed: true,
        riskLevel: 'low',
      };
    }

    // 未分類のコマンドは低リスクとして扱う
    return {
      allowed: true,
      riskLevel: 'low',
    };
  }

  /**
   * ツール名のセキュリティチェック
   */
  async checkTool(
    toolName: string,
    parameters: Record<string, unknown>,
  ): Promise<SecurityCheckResult> {
    const settings = await this.loadSettings();

    // ツール固有のセキュリティチェック
    switch (toolName) {
      case 'execute_command': {
        const command = parameters.command as string;
        if (command) {
          return this.checkCommand(command);
        }
        break;
      }
      case 'write_to_file': {
        const path = parameters.path as string;
        if (path && this.isDangerousPath(path)) {
          return {
            allowed: false,
            riskLevel: 'high',
            blockedReason: `危険なファイルパスへの書き込みが検出されました: ${path}`,
          };
        }
        // ファイル書き込みは中リスクとして扱う
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? 'ファイルの書き込み操作です' : undefined,
        };
      }
      case 'create_directory': {
        const path = parameters.path as string;
        if (path && this.isDangerousPath(path)) {
          return {
            allowed: false,
            riskLevel: 'high',
            blockedReason: `危険なパスでのディレクトリ作成が検出されました: ${path}`,
          };
        }
        // ディレクトリ作成は中リスクとして扱う
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? 'ディレクトリの作成操作です' : undefined,
        };
      }
      case 'read_file': {
        // ファイル読み込みも低めの中リスクとして扱う（機密情報にアクセスする可能性）
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? 'ファイルの読み込み操作です' : undefined,
        };
      }
      case 'find_files_by_name': {
        // ファイル名検索は中リスクとして扱う
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? 'ファイル名検索操作です' : undefined,
        };
      }
      case 'search_content_in_files': {
        // ファイル内容検索は中リスクとして扱う
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? 'ファイル内容検索操作です' : undefined,
        };
      }
      case 'list_directory': {
        // ディレクトリ一覧表示は低リスク
        return {
          allowed: true,
          riskLevel: 'low',
        };
      }
      case 'read_files': {
        // 複数ファイル読み込みは中リスク
        return {
          allowed: true,
          riskLevel: 'medium',
          warning: settings.showSecurityWarnings ? '複数ファイルの読み込み操作です' : undefined,
        };
      }
    }

    // デフォルトは低リスク
    return {
      allowed: true,
      riskLevel: 'low',
    };
  }

  /**
   * パターンマッチング（部分文字列、正規表現対応）
   */
  private findMatchingPattern(text: string, patterns: string[]): string | null {
    for (const pattern of patterns) {
      try {
        // 正規表現として試行
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
          const regex = new RegExp(pattern.slice(1, -1), 'i');
          if (regex.test(text)) {
            return pattern;
          }
        } else {
          // 部分文字列マッチング
          if (text.toLowerCase().includes(pattern.toLowerCase())) {
            return pattern;
          }
        }
      } catch {
        // 正規表現として無効な場合は部分文字列として扱う
        if (text.toLowerCase().includes(pattern.toLowerCase())) {
          return pattern;
        }
      }
    }
    return null;
  }

  /**
   * 危険なファイルパスかどうかをチェック
   */
  private isDangerousPath(path: string): boolean {
    const dangerousPaths = [
      '/etc/',
      '/bin/',
      '/sbin/',
      '/usr/bin/',
      '/usr/sbin/',
      '/system/',
      '/windows/',
      'c:\\windows\\',
      'c:\\program files\\',
      '/boot/',
      '/dev/',
      '/proc/',
      '/sys/',
    ];

    const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
    return dangerousPaths.some((dangerous) => normalizedPath.startsWith(dangerous));
  }

  /**
   * カスタムブロックリストに追加
   */
  async addToBlocklist(pattern: string): Promise<void> {
    const settings = await this.loadSettings();
    if (!settings.customBlocklist.includes(pattern)) {
      settings.customBlocklist.push(pattern);
      await this.updateSettings(settings);
    }
  }

  /**
   * カスタムブロックリストから削除
   */
  async removeFromBlocklist(pattern: string): Promise<void> {
    const settings = await this.loadSettings();
    const index = settings.customBlocklist.indexOf(pattern);
    if (index !== -1) {
      settings.customBlocklist.splice(index, 1);
      await this.updateSettings(settings);
    }
  }

  /**
   * ブロックリストを有効/無効切り替え
   */
  async toggleBlocklist(enabled: boolean): Promise<void> {
    const settings = await this.loadSettings();
    settings.enableBlocklist = enabled;
    await this.updateSettings(settings);
  }
}
