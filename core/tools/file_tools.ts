import { join, dirname } from '@std/path';
import { exists, ensureDir } from '@std/fs';
import { BaseTool } from './base_tool.ts';
import type { ToolParameters, ToolResult, ToolExecutionContext } from '../../interfaces/tool.ts';

/**
 * ファイル読み込みツール
 */
export class ReadFileTool extends BaseTool {
  override readonly name = 'read_file';
  override readonly description = 'ファイルの内容を読み込みます';
  override readonly requiredParameters = ['path'];

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.getParameter<string>(parameters, 'path');
      const fullPath = context?.workingDirectory ? join(context.workingDirectory, path) : path;

      if (!await exists(fullPath)) {
        return this.error(`ファイルが見つかりません: ${path}`);
      }

      const stat = await Deno.stat(fullPath);
      if (!stat.isFile) {
        return this.error(`指定されたパスはファイルではありません: ${path}`);
      }

      const content = await Deno.readTextFile(fullPath);
      return this.success(
        { path, content, size: stat.size },
        `ファイル '${path}' を読み込みました (${stat.size} bytes)`
      );
    } catch (error) {
      return this.error(`ファイル読み込みエラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * ファイル書き込みツール
 */
export class WriteToFileTool extends BaseTool {
  override readonly name = 'write_to_file';
  override readonly description = 'ファイルに内容を書き込みます';
  override readonly requiredParameters = ['path', 'content'];
  override readonly optionalParameters = ['overwrite'];
  override readonly dangerous = true;
  override readonly requiresApproval = true;

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.getParameter<string>(parameters, 'path');
      const content = this.getParameter<string>(parameters, 'content');
      const overwrite = this.getOptionalParameter<boolean>(parameters, 'overwrite', true);
      
      const fullPath = context?.workingDirectory ? join(context.workingDirectory, path) : path;

      // ファイルが既に存在し、上書きが許可されていない場合
      if (!overwrite && await exists(fullPath)) {
        return this.error(`ファイルが既に存在します: ${path}`);
      }

      // ディレクトリを作成
      await ensureDir(dirname(fullPath));

      // ファイルに書き込み
      await Deno.writeTextFile(fullPath, content);

      const stat = await Deno.stat(fullPath);
      return this.success(
        { path, size: stat.size },
        `ファイル '${path}' に書き込みました (${stat.size} bytes)`
      );
    } catch (error) {
      return this.error(`ファイル書き込みエラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * ディレクトリ作成ツール
 */
export class CreateDirectoryTool extends BaseTool {
  override readonly name = 'create_directory';
  override readonly description = 'ディレクトリを作成します';
  override readonly requiredParameters = ['path'];
  override readonly optionalParameters = ['recursive'];

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.getParameter<string>(parameters, 'path');
      const recursive = this.getOptionalParameter<boolean>(parameters, 'recursive', true);
      
      const fullPath = context?.workingDirectory ? join(context.workingDirectory, path) : path;

      if (await exists(fullPath)) {
        const stat = await Deno.stat(fullPath);
        if (stat.isDirectory) {
          return this.success({ path }, `ディレクトリは既に存在します: ${path}`);
        } else {
          return this.error(`同名のファイルが存在します: ${path}`);
        }
      }

      if (recursive) {
        await ensureDir(fullPath);
      } else {
        await Deno.mkdir(fullPath);
      }

      return this.success({ path }, `ディレクトリを作成しました: ${path}`);
    } catch (error) {
      return this.error(`ディレクトリ作成エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 

/**
 * ファイル検索ツール
 */
export class SearchFilesTool extends BaseTool {
  override readonly name = 'search_files';
  override readonly description = 'ファイルパターンに基づいてファイルを検索します';
  override readonly requiredParameters = ['pattern'];
  override readonly optionalParameters = ['directory', 'maxResults'];

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const pattern = this.getParameter<string>(parameters, 'pattern');
      const directory = this.getOptionalParameter<string>(parameters, 'directory', '.') || '.';
      const maxResults = this.getOptionalParameter<number>(parameters, 'maxResults', 100) || 100;
      
      const workingDir = context?.workingDirectory || Deno.cwd();
      const baseDir = directory === '.' ? workingDir : join(workingDir, directory);

      if (!await exists(baseDir)) {
        return this.error(`検索ディレクトリが見つかりません: ${directory}`);
      }

      const results: Array<{ path: string; size: number; modified: Date }> = [];
      
      // 簡単なglob風のパターンマッチング
      const regex = this.globToRegex(pattern);
      
      await this.searchRecursive(baseDir, regex, results, maxResults, workingDir);

      return this.success(
        { 
          pattern, 
          directory, 
          matches: results.slice(0, maxResults),
          totalMatches: results.length 
        },
        `パターン '${pattern}' で ${results.length} 件のファイルが見つかりました`
      );
    } catch (error) {
      return this.error(`ファイル検索エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 再帰的にファイルを検索
   */
  private async searchRecursive(
    dir: string, 
    regex: RegExp, 
    results: Array<{ path: string; size: number; modified: Date }>,
    maxResults: number,
    baseDir: string
  ): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (results.length >= maxResults) break;

        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory) {
          await this.searchRecursive(fullPath, regex, results, maxResults, baseDir);
        } else if (entry.isFile && regex.test(entry.name)) {
          try {
            const stat = await Deno.stat(fullPath);
            const relativePath = fullPath.replace(baseDir, '').replace(/^[/\\]/, '');
            results.push({
              path: relativePath,
              size: stat.size,
              modified: stat.mtime || new Date(),
            });
          } catch {
            // アクセスできないファイルは無視
          }
        }
      }
    } catch {
      // アクセスできないディレクトリは無視
    }
  }

  /**
   * Globパターンを正規表現に変換
   */
  private globToRegex(pattern: string): RegExp {
    // エスケープ処理
    let regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\+/g, '\\+')
      .replace(/\?/g, '.')
      .replace(/\*/g, '.*');
    
    return new RegExp(`^${regex}$`, 'i');
  }
} 

/**
 * ディレクトリ一覧取得ツール
 */
export class ListDirectoryTool extends BaseTool {
  override readonly name = 'list_directory';
  override readonly description = '指定されたディレクトリ内のファイル・フォルダ一覧を取得します（隠しファイル含む、詳細情報付き）';
  override readonly requiredParameters = ['path'];

  override async execute(parameters: ToolParameters, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const path = this.getParameter<string>(parameters, 'path');
      
      const workingDir = context?.workingDirectory || Deno.cwd();
      const targetDir = path === '.' ? workingDir : join(workingDir, path);

      if (!await exists(targetDir)) {
        return this.error(`ディレクトリが見つかりません: ${path}`);
      }

      const stat = await Deno.stat(targetDir);
      if (!stat.isDirectory) {
        return this.error(`指定されたパスはディレクトリではありません: ${path}`);
      }

      const entries: Array<{
        name: string;
        type: 'file' | 'directory';
        path: string;
        size?: number;
        modified?: Date;
      }> = [];

      // 固定設定: recursive=false, showHidden=true, includeDetails=true
      await this.listSingle(targetDir, entries, workingDir);

      // 名前でソート（ディレクトリを先に、その後ファイル名順）
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return this.success(
        { 
          path,
          totalItems: entries.length,
          directories: entries.filter(e => e.type === 'directory').length,
          files: entries.filter(e => e.type === 'file').length,
          entries 
        },
        `ディレクトリ '${path}' から ${entries.length} 個のアイテムを取得しました`
      );
    } catch (error) {
      return this.error(`ディレクトリ一覧取得エラー: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 単一階層のディレクトリ一覧を取得
   */
  private async listSingle(
    dir: string,
    entries: Array<{
      name: string;
      type: 'file' | 'directory';
      path: string;
      size?: number;
      modified?: Date;
    }>,
    baseDir: string
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.replace(baseDir, '').replace(/^[/\\]/, '') || entry.name;

        const item: {
          name: string;
          type: 'file' | 'directory';
          path: string;
          size?: number;
          modified?: Date;
        } = {
          name: entry.name,
          type: entry.isDirectory ? 'directory' : 'file',
          path: relativePath,
        };

        // 詳細情報を取得（固定でtrue）
        try {
          const stat = await Deno.stat(fullPath);
          if (entry.isFile) {
            item.size = stat.size;
          }
          item.modified = stat.mtime || undefined;
        } catch {
          // ステータス取得に失敗した場合は詳細情報なしで追加
        }

        entries.push(item);
      }
    } catch (error) {
      // ディレクトリアクセスエラーは無視して続行
      console.warn(`ディレクトリアクセスエラー: ${dir} - ${error}`);
    }
  }


} 