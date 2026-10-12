
# 03. 标准数据结构规范 (Canonical Schema)

## 1. 设计目标

为确保各 AI 助手会话互通时不丢失上下文、思考推理过程和代码修改历史，制定以下统一格式规范。

---

## 2. 数据结构定义 (TypeScript)

```typescript
/**
 * 标准工具调用项
 */
export interface CanonicalToolCall {
  id: string;
  name: string;                         // 工具名称，如 exec_command, Read, Write
  arguments: Record<string, unknown>;    // 调用参数
  output?: string;                      // 工具执行结果输出
  status?: 'success' | 'failed';        // 执行状态
}

/**
 * 标准对话消息单项
 */
export interface CanonicalMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: number;                    // 毫秒时间戳
  content: string;                      // 用户提问或助手纯文本回答（已清洗系统注入噪点）
  reasoning?: string;                   // 模型深度思考过程 (Thinking / Reasoning Content)
  toolCalls?: CanonicalToolCall[];      // 该轮回答包含的工具调用
}

/**
 * 标准会话结构体
 */
export interface CanonicalSession {
  schemaVersion: 1;
  id: string;                           // 统一会话 UUID
  title: string;                        // 会话标题
  createdAt: number;                    // 创建时间戳
  updatedAt: number;                    // 最后更新时间戳
  sourceAgent: 'codex' | 'workbuddy' | 'claude-code'; // 源 Agent
  
  /**
   * 项目关联信息（跨设备映射的核心依据）
   */
  project: {
    name: string;                       // 项目名称，如 "yikeda-admin"
    gitRemote?: string;                 // Git 远程仓库地址（跨设备唯一标识）
    gitBranch?: string;                 // 分支名
    originalCwd: string;                // 原始绝对路径（用于辅助推断）
  };

  /**
   * 消息历史数组（严格时间因果链序）
   */
  messages: CanonicalMessage[];
  
  /**
   * 扩展元数据（用于保留特定助手的专有配置）
   */
  metadata?: {
    model?: string;
    totalTokens?: number;
    tags?: string[];
  };
}
```

