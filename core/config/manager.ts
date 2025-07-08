import { join, dirname } from '@std/path';
import { ensureDir, exists } from '@std/fs';
import { parse as parseToml, stringify as stringifyToml } from '@std/toml';
import type {
  AppSettings,
  PermissionSettings,
  ModelSettings,
  SecuritySettings,
  DebugSettings,
} from './types.ts';

/**
 * 設定管理クラス
 */
export class ConfigManager {
  private configDir: string;
  private executablePath: string;

  constructor() {
    // 実行ファイルのパスを取得（要件定義の通り、実行ファイルと同階層を基準とする）
    this.executablePath = Deno.execPath();
    this.configDir = join(dirname(this.executablePath), '.minoc');
  }

  /**
   * 設定ディレクトリを初期化
   */
  async initializeConfigDirectory(): Promise<void> {
    await ensureDir(this.configDir);
    await ensureDir(join(this.configDir, 'config'));
    await ensureDir(join(this.configDir, 'history', 'sessions'));
    await ensureDir(join(this.configDir, 'logs'));
  }

  /**
   * 設定ファイルのパスを取得
   */
  private getConfigPath(filename: string): string {
    return join(this.configDir, 'config', filename);
  }

  /**
   * 設定ファイルを読み込み
   */
  private async loadConfig<T>(filename: string, defaultConfig: T): Promise<T> {
    const configPath = this.getConfigPath(filename);
    
    if (!await exists(configPath)) {
      await this.saveConfig(filename, defaultConfig);
      return defaultConfig;
    }

    try {
      const content = await Deno.readTextFile(configPath);
      const parsed = parseToml(content) as T;
      return { ...defaultConfig, ...parsed };
    } catch (error) {
      console.warn(`設定ファイル ${filename} の読み込みに失敗しました:`, error);
      return defaultConfig;
    }
  }

  /**
   * 設定ファイルを保存
   */
  private async saveConfig<T>(filename: string, config: T): Promise<void> {
    const configPath = this.getConfigPath(filename);
    await ensureDir(dirname(configPath));
    const tomlContent = stringifyToml(config as Record<string, unknown>);
    await Deno.writeTextFile(configPath, tomlContent);
  }

  /**
   * アプリケーション設定を取得
   */
  async getAppSettings(): Promise<AppSettings> {
    const defaultSettings: AppSettings = {
      defaultModel: 'gpt-4',
      debug: false,
      showProgress: true,
      progressThreshold: 5,
      logLevel: 'INFO',
      maxHistoryCount: 100,
    };

    return this.loadConfig('settings.toml', defaultSettings);
  }

  /**
   * アプリケーション設定を保存
   */
  async saveAppSettings(settings: AppSettings): Promise<void> {
    await this.saveConfig('settings.toml', settings);
  }

  /**
   * 権限設定を取得
   */
  async getPermissionSettings(): Promise<PermissionSettings> {
    const defaultSettings: PermissionSettings = {
      permanentlyAllowed: [],
      autoReject: [],
      blockedCommands: [
        'rm -rf',
        'del /s',
        'format',
        'sudo rm',
        'sudo chmod 777',
        'shutdown',
        'reboot',
        'mkfs',
      ],
      permissionLevel: 'strict',
    };

    return this.loadConfig('permissions.toml', defaultSettings);
  }

  /**
   * 権限設定を保存
   */
  async savePermissionSettings(settings: PermissionSettings): Promise<void> {
    await this.saveConfig('permissions.toml', settings);
  }

  /**
   * モデル設定を取得
   */
  async getModelSettings(): Promise<ModelSettings> {
    const defaultSettings: ModelSettings = {
      'gpt-4': {
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.7,
        top_p: 1.0,
        top_k: 50,
        max_tokens: 4096,
      },
      'gpt-3.5-turbo': {
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.7,
        top_p: 1.0,
        top_k: 50,
        max_tokens: 4096,
      },
      'claude-3-5-sonnet-20241022': {
        baseUrl: 'https://api.anthropic.com/v1',
        temperature: 0.7,
        top_p: 1.0,
        top_k: 50,
        max_tokens: 4096,
      },
      'claude-3-haiku-20240307': {
        baseUrl: 'https://api.anthropic.com/v1',
        temperature: 0.7,
        top_p: 1.0,
        top_k: 50,
        max_tokens: 4096,
      },
    };

    return this.loadConfig('models.toml', defaultSettings);
  }

  /**
   * モデル設定を保存
   */
  async saveModelSettings(settings: ModelSettings): Promise<void> {
    await this.saveConfig('models.toml', settings);
  }

  /**
   * セキュリティ設定を取得
   */
  async getSecuritySettings(): Promise<SecuritySettings> {
    const defaultSettings: SecuritySettings = {
      enableBlocklist: true,
      customBlocklist: [],
      riskLevels: {
        high: [
          'rm -rf',
          'del /s',
          'format',
          'fdisk',
          'mkfs',
          'dd if=',
          'sudo',
          'runas',
          'shutdown',
          'reboot',
          'halt',
        ],
        medium: [
          'chmod 777',
          'chown',
          'systemctl',
          'service',
          'crontab',
          'reg add',
          'reg delete',
        ],
        low: [
          'ps aux',
          'netstat',
          'lsof',
          'top',
          'htop',
        ],
      },
      showSecurityWarnings: true,
    };

    return this.loadConfig('security.toml', defaultSettings);
  }

  /**
   * セキュリティ設定を保存
   */
  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    await this.saveConfig('security.toml', settings);
  }

  /**
   * デバッグ設定を取得
   */
  async getDebugSettings(): Promise<DebugSettings> {
    const defaultSettings: DebugSettings = {
      verboseLogging: false,
      logApiCalls: false,
      logToolExecutions: true,
      measurePerformance: false,
    };

    return this.loadConfig('debug.toml', defaultSettings);
  }

  /**
   * デバッグ設定を保存
   */
  async saveDebugSettings(settings: DebugSettings): Promise<void> {
    await this.saveConfig('debug.toml', settings);
  }

  /**
   * ログディレクトリのパスを取得
   */
  getLogsDirectory(): string {
    return join(this.configDir, 'logs');
  }

  /**
   * 履歴ディレクトリのパスを取得
   */
  getHistoryDirectory(): string {
    return join(this.configDir, 'history');
  }

  /**
   * 設定ディレクトリのパスを取得
   */
  getConfigDirectory(): string {
    return this.configDir;
  }

  /**
   * 既存のJSON設定ファイルをTOML形式に移行
   */
  async migrateFromJson(): Promise<void> {
    const jsonFiles = [
      'settings.json',
      'permissions.json',
      'models.json',
      'security.json',
      'debug.json'
    ];

    const tomlFiles = [
      'settings.toml',
      'permissions.toml',
      'models.toml',
      'security.toml',
      'debug.toml'
    ];

    for (let i = 0; i < jsonFiles.length; i++) {
      const jsonPath = this.getConfigPath(jsonFiles[i]);
      const tomlPath = this.getConfigPath(tomlFiles[i]);

      // JSONファイルが存在し、TOMLファイルが存在しない場合に移行
      if (await exists(jsonPath) && !await exists(tomlPath)) {
        try {
          const jsonContent = await Deno.readTextFile(jsonPath);
          const config = JSON.parse(jsonContent);
          const tomlContent = stringifyToml(config);
          await Deno.writeTextFile(tomlPath, tomlContent);
          
          console.log(`✅ ${jsonFiles[i]} を ${tomlFiles[i]} に移行しました`);
          
          // JSONファイルをバックアップ用にリネーム
          const backupPath = this.getConfigPath(`${jsonFiles[i]}.backup`);
          await Deno.rename(jsonPath, backupPath);
          console.log(`📦 ${jsonFiles[i]} を ${jsonFiles[i]}.backup にバックアップしました`);
          
        } catch (error) {
          console.warn(`⚠️  ${jsonFiles[i]} の移行に失敗しました:`, error);
        }
      }
    }
  }

  /**
   * バックアップされたJSONファイルを削除
   */
  async cleanupJsonBackups(): Promise<void> {
    const backupFiles = [
      'settings.json.backup',
      'permissions.json.backup',
      'models.json.backup',
      'security.json.backup',
      'debug.json.backup'
    ];

    for (const backupFile of backupFiles) {
      const backupPath = this.getConfigPath(backupFile);
      if (await exists(backupPath)) {
        try {
          await Deno.remove(backupPath);
          console.log(`🗑️  ${backupFile} を削除しました`);
        } catch (error) {
          console.warn(`⚠️  ${backupFile} の削除に失敗しました:`, error);
        }
      }
    }
  }
} 