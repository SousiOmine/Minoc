import { dirname, join } from '@std/path';
import { ensureDir, exists } from '@std/fs';
import { BaseTool } from './base_tool.ts';
import type { ToolExecutionContext, ToolParameters, ToolResult } from '../../interfaces/tool.ts';

/**
 * ファイル読み込みツール
 */
export class ReadFileTool extends BaseTool {
  override readonly name = 'read_file';
  override readonly description = 'ファイルの内容を読み込みます';
  override readonly requiredParameters = ['path'];

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
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
        `ファイル '${path}' を読み込みました (${stat.size} bytes)`,
      );
    } catch (error) {
      return this.error(
        `ファイル読み込みエラー: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
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
        `ファイル '${path}' に書き込みました (${stat.size} bytes)`,
      );
    } catch (error) {
      return this.error(
        `ファイル書き込みエラー: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
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
      return this.error(
        `ディレクトリ作成エラー: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * ファイル名による検索ツール
 * Globパターンの代わりに、より直感的な検索条件を使用
 */
export class FindFilesByNameTool extends BaseTool {
  override readonly name = 'find_files_by_name';
  override readonly description = 'ファイル名に基づいてファイルを検索します（拡張子やキーワードで絞り込み可能）';
  override readonly requiredParameters = [];
  override readonly optionalParameters = ['directory', 'fileExtensions', 'nameContains', 'maxResults', 'includeHidden'];

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const directory = this.getOptionalParameter<string>(parameters, 'directory', '.') || '.';
      const fileExtensions = this.getOptionalParameter<string[]>(parameters, 'fileExtensions');
      const nameContains = this.getOptionalParameter<string>(parameters, 'nameContains');
      const maxResults = this.getOptionalParameter<number>(parameters, 'maxResults', 100) || 100;
      const includeHidden = this.getOptionalParameter<boolean>(parameters, 'includeHidden', false) ?? false;

      if ((!fileExtensions || fileExtensions.length === 0) && !nameContains) {
        return this.error('検索条件として fileExtensions または nameContains のいずれかを指定してください');
      }

      const workingDir = context?.workingDirectory || Deno.cwd();
      const baseDir = directory === '.' ? workingDir : join(workingDir, directory);

      if (!await exists(baseDir)) {
        return this.error(`検索ディレクトリが見つかりません: ${directory}`);
      }

      const results: Array<{ path: string; size: number; modified: Date }> = [];

      await this.findByNameRecursive(
        baseDir,
        results,
        maxResults,
        workingDir,
        fileExtensions,
        nameContains,
        includeHidden,
      );

      return this.success(
        {
          directory,
          fileExtensions,
          nameContains,
          matches: results.slice(0, maxResults),
          totalMatches: results.length,
        },
        `検索条件で ${results.length} 件のファイルが見つかりました`,
      );
    } catch (error) {
      return this.error(
        `ファイル名検索エラー: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 再帰的にファイル名で検索
   */
  private async findByNameRecursive(
    dir: string,
    results: Array<{ path: string; size: number; modified: Date }>,
    maxResults: number,
    baseDir: string,
    fileExtensions?: string[],
    nameContains?: string,
    includeHidden?: boolean,
  ): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (results.length >= maxResults) break;

        const fullPath = join(dir, entry.name);

        // 隠しファイル・ディレクトリのチェック
        if (!includeHidden && entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory) {
          await this.findByNameRecursive(
            fullPath,
            results,
            maxResults,
            baseDir,
            fileExtensions,
            nameContains,
            includeHidden,
          );
        } else if (entry.isFile) {
          let matches = true;

          // 拡張子チェック
          if (fileExtensions && fileExtensions.length > 0) {
            const fileExt = entry.name.split('.').pop()?.toLowerCase() || '';
            const searchExts = fileExtensions.map(ext => 
              ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
            );
            if (!searchExts.includes(fileExt)) {
              matches = false;
            }
          }

          // ファイル名部分マッチチェック
          if (nameContains && matches) {
            if (!entry.name.toLowerCase().includes(nameContains.toLowerCase())) {
              matches = false;
            }
          }

          if (matches) {
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
      }
    } catch {
      // アクセスできないディレクトリは無視
    }
  }
}

/**
 * ファイル内容検索ツール
 * ファイルの中身から特定の文字列を検索
 */
export class SearchContentInFilesTool extends BaseTool {
  override readonly name = 'search_content_in_files';
  override readonly description = 'ファイルの内容から指定された文字列を検索します（grepのような動作）';
  override readonly requiredParameters = ['searchText'];
  override readonly optionalParameters = ['directory', 'fileExtensions', 'maxResults', 'caseSensitive', 'includeHidden'];

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const searchText = this.getParameter<string>(parameters, 'searchText');
      const directory = this.getOptionalParameter<string>(parameters, 'directory', '.') || '.';
      const fileExtensions = this.getOptionalParameter<string[]>(parameters, 'fileExtensions');
      const maxResults = this.getOptionalParameter<number>(parameters, 'maxResults', 100) || 100;
      const caseSensitive = this.getOptionalParameter<boolean>(parameters, 'caseSensitive', false) ?? false;
      const includeHidden = this.getOptionalParameter<boolean>(parameters, 'includeHidden', false) ?? false;

      const workingDir = context?.workingDirectory || Deno.cwd();
      const baseDir = directory === '.' ? workingDir : join(workingDir, directory);

      if (!await exists(baseDir)) {
        return this.error(`検索ディレクトリが見つかりません: ${directory}`);
      }

      const results: Array<{
        path: string;
        matches: Array<{ lineNumber: number; lineContent: string }>;
        totalMatches: number;
      }> = [];

      await this.searchContentRecursive(
        baseDir,
        searchText,
        results,
        maxResults,
        workingDir,
        fileExtensions,
        caseSensitive,
        includeHidden,
      );

      const totalFiles = results.length;
      const totalMatches = results.reduce((sum, result) => sum + result.totalMatches, 0);

      return this.success(
        {
          searchText,
          directory,
          fileExtensions,
          caseSensitive,
          matches: results,
          totalFiles,
          totalMatches,
        },
        `"${searchText}" が ${totalFiles} 個のファイルで ${totalMatches} 件見つかりました`,
      );
    } catch (error) {
      return this.error(
        `コンテンツ検索エラー: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 再帰的にファイル内容を検索
   */
  private async searchContentRecursive(
    dir: string,
    searchText: string,
    results: Array<{
      path: string;
      matches: Array<{ lineNumber: number; lineContent: string }>;
      totalMatches: number;
    }>,
    maxResults: number,
    baseDir: string,
    fileExtensions?: string[],
    caseSensitive?: boolean,
    includeHidden?: boolean,
  ): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (results.length >= maxResults) break;

        const fullPath = join(dir, entry.name);

        // 隠しファイル・ディレクトリのチェック
        if (!includeHidden && entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory) {
          await this.searchContentRecursive(
            fullPath,
            searchText,
            results,
            maxResults,
            baseDir,
            fileExtensions,
            caseSensitive,
            includeHidden,
          );
        } else if (entry.isFile) {
          // 拡張子フィルタ
          if (fileExtensions && fileExtensions.length > 0) {
            const fileExt = entry.name.split('.').pop()?.toLowerCase();
            const allowedExts = fileExtensions.map(ext => 
              ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
            );
            if (!fileExt || !allowedExts.includes(fileExt)) {
              continue;
            }
          }

          try {
            const content = await Deno.readTextFile(fullPath);
            const lines = content.split('\n');
            const fileMatches: Array<{ lineNumber: number; lineContent: string }> = [];

            const searchTarget = caseSensitive ? searchText : searchText.toLowerCase();

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const searchLine = caseSensitive ? line : line.toLowerCase();

              if (searchLine.includes(searchTarget)) {
                fileMatches.push({
                  lineNumber: i + 1,
                  lineContent: line.trim(),
                });
              }
            }

            if (fileMatches.length > 0) {
              const relativePath = fullPath.replace(baseDir, '').replace(/^[/\\]/, '');
              results.push({
                path: relativePath,
                matches: fileMatches,
                totalMatches: fileMatches.length,
              });
            }
          } catch {
            // 読み込めないファイル（バイナリファイルなど）は無視
          }
        }
      }
    } catch {
      // アクセスできないディレクトリは無視
    }
  }
}

/**
 * ディレクトリ一覧取得ツール
 */
export class ListDirectoryTool extends BaseTool {
  override readonly name = 'list_directory';
  override readonly description =
    '指定されたディレクトリ内のファイル・フォルダ一覧を取得します（隠しファイル含む、詳細情報付き）';
  override readonly requiredParameters = ['path'];

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
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
          directories: entries.filter((e) => e.type === 'directory').length,
          files: entries.filter((e) => e.type === 'file').length,
          entries,
        },
        `ディレクトリ '${path}' から ${entries.length} 個のアイテムを取得しました`,
      );
    } catch (error) {
      return this.error(
        `ディレクトリ一覧取得エラー: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    baseDir: string,
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

/**
 * 複数ファイル読み込みツール
 */
export class ReadMultipleFilesTool extends BaseTool {
  override readonly name = 'read_files';
  override readonly description = '複数のファイルの内容を読み込みます';
  override readonly requiredParameters = ['paths'];

  override async execute(
    parameters: ToolParameters,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const paths = this.getParameter<Array<{ path: string }>>(parameters, 'paths');
      if (!paths || paths.length === 0) {
        return this.error('ファイルパスが指定されていません');
      }

      const results: Array<{ path: string; content?: string; error?: string; size?: number }> = [];
      let successCount = 0;
      let errorCount = 0;

      for (const item of paths) {
        const path = item.path;
        const fullPath = context?.workingDirectory ? join(context.workingDirectory, path) : path;

        try {
          if (!await exists(fullPath)) {
            results.push({ path, error: 'ファイルが見つかりません' });
            errorCount++;
            continue;
          }

          const stat = await Deno.stat(fullPath);
          if (!stat.isFile) {
            results.push({ path, error: '指定されたパスはファイルではありません' });
            errorCount++;
            continue;
          }

          const content = await Deno.readTextFile(fullPath);
          results.push({ path, content, size: stat.size });
          successCount++;
        } catch (error) {
          results.push({
            path,
            error: `読み込みエラー: ${error instanceof Error ? error.message : String(error)}`,
          });
          errorCount++;
        }
      }

      return this.success(
        { paths: results, successCount, errorCount },
        `${paths.length} 件中 ${successCount} 件のファイルを読み込みました (${errorCount} 件のエラー)`,
      );
    } catch (error) {
      return this.error(
        `複数ファイル読み込みエラー: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
