
/**
 * 标准工具调用项
 */
export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  output?: string;
  status?: 'success' | 'failed';
}

/**
 * 标准对话消息单项
 */
export interface CanonicalMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: string;
  reasoning?: string;
  toolCalls?: CanonicalToolCall[];
}

/**
 * 标准会话结构体
 */
export interface CanonicalSession {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sourceAgent: 'codex' | 'workbuddy' | 'claude-code';
  project: {
    name: string;
    gitRemote?: string;
    gitBranch?: string;
    originalCwd: string;
  };
  messages: CanonicalMessage[];
  metadata?: {
    model?: string;
    totalTokens?: number;
    tags?: string[];
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  filePath: string;
}

