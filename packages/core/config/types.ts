/**
 * アプリケーション基本設定
 */
export interface AppSettings {
  /** デフォルトモデル */
  defaultModel: string;
  /** デバッグモード */
  debug: boolean;
  /** 進捗表示設定 */
  showProgress: boolean;
  /** 進捗表示の閾値（秒） */
  progressThreshold: number;
  /** ログレベル */
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  /** 最大履歴保持数 */
  maxHistoryCount: number;
}

/**
 * 権限設定
 */
export interface PermissionSettings {
  /** 永続許可されたツール */
  permanentlyAllowed: string[];
  /** 自動拒否するツール */
  autoReject: string[];
  /** 危険なコマンドのブロックリスト */
  blockedCommands: string[];
  /** 権限レベル */
  permissionLevel: 'strict' | 'normal' | 'permissive';
}

/**
 * モデル設定
 */
export interface ModelConfig {
  /** APIベースURL */
  baseUrl?: string;
  /** APIキー */
  apiKey?: string;
  /** 生成パラメータ */
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  /** カスタムインストラクション */
  customInstructions?: string;
}

/**
 * モデル設定マップ
 */
export interface ModelSettings {
  [modelName: string]: ModelConfig;
}

/**
 * セキュリティ設定
 */
export interface SecuritySettings {
  /** ブロックリスト有効化 */
  enableBlocklist: boolean;
  /** カスタムブロックリスト */
  customBlocklist: string[];
  /** 危険度レベル別の制御 */
  riskLevels: {
    high: string[];
    medium: string[];
    low: string[];
  };
  /** セキュリティ警告の表示 */
  showSecurityWarnings: boolean;
}

/**
 * デバッグ設定
 */
export interface DebugSettings {
  /** 詳細ログ出力 */
  verboseLogging: boolean;
  /** API通信ログ */
  logApiCalls: boolean;
  /** ツール実行ログ */
  logToolExecutions: boolean;
  /** パフォーマンス計測 */
  measurePerformance: boolean;
}
