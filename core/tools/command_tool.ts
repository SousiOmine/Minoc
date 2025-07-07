import { BaseTool } from './base_tool.ts';
import type { ToolParameters, ToolResult, ToolExecutionContext } from '../../interfaces/tool.ts';

/**
 * コマンド実行ツール
 */
export class ExecuteCommandTool extends BaseTool {
  override readonly name = 'execute_command';
  override readonly description = 'シェルコマンドを実行します';
  override readonly requiredParameters = ['command'];
  override readonly optionalParameters = ['workingDirectory', 'timeout', 'requiresApproval'];
  override readonly dangerous = true;
  override readonly requiresApproval = true;

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const command = this.getParameter<string>(parameters, 'command');
      const workingDirectory = this.getOptionalParameter<string>(
        parameters, 
        'workingDirectory', 
        context?.workingDirectory || Deno.cwd()
      );
      const timeout = this.getOptionalParameter<number>(parameters, 'timeout', 30000); // 30秒

      // コマンドを分割
      const args = this.parseCommand(command);
      if (args.length === 0) {
        return this.error('コマンドが空です');
      }

      const startTime = Date.now();

      // プロセスを実行
      const cmd = new Deno.Command(args[0], {
        args: args.slice(1),
        cwd: workingDirectory,
        stdout: 'piped',
        stderr: 'piped',
        env: context?.environment,
      });

      let process: Deno.ChildProcess;
      let output: Deno.CommandOutput;

      try {
        process = cmd.spawn();
        
        // タイムアウト制御
        const timeoutId = setTimeout(() => {
          try {
            process.kill('SIGTERM');
          } catch {
            // プロセスが既に終了している場合は無視
          }
        }, timeout);

        output = await process.output();
        clearTimeout(timeoutId);
      } catch (error) {
        return this.error(`コマンド実行エラー: ${error instanceof Error ? error.message : String(error)}`);
      }

      const duration = Date.now() - startTime;
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);

      const result = {
        command,
        exitCode: output.code,
        stdout,
        stderr,
        duration,
        workingDirectory,
      };

      if (output.success) {
        return this.success(
          result,
          `コマンドが正常に実行されました (終了コード: ${output.code}, 実行時間: ${duration}ms)`
        );
      } else {
        return this.error(
          `コマンドが失敗しました (終了コード: ${output.code})`,
          result
        );
      }
    } catch (error) {
      return this.error(`コマンド実行エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * コマンド文字列を引数配列に分割
   */
  private parseCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        } else {
          current += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuotes = true;
          quoteChar = char;
        } else if (char === ' ') {
          if (current.length > 0) {
            args.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }

    if (current.length > 0) {
      args.push(current);
    }

    return args;
  }
} 