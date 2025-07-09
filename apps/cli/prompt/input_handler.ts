import { ChatEngine } from '../../../packages/core/chat/chat_engine.ts';
import { CommandHandler } from '../commands/command_handler.ts';

/**
 * ユーザー入力ハンドラークラス
 * ユーザー入力の取得と対話ループの管理
 */
export class InputHandler {
  private chatEngine: ChatEngine;
  private commandHandler: CommandHandler;

  constructor(chatEngine: ChatEngine, commandHandler: CommandHandler) {
    this.chatEngine = chatEngine;
    this.commandHandler = commandHandler;
  }

  /**
   * 対話ループ
   */
  async startChatLoop(): Promise<void> {
    while (true) {
      try {
        const userInput = await this.getUserInput('> ');

        if (userInput.startsWith('/')) {
          const handled = await this.commandHandler.handleCommand(userInput);
          if (!handled) {
            break; // quit コマンド
          }
          continue;
        }

        if (userInput.trim() === '') {
          continue;
        }

        await this.chatEngine.processUserMessage(userInput);
      } catch (error) {
        console.error(
          `❌ エラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * ユーザー入力を取得
   */
  async getUserInput(prompt: string): Promise<string> {
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
}
