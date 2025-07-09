import type {
  Tool,
  ToolCallRequest,
  ToolExecutionContext,
  ToolResult,
} from '../../interfaces/tool.ts';
import { PermissionManager, type PermissionResult } from '../permission/permission_manager.ts';
import { ConfigManager } from '../config/manager.ts';

// 基本ツールのインポート
import {
  CreateDirectoryTool,
  FindFilesByNameTool,
  ListDirectoryTool,
  ReadFileTool,
  ReadMultipleFilesTool,
  SearchContentInFilesTool,
  WriteToFileTool,
} from './file_tools.ts';
import { ExecuteCommandTool } from './command_tool.ts';
import { RespondToUserTool } from './response_tool.ts';

/**
 * XML形式のツール呼び出しをパースする結果
 */
export interface ParsedToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
}

/**
 * ツール実行管理クラス
 */
export class ToolExecutor {
  private tools: Map<string, Tool> = new Map();
  private permissionManager: PermissionManager;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.permissionManager = new PermissionManager(configManager);
    this.registerDefaultTools();
  }

  /**
   * デフォルトツールを登録
   */
  private registerDefaultTools(): void {
    const defaultTools = [
      new ReadFileTool(),
      new WriteToFileTool(),
      new CreateDirectoryTool(),
      new FindFilesByNameTool(),
      new SearchContentInFilesTool(),
      new ListDirectoryTool(),
      new ExecuteCommandTool(),
      new ReadMultipleFilesTool(),
      new RespondToUserTool(),
    ];

    for (const tool of defaultTools) {
      this.registerTool(tool);
    }
  }

  /**
   * ツールを登録
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * ツールを取得
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 登録されているツール一覧を取得
   */
  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * XML形式のツール呼び出し文字列をパース
   */
  parseXmlToolCall(xmlContent: string): ParsedToolCall | null {
    try {
      // 簡単なXMLパーサー（要件では複雑なXMLは想定していない）
      const toolCallMatch = xmlContent.match(/<tool_call>\s*<(\w+)>(.*?)<\/\1>\s*<\/tool_call>/s);
      if (!toolCallMatch) {
        return null;
      }

      const toolName = toolCallMatch[1];
      const parametersXml = toolCallMatch[2];

      // パラメータを抽出
      const parameters: Record<string, unknown> = {};
      const paramMatches = parametersXml.matchAll(/<(\w+)>(.*?)<\/\1>/gs);

      for (const match of paramMatches) {
        const paramName = match[1];
        const rawValue = match[2].trim();
        // contentパラメータは生の文字列をそのまま使用し、その他は型変換を試行
        if (paramName === 'content') {
          parameters[paramName] = rawValue;
        } else {
          parameters[paramName] = this.parseParameterValue(rawValue);
        }
      }

      // 特別な処理：pathsパラメータ（複数ファイル読み込み用）
      if (toolName === 'read_files' && parametersXml.includes('<paths>')) {
        const pathsMatch = parametersXml.match(/<paths>(.*?)<\/paths>/s);
        if (pathsMatch) {
          const pathElements = pathsMatch[1].matchAll(/<path>(.*?)<\/path>/gs);
          parameters.paths = Array.from(pathElements).map((m) => ({ path: m[1].trim() }));
        }
      }

      return {
        toolName,
        parameters,
      };
    } catch {
      return null;
    }
  }

  /**
   * パラメータ値の型変換
   */
  private parseParameterValue(value: string): unknown {
    // 改行文字の復元
    value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

    // JSON形式の場合
    if (
      (value.startsWith('{') && value.endsWith('}')) ||
      (value.startsWith('[') && value.endsWith(']'))
    ) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    // 数値の場合
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    if (/^\d+\.\d+$/.test(value)) {
      return parseFloat(value);
    }

    // 真偽値の場合
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }

    // デフォルトは文字列
    return value;
  }

  /**
   * ツール呼び出しの権限チェック
   */
  async checkPermission(toolCall: ToolCallRequest): Promise<PermissionResult> {
    return this.permissionManager.checkPermission(toolCall);
  }

  /**
   * ツールを実行
   */
  async executeTool(
    toolCall: ToolCallRequest,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.getTool(toolCall.toolName);

    if (!tool) {
      return {
        success: false,
        error: `未知のツール: ${toolCall.toolName}`,
      };
    }

    // パラメータ検証
    if (!tool.validateParameters(toolCall.parameters)) {
      return {
        success: false,
        error: `ツール '${toolCall.toolName}' のパラメータが無効です`,
      };
    }

    try {
      // BaseTool.executeは追加のcontextパラメータを受け取る
      if ('execute' in tool && typeof tool.execute === 'function') {
        return await (tool as any).execute(toolCall.parameters, context);
      }
      return await tool.execute(toolCall.parameters);
    } catch (error) {
      return {
        success: false,
        error: `ツール実行エラー: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 権限マネージャーを取得
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }
}
