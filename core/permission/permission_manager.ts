import type { PermissionSettings } from '../config/types.ts';
import { ConfigManager } from '../config/manager.ts';
import { SecurityManager, type SecurityCheckResult } from './security_manager.ts';
import type { ToolCallRequest } from '../../interfaces/tool.ts';

/**
 * 権限チェック結果
 */
export interface PermissionResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  securityResult?: SecurityCheckResult;
}

/**
 * 権限管理クラス
 */
export class PermissionManager {
  private configManager: ConfigManager;
  private securityManager: SecurityManager;
  private permissionSettings: PermissionSettings | null = null;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.securityManager = new SecurityManager(configManager);
  }

  /**
   * 権限設定を読み込み
   */
  private async loadSettings(): Promise<PermissionSettings> {
    if (!this.permissionSettings) {
      this.permissionSettings = await this.configManager.getPermissionSettings();
    }
    return this.permissionSettings;
  }

  /**
   * ツール呼び出しの権限チェック
   */
  async checkPermission(toolCall: ToolCallRequest): Promise<PermissionResult> {
    const settings = await this.loadSettings();
    
    // セキュリティチェック
    const securityResult = await this.securityManager.checkTool(
      toolCall.toolName, 
      toolCall.parameters
    );

    if (!securityResult.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: securityResult.blockedReason,
        securityResult,
      };
    }

    // 自動拒否リストのチェックは廃止されました

    // 永続許可リストのチェック
    if (settings.permanentlyAllowed.includes(toolCall.toolName)) {
      return {
        allowed: true,
        requiresApproval: false,
        securityResult,
      };
    }

    // 権限レベルに基づく判定
    const requiresApproval = this.shouldRequireApproval(toolCall, settings, securityResult);

    return {
      allowed: true,
      requiresApproval,
      securityResult,
    };
  }

  /**
   * 承認が必要かどうかを判定
   */
  private shouldRequireApproval(
    toolCall: ToolCallRequest, 
    settings: PermissionSettings,
    securityResult: SecurityCheckResult
  ): boolean {
    // 明示的に承認が要求されている場合
    if (toolCall.requiresApproval === true) {
      return true;
    }

    // 明示的に承認が不要とされている場合
    if (toolCall.requiresApproval === false) {
      return false;
    }

    // 権限レベルに基づく判定
    switch (settings.permissionLevel) {
      case 'strict':
        // 厳格モード：すべてのツールで承認が必要
        return true;
      
      case 'permissive':
        // 寛容モード：高リスクツールのみ承認が必要
        return securityResult.riskLevel === 'high';
      
      case 'normal':
      default:
        // 通常モード：中リスク以上で承認が必要
        return securityResult.riskLevel === 'medium' || securityResult.riskLevel === 'high';
    }
  }

  /**
   * ツールを永続許可リストに追加
   */
  async addToPermanentlyAllowed(toolName: string): Promise<void> {
    const settings = await this.loadSettings();
    if (!settings.permanentlyAllowed.includes(toolName)) {
      settings.permanentlyAllowed.push(toolName);
      await this.saveSettings(settings);
    }
  }



  /**
   * 永続許可リストからツールを削除
   */
  async removeFromPermanentlyAllowed(toolName: string): Promise<void> {
    const settings = await this.loadSettings();
    const index = settings.permanentlyAllowed.indexOf(toolName);
    if (index !== -1) {
      settings.permanentlyAllowed.splice(index, 1);
      await this.saveSettings(settings);
    }
  }



  /**
   * 権限レベルを変更
   */
  async setPermissionLevel(level: 'strict' | 'normal' | 'permissive'): Promise<void> {
    const settings = await this.loadSettings();
    settings.permissionLevel = level;
    await this.saveSettings(settings);
  }

  /**
   * 権限設定を保存
   */
  private async saveSettings(settings: PermissionSettings): Promise<void> {
    await this.configManager.savePermissionSettings(settings);
    this.permissionSettings = settings;
  }

  /**
   * セキュリティマネージャーを取得
   */
  getSecurityManager(): SecurityManager {
    return this.securityManager;
  }

  /**
   * 現在の権限設定を取得
   */
  async getCurrentSettings(): Promise<PermissionSettings> {
    return this.loadSettings();
  }
} 