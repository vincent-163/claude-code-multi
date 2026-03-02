#!/usr/bin/env node
'use strict';

const TOOL_NAME = 'set_session_title';

let stdinBuffer = Buffer.alloc(0);

function sendResponse(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function sendError(id, code, message) {
  if (id === undefined || id === null) {
    return;
  }
  sendResponse({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const id = message.id;
  const method = typeof message.method === 'string' ? message.method : '';
  const params = (message.params && typeof message.params === 'object') ? message.params : {};

  if (method === 'initialize') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cc-app-codex-title', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [{
          name: TOOL_NAME,
          description: 'Set a short descriptive session title (3-8 words). Optionally include a longer description.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short descriptive title for the session' },
              description: { type: 'string', description: 'Optional longer description for the session' },
            },
            required: ['title'],
          },
        }],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    if (toolName !== TOOL_NAME) {
      sendError(id, -32601, `Unknown tool: ${toolName || '(empty)'}`);
      return;
    }

    const args = (params.arguments && typeof params.arguments === 'object') ? params.arguments : {};
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) {
      sendError(id, -32602, 'title is required');
      return;
    }

    sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Title accepted: ${title}` }],
      },
    });
    return;
  }

  sendError(id, -32601, `Method '${method || '(empty)'}' not supported`);
}

process.stdin.on('data', (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);

  while (true) {
    const headerEnd = stdinBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      break;
    }

    const headerText = stdinBuffer.slice(0, headerEnd).toString('utf8');
    const match = headerText.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      stdinBuffer = stdinBuffer.slice(headerEnd + 4);
      continue;
    }

    const bodyLength = parseInt(match[1], 10);
    if (!Number.isFinite(bodyLength) || bodyLength < 0) {
      stdinBuffer = stdinBuffer.slice(headerEnd + 4);
      continue;
    }

    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + bodyLength;
    if (stdinBuffer.length < bodyEnd) {
      break;
    }

    const body = stdinBuffer.slice(bodyStart, bodyEnd).toString('utf8');
    stdinBuffer = stdinBuffer.slice(bodyEnd);

    try {
      const parsed = JSON.parse(body);
      handleMessage(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[codex-title-mcp] Failed to parse JSON: ${message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
