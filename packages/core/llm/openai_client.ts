import OpenAI from 'openai';
import type { AgentConfig } from '../../interfaces/agent.ts';
import type { Message } from '../../interfaces/history.ts';

/**
 * APIエラー情報
 */
export interface ApiError {
  type: 'network' | 'rate_limit' | 'server' | 'auth' | 'unknown';
  message: string;
  retryable: boolean;
}

/**
 * チャット完了レスポンス
 */
export interface ChatCompletionResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

/**
 * リトライ設定
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ミリ秒
  maxDelay: number; // ミリ秒
}

/**
 * OpenAI APIクライアントクラス
 */
export class OpenAIClient {
  private client: OpenAI;
  private config: AgentConfig;
  private retryConfig: RetryConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 16000,
    };
  }

  /**
   * チャット完了API呼び出し
   */
  async chatCompletion(
    messages: Message[],
    stream = false,
  ): Promise<ChatCompletionResponse> {
    const openaiMessages = this.convertMessages(messages);

    return this.executeWithRetry(async () => {
      try {
        // APIリクエストパラメータを構築（未定義の値は除外）
        const requestParams: any = {
          model: this.config.model,
          messages: openaiMessages,
          stream: false, // 明示的にfalseに設定
        };

        // 定義されているパラメータのみ追加
        if (this.config.temperature !== undefined) {
          requestParams.temperature = this.config.temperature;
        }
        if (this.config.top_p !== undefined) {
          requestParams.top_p = this.config.top_p;
        }
        if (this.config.max_tokens !== undefined) {
          requestParams.max_tokens = this.config.max_tokens;
        }
        // 注意: OpenAI APIはtop_kをサポートしていないため、ここでは除外

        const response = await this.client.chat.completions.create(requestParams);

        // 型ガードでストリーミングレスポンスではないことを確認
        if ('choices' in response && 'model' in response) {
          const choice = response.choices[0];
          if (!choice || !choice.message) {
            throw new Error('APIレスポンスが無効です');
          }

          // LLMが空の応答を返した場合は再試行をトリガー
          const content = choice.message.content || '';
          if (content.trim().length === 0) {
            throw new Error('空の応答を受信しました');
          }

          return {
            content: content,
            usage: response.usage
              ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
              : undefined,
            model: response.model,
          };
        } else {
          throw new Error('予期しないレスポンス形式です');
        }
      } catch (error) {
        throw this.convertError(error);
      }
    });
  }

  /**
   * メッセージ形式をOpenAI形式に変換
   */
  private convertMessages(messages: Message[]): Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }> {
    const openaiMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }> = [];

    for (const message of messages) {
      if (message.role === 'system') {
        openaiMessages.push({
          role: 'system',
          content: message.content,
        });
      } else if (message.role === 'user') {
        openaiMessages.push({
          role: 'user',
          content: `<user_query>${message.content}</user_query>`,
        });
      } else if (message.role === 'assistant') {
        openaiMessages.push({
          role: 'assistant',
          content: message.content,
        });
      }
    }

    return openaiMessages;
  }

  /**
   * エラーを分類してApiErrorに変換
   */
  private convertError(error: unknown): ApiError {
    if (error instanceof Error) {
      // 空の応答エラーは再試行可能とする
      if (error.message.includes('空の応答')) {
        return {
          type: 'server',
          message: error.message,
          retryable: true,
        };
      }
      // OpenAI固有のエラー
      if ('status' in error) {
        const status = (error as any).status;

        if (status === 429) {
          return {
            type: 'rate_limit',
            message: 'レート制限に達しました',
            retryable: true,
          };
        }

        if (status === 401 || status === 403) {
          return {
            type: 'auth',
            message: 'API認証に失敗しました',
            retryable: false,
          };
        }

        if (status >= 500) {
          return {
            type: 'server',
            message: 'サーバーエラーが発生しました',
            retryable: true,
          };
        }
      }

      // ネットワークエラー
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return {
          type: 'network',
          message: 'ネットワークエラーが発生しました',
          retryable: true,
        };
      }

      return {
        type: 'unknown',
        message: error.message,
        retryable: false,
      };
    }

    return {
      type: 'unknown',
      message: '不明なエラーが発生しました',
      retryable: false,
    };
  }

  /**
   * 指数バックオフによるリトライ実行
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: ApiError | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const apiError = this.convertError(error);

        lastError = apiError;

        // リトライ不可能なエラーの場合は即座に失敗
        if (!apiError.retryable) {
          throw apiError;
        }

        // 最後の試行の場合はエラーを投げる
        if (attempt === this.retryConfig.maxRetries) {
          throw apiError;
        }

        // 指数バックオフで待機
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(2, attempt),
          this.retryConfig.maxDelay,
        );

        console.warn(
          `API呼び出し失敗（試行 ${attempt + 1}/${
            this.retryConfig.maxRetries + 1
          }）: ${apiError.message}`,
        );
        console.warn(`${delay}ms後にリトライします...`);

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // ここに到達することはないはずだが、安全のため
    throw lastError || new Error('リトライ回数を超過しました');
  }

  /**
   * 設定を更新
   */
  updateConfig(config: AgentConfig): void {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  /**
   * リトライ設定を更新
   */
  updateRetryConfig(retryConfig: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...retryConfig };
  }
}
