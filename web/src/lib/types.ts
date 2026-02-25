// --- Session ---

export type SessionStatus = 'starting' | 'ready' | 'busy' | 'waiting_for_input' | 'dead' | 'destroyed';

export interface Session {
  id: string;
  status: SessionStatus;
  created_at: number;
  last_active_at: number;
  working_directory?: string;
  pid?: number;
  cli_session_id?: string;
  total_cost_usd?: number;
  title?: string;
  description?: string;
  team_id?: string;
}

// --- Chat Messages ---

export interface ContentBlockText {
  type: 'text';
  text: string;
}

export interface ContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ContentBlockToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | ContentBlockToolResult;

export interface SystemMessage {
  kind: 'system';
  data: Record<string, unknown>;
}

export interface AssistantMessage {
  kind: 'assistant';
  content: ContentBlock[];
  streaming?: boolean;
}

export interface ResultMessage {
  kind: 'result';
  cost_usd?: number;
  total_cost_usd?: number;
  usage?: Record<string, number>;
  content?: ContentBlock[];
}

export interface StatusMessage {
  kind: 'status';
  status: SessionStatus;
}

export interface ErrorMessage {
  kind: 'error';
  message: string;
}

export interface ExitMessage {
  kind: 'exit';
  code?: number;
  signal?: string;
}

export interface ControlRequestMessage {
  kind: 'control_request';
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  blocked_path?: string;
}

export interface ControlResponseMessage {
  kind: 'control_response';
  request_id: string;
  approved: boolean;
}

export interface UserMessage {
  kind: 'user';
  content: string;
}

export interface ToolResultEvent {
  kind: 'tool_result_event';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface AskUserQuestionMessage {
  kind: 'ask_user_question';
  tool_use_id: string;
  questions: AskUserQuestionItem[];
}

export interface PlanModeExitMessage {
  kind: 'plan_mode_exit';
  tool_use_id: string;
  input: Record<string, unknown>;
}

export type ChatMessage =
  | SystemMessage
  | AssistantMessage
  | ResultMessage
  | StatusMessage
  | ErrorMessage
  | ExitMessage
  | ControlRequestMessage
  | ControlResponseMessage
  | UserMessage
  | ToolResultEvent
  | AskUserQuestionMessage
  | PlanModeExitMessage;

// --- SSE ---

export interface BufferedEvent {
  id: number;
  event: string;
  data: unknown;
  timestamp: number;
}

// --- Settings ---

export interface Settings {
  apiUrl: string;
  authToken: string;
  defaultModel: string;
  defaultWorkingDirectory: string;
}
