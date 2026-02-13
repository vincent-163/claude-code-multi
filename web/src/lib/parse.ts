import type { ChatMessage, BufferedEvent, ContentBlock } from './types';

/**
 * Parse a buffered SSE event into a ChatMessage (or null to skip).
 */
export function parseEvent(evt: BufferedEvent): ChatMessage | null {
  const { event, data } = evt;
  const d = data as Record<string, unknown>;

  if (event === 'status') {
    return { kind: 'status', status: d.status as ChatMessage['kind'] extends 'status' ? ChatMessage : never } as never;
  }

  if (event === 'exit') {
    return { kind: 'exit', code: d.code as number | undefined, signal: d.signal as string | undefined };
  }

  if (event === 'error') {
    return { kind: 'error', message: (d.message as string) || 'Unknown error' };
  }

  if (event === 'message') {
    return parseMessageEvent(d);
  }

  return null;
}

function parseMessageEvent(d: Record<string, unknown>): ChatMessage | null {
  const type = d.type as string;
  const subtype = d.subtype as string | undefined;

  if (type === 'system') {
    return { kind: 'system', data: d };
  }

  if (type === 'assistant') {
    const msg = d.message as Record<string, unknown> | undefined;
    const content = parseContentBlocks(msg?.content);
    return { kind: 'assistant', content, streaming: !!d.streaming };
  }

  if (type === 'result') {
    const result = d.result as Record<string, unknown> | undefined;
    return {
      kind: 'result',
      cost_usd: d.cost_usd as number | undefined,
      total_cost_usd: d.total_cost_usd as number | undefined,
      usage: d.usage as Record<string, number> | undefined,
      content: result ? parseContentBlocks(result.content) : undefined,
    };
  }

  if (type === 'control_request' && subtype === 'can_use_tool') {
    const req = d.request as Record<string, unknown> | undefined;
    return {
      kind: 'control_request',
      request_id: (d.request_id as string) || '',
      tool_name: (req?.tool_name as string) || '',
      input: (req?.input as Record<string, unknown>) || {},
      blocked_path: req?.blocked_path as string | undefined,
    };
  }

  if (type === 'control_response') {
    const response = d.response as Record<string, unknown> | undefined;
    const requestId = response?.request_id as string | undefined;
    const innerResponse = response?.response as Record<string, unknown> | undefined;
    const behavior = innerResponse?.behavior as string | undefined;
    if (requestId) {
      return {
        kind: 'control_response',
        request_id: requestId,
        approved: behavior === 'allow',
      };
    }
  }

  // raw / stderr / other message types — show as system
  if (type === 'raw' || type === 'stderr') {
    const text = typeof d.data === 'string' ? d.data : JSON.stringify(d.data);
    return { kind: 'system', data: { type, text } };
  }

  if (type === 'user') {
    return parseUserMessage(d);
  }

  return null;
}

function parseUserMessage(d: Record<string, unknown>): ChatMessage | null {
  const msg = d.message as Record<string, unknown> | undefined;
  if (!msg) return null;
  const contentRaw = msg.content;

  // content can be a plain string
  if (typeof contentRaw === 'string') {
    return { kind: 'user', content: contentRaw };
  }

  if (!Array.isArray(contentRaw) || contentRaw.length === 0) return null;
  const firstBlock = contentRaw[0] as Record<string, unknown>;

  // Tool result content block → pair with assistant message
  if (firstBlock.type === 'tool_result') {
    const toolUseId = (firstBlock.tool_use_id as string) || '';
    const contentEl = firstBlock.content;
    let content: string;
    if (typeof contentEl === 'string') {
      content = contentEl;
    } else if (Array.isArray(contentEl)) {
      content = contentEl
        .filter((el: Record<string, unknown>) => el.type === 'text')
        .map((el: Record<string, unknown>) => el.text as string)
        .join('\n');
    } else {
      content = contentEl != null ? JSON.stringify(contentEl) : '';
    }
    return {
      kind: 'tool_result_event',
      tool_use_id: toolUseId,
      content,
      is_error: !!firstBlock.is_error,
    };
  }

  // Regular user text message
  const textParts = contentRaw
    .filter((el: Record<string, unknown>) => el.type === 'text')
    .map((el: Record<string, unknown>) => (el.text as string) || '');
  if (textParts.length > 0) {
    return { kind: 'user', content: textParts.join('\n') };
  }

  return null;
}

function parseContentBlocks(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((block: Record<string, unknown>): ContentBlock | null => {
    if (block.type === 'text') {
      return { type: 'text', text: (block.text as string) || '' };
    }
    if (block.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: (block.id as string) || '',
        name: (block.name as string) || '',
        input: (block.input as Record<string, unknown>) || {},
      };
    }
    if (block.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: (block.tool_use_id as string) || '',
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        is_error: !!block.is_error,
      };
    }
    return null;
  }).filter((b): b is ContentBlock => b !== null);
}
