/**
 * 便携式前端 AI Agent 入口
 * 能力限制：仅支持「页面问答」与「路由跳转」。
 */
'use strict';

const globalObject = typeof window !== 'undefined' ? window : globalThis;

const MAX_MESSAGE_LENGTH = 2000;
const ALLOWED_ACTIONS = new Set(['navigate']);
const FORBIDDEN_INPUT_PATTERNS = [/<script/i, /javascript:/i, /on\w+\s*=\s*/i];
const MOBILE_BREAKPOINT = 640;
const FLOATING_MARGIN = 20;
const FLOATING_MARGIN_MOBILE = 12;
const FLOATING_GAP = 12;
const WELCOME_PROMPTS = Object.freeze([
  {
    title: '快速了解当前页',
    description: '问我这个页面能做什么、核心入口在哪里。',
    prompt: '这个页面支持哪些操作？',
  },
  {
    title: '直接找目标页面',
    description: '告诉我你想去哪里，我来帮你导航。',
    prompt: '带我去相关的配置页面',
  },
  {
    title: '梳理下一步操作',
    description: '适合第一次使用页面时快速上手。',
    prompt: '告诉我接下来应该怎么操作',
  },
]);

export const defaultConfig = {
  backendUrl: 'http://localhost:4096/api',
  routerPush: null,
  requestTimeoutMs: null,
  chatPath: '/chat',
  streamPath: '/chat/stream',
  stream: true,
  mode: 'auto',
  sessionId: null,
  headers: {},
  debug: true,
};

let config = { ...defaultConfig };

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function sanitizeText(value, maxLength = 240) {
  if (value == null || typeof value === 'object') return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, '&#96;');
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function createHTMLToken(stash, prefix, html) {
  const token = `\u001f${prefix}${stash.length}\u001f`;
  stash.push(html);
  return token;
}

function restoreHTMLTokens(source, stash, prefix) {
  return String(source ?? '').replace(new RegExp(`\\u001f${prefix}(\\d+)\\u001f`, 'g'), (_, index) => stash[Number(index)] || '');
}

function sanitizeHref(value) {
  const href = decodeEntities(value).trim();
  if (!href) return '';
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^(\/(?!\/)|#|\?)/.test(href)) return href;
  return '';
}

function renderInlineMarkdown(text) {
  const stash = [];
  let source = String(text ?? '');

  source = source.replace(/`([^`\n]+)`/g, (_, code) => createHTMLToken(stash, 'INLINE', `<code>${escapeHTML(code)}</code>`));
  source = escapeHTML(source);

  source = source.replace(/\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (_, label, rawHref) => {
    const href = sanitizeHref(String(rawHref).replace(/\s+"[^"]*"$/, ''));
    if (!href) return label;
    const isExternal = /^(https?:|mailto:|tel:)/i.test(href);
    const attrs = isExternal ? ' target="_blank" rel="noreferrer noopener"' : '';
    return createHTMLToken(
      stash,
      'INLINE',
      `<a href="${escapeAttribute(href)}"${attrs}>${label}</a>`
    );
  });

  source = source.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  source = source.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  source = source.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  return restoreHTMLTokens(source, stash, 'INLINE');
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function splitMarkdownTableRow(line) {
  return String(line ?? '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownBlockStart(line, nextLine = '') {
  if (!line || !line.trim()) return true;
  if (/^\s*\u001fBLOCK\d+\u001f\s*$/.test(line)) return true;
  if (/^\s*(#{1,6})\s+/.test(line)) return true;
  if (/^\s*>\s?/.test(line)) return true;
  if (/^\s*[-*+]\s+/.test(line)) return true;
  if (/^\s*\d+\.\s+/.test(line)) return true;
  if (/\|/.test(line) && isMarkdownTableSeparator(nextLine)) return true;
  return false;
}

function renderMarkdownTable(headerLine, bodyLines) {
  const rows = [headerLine, ...bodyLines].map(splitMarkdownTableRow);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const normalized = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] || ''));
  const [headers, ...body] = normalized;
  const thead = `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`;
  const tbody = body.length
    ? `<tbody>${body
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
    : '';
  return `<div class="ai-agent-table-wrap"><table>${thead}${tbody}</table></div>`;
}

function renderMarkdown(text) {
  const sourceText = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!sourceText) return '<p></p>';

  const blockStash = [];
  const source = sourceText.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, language = '', code = '') =>
    createHTMLToken(
      blockStash,
      'BLOCK',
      `<pre class="ai-agent-code"><code${language ? ` data-lang="${escapeAttribute(language)}"` : ''}>${escapeHTML(
        String(code).replace(/\n$/, '')
      )}</code></pre>`
    )
  );

  const lines = source.split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const blockMatch = trimmed.match(/^\u001fBLOCK(\d+)\u001f$/);
    if (blockMatch) {
      blocks.push(blockStash[Number(blockMatch[1])] || '');
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    if (index + 1 < lines.length && /\|/.test(line) && isMarkdownTableSeparator(lines[index + 1])) {
      const headerLine = line;
      index += 2;
      const bodyLines = [];
      while (index < lines.length && lines[index].trim() && /\|/.test(lines[index])) {
        bodyLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderMarkdownTable(headerLine, bodyLines));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const currentLine = lines[index];
      const nextLine = index + 1 < lines.length ? lines[index + 1] : '';
      if (!currentLine.trim() || isMarkdownBlockStart(currentLine, nextLine)) {
        break;
      }
      paragraphLines.push(currentLine.trim());
      index += 1;
    }

    if (!paragraphLines.length) {
      paragraphLines.push(line.trim());
      index += 1;
    }

    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }

  return blocks.join('');
}

function buildMessageBody(content, role) {
  const body = document.createElement('div');
  body.className = 'ai-agent-msg-content';
  if (role === 'assistant') {
    body.innerHTML = renderMarkdown(content);
  } else {
    body.textContent = content;
  }
  return body;
}

function isDebugEnabled() {
  return config?.debug !== false;
}

function logAgent(level, message, details) {
  if (!isDebugEnabled() || typeof console === 'undefined') return;
  const logger = typeof console[level] === 'function' ? console[level] : console.log;
  const prefix = `[AIAgent] ${message}`;
  if (details === undefined) {
    logger.call(console, prefix);
    return;
  }
  logger.call(console, prefix, details);
}

function normalizeConfig(opts = {}) {
  const next = { ...defaultConfig, ...opts };

  if (typeof opts.backendUrl !== 'string' && typeof opts.apiBase === 'string') {
    next.backendUrl = opts.apiBase;
  }

  if (typeof opts.routerPush !== 'function' && opts.router && typeof opts.router.push === 'function') {
    next.routerPush = (route) => opts.router.push(route);
  }

  if (typeof next.backendUrl !== 'string' || next.backendUrl.trim() === '') {
    next.backendUrl = defaultConfig.backendUrl;
  }
  next.backendUrl = next.backendUrl.trim();

  if (!['auto', 'crewai', 'opencode'].includes(next.mode)) {
    next.mode = 'auto';
  }

  if (next.requestTimeoutMs == null) {
    next.requestTimeoutMs = defaultConfig.requestTimeoutMs;
  } else if (typeof next.requestTimeoutMs !== 'number' || Number.isNaN(next.requestTimeoutMs) || next.requestTimeoutMs <= 0) {
    next.requestTimeoutMs = null;
  }

  if (typeof next.chatPath !== 'string' || next.chatPath.trim() === '') {
    next.chatPath = defaultConfig.chatPath;
  }
  if (!next.chatPath.startsWith('/')) {
    next.chatPath = `/${next.chatPath}`;
  }

  if (typeof next.stream !== 'boolean') {
    next.stream = defaultConfig.stream;
  }

  if (typeof next.streamPath !== 'string' || next.streamPath.trim() === '') {
    next.streamPath = defaultConfig.streamPath;
  }
  if (!next.streamPath.startsWith('/')) {
    next.streamPath = `/${next.streamPath}`;
  }

  if (!isPlainObject(next.headers)) {
    next.headers = {};
  }

  if (typeof next.debug !== 'boolean') {
    next.debug = defaultConfig.debug;
  }

  if (typeof next.sessionId === 'string') {
    next.sessionId = next.sessionId.trim() || null;
  } else if (next.sessionId == null) {
    next.sessionId = null;
  } else {
    next.sessionId = String(next.sessionId);
  }

  return next;
}

function validateInput(text) {
  if (typeof text !== 'string') return { valid: false, error: '消息必须是字符串' };

  const normalized = text.trim();
  if (!normalized) return { valid: false, error: '消息不能为空' };

  if (normalized.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `消息长度不得超过 ${MAX_MESSAGE_LENGTH} 字符` };
  }

  if (FORBIDDEN_INPUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { valid: false, error: '消息包含不允许的内容' };
  }

  return { valid: true, text: normalized };
}

function isSafeRoute(route) {
  if (typeof route !== 'string') return false;
  const normalized = route.trim();

  if (!normalized.startsWith('/')) return false;
  if (normalized.startsWith('//')) return false;
  if (normalized.length > 300) return false;
  if (/\s/.test(normalized)) return false;
  if (/^(https?:|javascript:)/i.test(normalized)) return false;

  return true;
}

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractMessageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.content === 'string' && payload.content.trim()) {
    return payload.content.trim();
  }
  if (typeof payload.answer === 'string' && payload.answer.trim()) {
    return payload.answer.trim();
  }
  if (Array.isArray(payload.parts)) {
    const textPart = payload.parts.find((part) => part && typeof part.text === 'string' && part.text.trim());
    if (textPart) return textPart.text.trim();
  }

  return '';
}

function extractJsonCandidateFromText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const direct = tryParseJSON(trimmed);
  if (direct && typeof direct === 'object') return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryParseJSON(fenced[1].trim());
    if (parsed && typeof parsed === 'object') return parsed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const maybeJson = trimmed.slice(start, end + 1);
    const parsed = tryParseJSON(maybeJson);
    if (parsed && typeof parsed === 'object') return parsed;
  }

  return null;
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const action = raw.action;
  if (!ALLOWED_ACTIONS.has(action)) return null;

  const params = isPlainObject(raw.params) ? raw.params : {};
  const route =
    typeof params.route === 'string'
      ? params.route
      : typeof params.path === 'string'
      ? params.path
      : typeof raw.route === 'string'
      ? raw.route
      : raw.path;

  if (!isSafeRoute(route)) return null;

  return {
    action: 'navigate',
    params: { route: route.trim() },
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

function parseActionFromPayload(payload) {
  const direct = normalizeAction(payload);
  if (direct) return direct;

  const message = extractMessageFromPayload(payload);
  const candidate = extractJsonCandidateFromText(message);
  return normalizeAction(candidate);
}

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

function withTimeout(timeoutMs) {
  if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: undefined,
      cleanup: () => {},
      hasTimeout: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
    hasTimeout: true,
  };
}

async function postJSON(url, body) {
  const { signal, cleanup, hasTimeout } = withTimeout(config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(body),
      signal,
    });

    const rawText = await response.text();
    const parsed = tryParseJSON(rawText);
    const payload = parsed ?? { message: rawText };

    if (!response.ok) {
      throw new HttpError(`请求失败（${response.status}）`, response.status, payload);
    }

    return payload;
  } catch (error) {
    if (hasTimeout && error.name === 'AbortError') {
      throw new Error(`请求超时（${config.requestTimeoutMs}ms）`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

function trimSlash(url) {
  return url.replace(/\/+$/, '');
}

function resolveCurrentPathname() {
  try {
    const loc = globalObject.location;
    if (!loc) return '/';

    const hash = typeof loc.hash === 'string' ? loc.hash.trim() : '';
    if (hash) {
      let hashPath = '';
      if (hash.startsWith('#!/')) {
        hashPath = hash.slice(2);
      } else if (hash.startsWith('#/')) {
        hashPath = hash.slice(1);
      }
      if (hashPath.startsWith('/')) {
        const qIdx = hashPath.indexOf('?');
        const hIdx = hashPath.indexOf('#');
        const cutAt = [qIdx, hIdx].filter((value) => value >= 0).sort((a, b) => a - b)[0];
        return (cutAt >= 0 ? hashPath.slice(0, cutAt) : hashPath) || '/';
      }
    }

    const pathname = typeof loc.pathname === 'string' ? loc.pathname.trim() : '';
    return pathname || '/';
  } catch {
    return '/';
  }
}

function buildRequestContext() {
  const loc = globalObject.location || {};
  return {
    pathname: resolveCurrentPathname(),
    rawPathname: typeof loc.pathname === 'string' ? loc.pathname : '/',
    hash: typeof loc.hash === 'string' ? loc.hash : '',
    href: typeof loc.href === 'string' ? loc.href : '',
    title: typeof document !== 'undefined' ? sanitizeText(document.title, 200) : '',
  };
}

function parseSSEBlock(block) {
  if (typeof block !== 'string') return null;

  const lines = block.replace(/\r/g, '').split('\n');
  let eventName = 'message';
  const dataLines = [];

  lines.forEach((line) => {
    if (!line || line.startsWith(':')) return;

    const sepIndex = line.indexOf(':');
    const field = sepIndex >= 0 ? line.slice(0, sepIndex) : line;
    let value = sepIndex >= 0 ? line.slice(sepIndex + 1) : '';
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') {
      eventName = value || 'message';
    } else if (field === 'data') {
      dataLines.push(value);
    }
  });

  if (dataLines.length === 0) return null;

  const rawData = dataLines.join('\n');
  const parsed = tryParseJSON(rawData);
  return {
    event: eventName,
    data: parsed ?? rawData,
  };
}

async function consumeSSEStream(readableStream, onEvent) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r/g, '');
    let boundary = buffer.indexOf('\n\n');

    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSSEBlock(block);
      if (parsed) onEvent(parsed);
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  buffer = buffer.replace(/\r/g, '');
  if (buffer.trim()) {
    const parsed = parseSSEBlock(buffer);
    if (parsed) onEvent(parsed);
  }
}

async function postSSE(url, body, onEvent) {
  const { signal, cleanup, hasTimeout } = withTimeout(config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...config.headers,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const rawText = await response.text();
      const parsed = tryParseJSON(rawText);
      const payload = parsed ?? { message: rawText };
      throw new HttpError(`请求失败（${response.status}）`, response.status, payload);
    }

    if (!response.body) {
      throw new Error('浏览器不支持流式响应');
    }

    await consumeSSEStream(response.body, onEvent);
  } catch (error) {
    if (hasTimeout && error.name === 'AbortError') {
      throw new Error(`请求超时（${config.requestTimeoutMs}ms）`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

function updateSessionId(payload) {
  if (!payload || typeof payload !== 'object') return;
  config.sessionId = payload.sessionId || payload.session_id || config.sessionId;
}

async function sendToCrewAI(message) {
  const base = trimSlash(config.backendUrl);
  const url = `${base}${config.chatPath}`;

  const payload = await postJSON(url, {
    message,
    sessionId: config.sessionId || undefined,
    context: buildRequestContext(),
  });

  updateSessionId(payload);
  return { payload, transport: 'crewai' };
}

async function sendToCrewAIStream(message, handlers = {}) {
  const base = trimSlash(config.backendUrl);
  const url = `${base}${config.streamPath}`;

  let finalPayload = null;

  await postSSE(
    url,
    {
      message,
      sessionId: config.sessionId || undefined,
      context: buildRequestContext(),
    },
    ({ event, data }) => {
      const payload = data && typeof data === 'object' ? data : { message: String(data ?? '') };
      updateSessionId(payload);

      if (event === 'thinking') {
        if (typeof handlers.onThinking === 'function') handlers.onThinking(payload);
        return;
      }

      if (event === 'error') {
        if (typeof handlers.onStreamError === 'function') handlers.onStreamError(payload);
        return;
      }

      if (event === 'final') {
        const candidate = payload && payload.payload && typeof payload.payload === 'object' ? payload.payload : payload;
        finalPayload = candidate;
        updateSessionId(candidate);
        if (typeof handlers.onFinal === 'function') handlers.onFinal(candidate);
        return;
      }

      if (event === 'done') {
        if (typeof handlers.onDone === 'function') handlers.onDone(payload);
        return;
      }

      if (typeof handlers.onEvent === 'function') {
        handlers.onEvent({ event, payload });
      }
    }
  );

  if (!finalPayload) {
    throw new Error('后端流式返回缺少 final 事件');
  }

  return { payload: finalPayload, transport: 'crewai_sse' };
}

async function sendToOpenCode(message) {
  const base = trimSlash(config.backendUrl);

  if (!config.sessionId) {
    const sessionPayload = await postJSON(`${base}/session`, {});
    config.sessionId = sessionPayload?.id || sessionPayload?.sessionId || null;
    if (!config.sessionId) {
      throw new Error('后端未返回 sessionId');
    }
  }

  const payload = await postJSON(`${base}/session/${config.sessionId}/message`, {
    message,
    parts: [{ type: 'text', text: message }],
    context: buildRequestContext(),
  });

  updateSessionId(payload);
  return { payload, transport: 'opencode' };
}

function shouldFallbackToOpenCode(error) {
  return error instanceof HttpError && [404, 405].includes(error.status);
}

function shouldFallbackToNonStream(error) {
  if (error instanceof HttpError) {
    return [404, 405, 406, 415, 501].includes(error.status);
  }
  return false;
}

async function sendToBackend(message, streamHandlers = {}) {
  if (config.mode === 'crewai') {
    if (config.stream) {
      try {
        return await sendToCrewAIStream(message, streamHandlers);
      } catch (error) {
        if (shouldFallbackToNonStream(error)) {
          return sendToCrewAI(message);
        }
        throw error;
      }
    }
    return sendToCrewAI(message);
  }

  if (config.mode === 'opencode') {
    return sendToOpenCode(message);
  }

  try {
    if (config.stream) {
      try {
        return await sendToCrewAIStream(message, streamHandlers);
      } catch (error) {
        if (shouldFallbackToNonStream(error)) {
          try {
            return await sendToCrewAI(message);
          } catch (fallbackError) {
            if (shouldFallbackToOpenCode(fallbackError)) {
              return sendToOpenCode(message);
            }
            throw fallbackError;
          }
        }
        if (shouldFallbackToOpenCode(error)) {
          return sendToOpenCode(message);
        }
        throw error;
      }
    }
    return await sendToCrewAI(message);
  } catch (error) {
    if (!shouldFallbackToOpenCode(error)) {
      throw error;
    }
    return sendToOpenCode(message);
  }
}

async function createBackendSession() {
  const base = trimSlash(config.backendUrl);
  const payload = await postJSON(`${base}/session`, {});
  const sessionId = payload?.id || payload?.sessionId || payload?.session_id;
  if (!sessionId) {
    throw new Error('后端未返回 sessionId');
  }
  return String(sessionId);
}

function createLocalSessionId() {
  if (globalObject.crypto && typeof globalObject.crypto.randomUUID === 'function') {
    return globalObject.crypto.randomUUID();
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createFreshSessionId() {
  try {
    return await createBackendSession();
  } catch (error) {
    console.warn('[AIAgent] 后端新建 session 失败，回退到本地 sessionId:', error);
    return createLocalSessionId();
  }
}

function createStyles() {
  return `
    :host { all: initial; }

    .ai-agent-root {
      --ai-agent-text: #0f172a;
      --ai-agent-muted: #52637a;
      --ai-agent-border: rgba(148, 163, 184, 0.22);
      --ai-agent-accent: #2563eb;
      --ai-agent-accent-soft: rgba(37, 99, 235, 0.12);
      --ai-agent-teal: #0f766e;
      color: var(--ai-agent-text);
    }

    .ai-agent-root,
    .ai-agent-root * {
      box-sizing: border-box;
      font-family: "SF Pro Display", "Segoe UI Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }

    .ai-agent-root *:focus-visible {
      outline: 2px solid rgba(37, 99, 235, 0.36);
      outline-offset: 2px;
    }

    .ai-agent-panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: 432px;
      max-width: calc(100vw - 32px);
      height: min(680px, calc(100vh - 32px));
      max-height: calc(100vh - 32px);
      display: flex;
      flex-direction: column;
      border-radius: 30px;
      border: 1px solid rgba(255, 255, 255, 0.72);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.84) 0%, rgba(247, 250, 255, 0.96) 100%);
      box-shadow:
        0 28px 90px rgba(15, 23, 42, 0.18),
        0 12px 32px rgba(37, 99, 235, 0.1);
      overflow: hidden;
      z-index: 2147483647;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      animation: ai-agent-panel-enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .ai-agent-panel::before {
      content: "";
      position: absolute;
      inset: 0 0 auto 0;
      height: 200px;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.18), transparent 58%),
        radial-gradient(circle at top right, rgba(20, 184, 166, 0.16), transparent 42%);
      pointer-events: none;
    }

    .ai-agent-panel::after {
      content: "";
      position: absolute;
      inset: 12px;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.52);
      pointer-events: none;
    }

    .ai-agent-panel.hidden { display: none; }

    .ai-agent-header {
      position: relative;
      z-index: 1;
      padding: 18px 20px 14px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .ai-agent-header-title {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 0;
      line-height: 44px;
    }

    .ai-agent-brand-mark {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.16em;
      color: #ffffff;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #14b8a6 100%);
      box-shadow: 0 14px 30px rgba(29, 78, 216, 0.26);
    }

    .ai-agent-brand-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-top: 2px;
    }

    .ai-agent-brand-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .ai-agent-brand-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ai-agent-text);
    }

    .ai-agent-header-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid rgba(15, 118, 110, 0.12);
      background: rgba(15, 118, 110, 0.09);
      font-size: 11px;
      font-weight: 600;
      color: var(--ai-agent-teal);
    }

    .ai-agent-header-status::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #14b8a6;
      box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.12);
    }

    .ai-agent-brand-subtitle {
      max-width: 260px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--ai-agent-muted);
    }

    .ai-agent-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .ai-agent-header-btn,
    .ai-agent-close {
      border: 1px solid rgba(148, 163, 184, 0.16);
      color: var(--ai-agent-text);
      cursor: pointer;
      background: rgba(255, 255, 255, 0.6);
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      transition:
        transform 160ms ease,
        background-color 160ms ease,
        box-shadow 160ms ease;
    }

    .ai-agent-header-btn {
      border-radius: 14px;
      padding: 10px 14px;
      font-size: 12px;
      line-height: 1;
      font-weight: 600;
    }

    .ai-agent-close {
      width: 36px;
      height: 36px;
      border-radius: 14px;
      font-size: 20px;
      line-height: 1;
      display: grid;
      place-items: center;
    }

    .ai-agent-header.dragging,
    .ai-agent-trigger.dragging { cursor: grabbing; }

    .ai-agent-header-btn:hover,
    .ai-agent-close:hover {
      background: rgba(255, 255, 255, 0.92);
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.1);
    }

    .ai-agent-header-btn:disabled,
    .ai-agent-close:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .ai-agent-messages {
      position: relative;
      z-index: 1;
      flex: 1;
      padding: 18px 18px;
      overflow-y: auto;
      overscroll-behavior: contain;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 34%),
        radial-gradient(circle at top right, rgba(20, 184, 166, 0.08), transparent 30%),
        linear-gradient(180deg, rgba(245, 249, 255, 0.78) 0%, rgba(255, 255, 255, 0.96) 34%, #ffffff 100%);
    }

    .ai-agent-messages::-webkit-scrollbar {
      width: 10px;
    }

    .ai-agent-messages::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.34);
      border: 2px solid transparent;
      background-clip: padding-box;
    }

    .ai-agent-welcome {
      flex: 0 0 auto;
      align-self: stretch;
      position: relative;
      overflow: hidden;
      padding: 16px;
      margin-bottom: 4px;
      border-radius: 24px;
      border: 1px solid rgba(191, 219, 254, 0.56);
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(239, 246, 255, 0.86));
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.08);
    }

    .ai-agent-welcome::before {
      content: "";
      position: absolute;
      inset: -30% auto auto 55%;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(37, 99, 235, 0.18), transparent 70%);
      pointer-events: none;
    }

    .ai-agent-welcome-label {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.82);
      border: 1px solid rgba(191, 219, 254, 0.56);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #1d4ed8;
      text-transform: uppercase;
    }

    .ai-agent-welcome-title {
      position: relative;
      z-index: 1;
      margin: 14px 0 8px;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: -0.04em;
      color: var(--ai-agent-text);
    }

    .ai-agent-welcome-desc {
      position: relative;
      z-index: 1;
      margin: 0;
      font-size: 13px;
      line-height: 1.7;
      color: var(--ai-agent-muted);
    }

    .ai-agent-welcome-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 18px;
    }

    .ai-agent-suggestion {
      width: 100%;
      padding: 14px;
      border: 1px solid rgba(191, 219, 254, 0.48);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.78);
      text-align: left;
      cursor: pointer;
      color: inherit;
      transition:
        transform 160ms ease,
        border-color 160ms ease,
        background-color 160ms ease,
        box-shadow 160ms ease;
    }

    .ai-agent-suggestion:hover {
      transform: translateY(-2px);
      border-color: rgba(96, 165, 250, 0.68);
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 16px 34px rgba(37, 99, 235, 0.12);
    }

    .ai-agent-suggestion strong {
      display: block;
      margin-bottom: 6px;
      font-size: 14px;
      font-weight: 700;
      color: var(--ai-agent-text);
    }

    .ai-agent-suggestion span {
      display: block;
      font-size: 12px;
      line-height: 1.6;
      color: var(--ai-agent-muted);
    }

    .ai-agent-msg {
      flex: 0 0 auto;
      position: relative;
      max-width: 88%;
      padding: 14px 16px;
      border-radius: 22px;
      font-size: 13px;
      line-height: 1.65;
      word-break: break-word;
      overflow-wrap: anywhere;
      color: var(--ai-agent-text);
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
    }

    .ai-agent-msg.plain .ai-agent-msg-content { white-space: pre-wrap; }

    .ai-agent-msg-content {
      min-width: 0;
      color: inherit;
    }

    .ai-agent-msg-content > :first-child { margin-top: 0; }
    .ai-agent-msg-content > :last-child { margin-bottom: 0; }

    .ai-agent-msg-content p,
    .ai-agent-msg-content ul,
    .ai-agent-msg-content ol,
    .ai-agent-msg-content blockquote,
    .ai-agent-msg-content pre,
    .ai-agent-msg-content table,
    .ai-agent-msg-content h1,
    .ai-agent-msg-content h2,
    .ai-agent-msg-content h3,
    .ai-agent-msg-content h4,
    .ai-agent-msg-content h5,
    .ai-agent-msg-content h6 {
      margin: 0 0 10px;
    }

    .ai-agent-msg-content h1,
    .ai-agent-msg-content h2,
    .ai-agent-msg-content h3,
    .ai-agent-msg-content h4,
    .ai-agent-msg-content h5,
    .ai-agent-msg-content h6 {
      line-height: 1.32;
      color: inherit;
    }

    .ai-agent-msg-content h1 { font-size: 18px; }
    .ai-agent-msg-content h2 { font-size: 16px; }
    .ai-agent-msg-content h3 { font-size: 15px; }
    .ai-agent-msg-content h4,
    .ai-agent-msg-content h5,
    .ai-agent-msg-content h6 { font-size: 14px; }

    .ai-agent-msg-content ul,
    .ai-agent-msg-content ol {
      padding-left: 18px;
    }

    .ai-agent-msg-content li + li {
      margin-top: 4px;
    }

    .ai-agent-msg-content a {
      color: #1d4ed8;
      text-decoration: underline;
      text-decoration-color: rgba(29, 78, 216, 0.28);
      text-underline-offset: 3px;
    }

    .ai-agent-msg.user .ai-agent-msg-content a {
      color: #dbeafe;
      text-decoration-color: rgba(219, 234, 254, 0.32);
    }

    .ai-agent-msg-content code {
      padding: 2px 6px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.06);
      font-size: 12px;
      font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
    }

    .ai-agent-msg.user .ai-agent-msg-content code {
      background: rgba(255, 255, 255, 0.16);
    }

    .ai-agent-code {
      margin: 0 0 10px;
      padding: 12px 14px;
      border-radius: 16px;
      background: linear-gradient(180deg, #0f172a, #172554);
      color: #eff6ff;
      overflow-x: auto;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    .ai-agent-code code {
      display: block;
      padding: 0;
      background: transparent;
      color: inherit;
      font-size: 12px;
      line-height: 1.7;
      white-space: pre;
    }

    .ai-agent-msg-content blockquote {
      padding: 10px 12px;
      border-left: 3px solid rgba(37, 99, 235, 0.56);
      background: rgba(37, 99, 235, 0.08);
      border-radius: 0 12px 12px 0;
    }

    .ai-agent-table-wrap {
      overflow-x: auto;
      margin-bottom: 10px;
    }

    .ai-agent-msg-content table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      overflow: hidden;
      border-radius: 14px;
    }

    .ai-agent-msg-content th,
    .ai-agent-msg-content td {
      padding: 8px 10px;
      border: 1px solid rgba(191, 219, 254, 0.56);
      text-align: left;
      vertical-align: top;
    }

    .ai-agent-msg-content th {
      background: rgba(219, 234, 254, 0.76);
      font-weight: 600;
    }

    .ai-agent-msg.user {
      align-self: flex-end;
      color: #ffffff;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #2563eb 100%);
      border-bottom-right-radius: 10px;
      box-shadow: 0 18px 40px rgba(29, 78, 216, 0.24);
    }

    .ai-agent-msg.assistant {
      align-self: flex-start;
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(226, 232, 240, 0.92);
      border-bottom-left-radius: 10px;
    }

    .ai-agent-msg.thinking {
      width: 100%;
      max-width: 100%;
      padding: 0;
      background: transparent;
      box-shadow: none;
      border-radius: 20px;
    }

    .ai-agent-thinking {
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid rgba(191, 219, 254, 0.56);
      background: linear-gradient(180deg, rgba(239, 246, 255, 0.84), rgba(255, 255, 255, 0.92));
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
    }

    .ai-agent-thinking summary {
      list-style: none;
      cursor: pointer;
      padding: 12px 14px;
      font-size: 12px;
      font-weight: 700;
      color: #1d4ed8;
      background: rgba(219, 234, 254, 0.58);
    }

    .ai-agent-thinking summary::-webkit-details-marker { display: none; }

    .ai-agent-thinking-body {
      display: block;
      padding: 10px 14px 14px;
      font-size: 12px;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
      border-radiu: 20px;
    }

    .ai-agent-thinking-body.warn {
      color: #b91c1c;
    }

    .ai-agent-msg.error {
      align-self: flex-start;
      color: #991b1b;
      background: rgba(254, 242, 242, 0.98);
      border: 1px solid rgba(252, 165, 165, 0.45);
    }

    .ai-agent-input-wrap {
      position: relative;
      z-index: 1;
      padding: 14px 18px 18px;
      border-top: 1px solid rgba(226, 232, 240, 0.78);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(248, 250, 252, 0.94) 24%, rgba(255, 255, 255, 0.98) 100%);
    }

    .ai-agent-input-shell {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.88);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.86),
        0 12px 30px rgba(15, 23, 42, 0.06);
    }

    .ai-agent-input {
      flex: 1;
      min-width: 0;
      border: none;
      appearance: none;
      background: transparent;
      padding: 12px 14px;
      font-size: 14px;
      color: var(--ai-agent-text);
      outline: none;
    }

    .ai-agent-input:focus,
    .ai-agent-input:focus-visible {
      outline: none;
      box-shadow: none;
    }

    .ai-agent-input::placeholder {
      color: rgba(82, 99, 122, 0.82);
    }

    .ai-agent-send {
      border: none;
      min-width: 74px;
      height: 44px;
      padding: 0 18px;
      border-radius: 14px;
      font-size: 13px;
      font-weight: 700;
      color: #ffffff;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 55%, #0ea5e9 100%);
      box-shadow: 0 14px 30px rgba(29, 78, 216, 0.26);
      cursor: pointer;
      transition:
        transform 160ms ease,
        box-shadow 160ms ease,
        opacity 160ms ease;
    }

    .ai-agent-send:hover {
      transform: translateY(-1px);
      box-shadow: 0 18px 34px rgba(29, 78, 216, 0.3);
    }

    .ai-agent-send:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .ai-agent-input-tip {
      margin-top: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--ai-agent-muted);
    }

    .ai-agent-input-tip::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.56);
    }

    .ai-agent-trigger {
      position: fixed;
      right: 20px;
      bottom: 20px;
      min-width: 64px;
      height: 64px;
      padding: 8px 12px 8px 10px;
      border: none;
      border-radius: 999px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #ffffff;
      cursor: pointer;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #14b8a6 100%);
      box-shadow:
        0 26px 50px rgba(15, 23, 42, 0.24),
        0 10px 18px rgba(29, 78, 216, 0.24);
      z-index: 2147483646;
      touch-action: none;
      user-select: none;
      transition:
        transform 160ms ease,
        box-shadow 160ms ease;
    }

    .ai-agent-trigger:hover {
      transform: translateY(-1px);
      box-shadow:
        0 30px 56px rgba(15, 23, 42, 0.28),
        0 14px 24px rgba(29, 78, 216, 0.28);
    }

    .ai-agent-trigger-mark {
      width: 46px;
      height: 46px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.16em;
    }

    .ai-agent-trigger-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
    }

    .ai-agent-trigger-title {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .ai-agent-trigger-subtitle {
      margin-top: 4px;
      font-size: 11px;
      line-height: 1;
      opacity: 0.82;
    }

    .ai-agent-trigger.hidden { display: none; }

    @keyframes ai-agent-panel-enter {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.98);
      }

      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 640px) {
      .ai-agent-panel {
        left: 12px;
        right: 12px;
        bottom: 12px;
        width: auto;
        max-width: none;
        height: min(78vh, 620px);
        border-radius: 24px;
      }

      .ai-agent-panel::after {
        inset: 8px;
        border-radius: 18px;
      }

      .ai-agent-header {
        padding: 16px 16px 12px;
      }

      .ai-agent-brand-subtitle {
        max-width: 200px;
      }

      .ai-agent-messages {
        padding: 14px 14px;
      }

      .ai-agent-welcome-title {
        font-size: 22px;
      }

      .ai-agent-msg {
        max-width: 92%;
      }

      .ai-agent-input-wrap {
        padding: 12px 14px 14px;
      }

      .ai-agent-trigger {
        right: 12px;
        bottom: 12px;
        min-width: 58px;
        width: 58px;
        height: 58px;
        padding: 0;
        justify-content: center;
      }

      .ai-agent-trigger-mark {
        width: 40px;
        height: 40px;
      }

      .ai-agent-trigger-copy {
        display: none;
      }
    }
  `;
}

function createWidgetHTML() {
  return `
    <div class="ai-agent-root">
      <div class="ai-agent-panel hidden" data-role="panel">
        <div class="ai-agent-header">
          <div class="ai-agent-header-title">
            <div class="ai-agent-brand-mark">AI</div>
            <div class="ai-agent-brand-copy">
              <div class="ai-agent-brand-row">
                <span class="ai-agent-brand-title">页面助手</span>
              </div>
            </div>
          </div>
          <div class="ai-agent-header-actions">
            <button class="ai-agent-header-btn" data-role="new-session" type="button">新对话</button>
            <button class="ai-agent-close" type="button" aria-label="关闭">&times;</button>
          </div>
        </div>
        <div class="ai-agent-messages" data-role="messages"></div>
        <div class="ai-agent-input-wrap">
          <div class="ai-agent-input-shell">
            <input class="ai-agent-input" data-role="input" type="text" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="问我这个页面怎么用，或直接说你想去哪里" />
            <button class="ai-agent-send" data-role="send" type="button">发送</button>
          </div>
        </div>
      </div>
      <button class="ai-agent-trigger" data-role="trigger" type="button" aria-label="打开聊天">
        <span class="ai-agent-trigger-mark">AI</span>
      </button>
    </div>
  `;
}

let hostEl;
let shadowRoot;
let panelEl;
let messagesEl;
let inputEl;
let sendBtn;
let triggerBtn;
let newSessionBtn;
let headerEl;
let closeBtn;
let widgetPosition = {
  trigger: null,
  panel: null,
};
let hasCustomPanelPosition = false;
let dragState = null;
let suppressTriggerClick = false;
const DRAG_EVENT_CAPTURE = true;
const ISOLATED_PANEL_EVENT_TYPES = Object.freeze([
  'beforeinput',
  'change',
  'click',
  'compositionend',
  'compositionstart',
  'compositionupdate',
  'contextmenu',
  'copy',
  'cut',
  'dblclick',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keypress',
  'keyup',
  'mousedown',
  'mouseup',
  'paste',
  'pointerdown',
  'pointermove',
  'pointerup',
  'touchend',
  'touchstart',
  'wheel',
]);
const ISOLATED_TRIGGER_EVENT_TYPES = Object.freeze([
  'click',
  'focusin',
  'focusout',
  'keydown',
  'keypress',
  'keyup',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerup',
  'touchend',
  'touchstart',
]);

function stopWidgetEventPropagation(event) {
  event.stopPropagation();
}

function isolateWidgetEvents(element, eventTypes) {
  if (!element) return;
  eventTypes.forEach((type) => {
    element.addEventListener(type, stopWidgetEventPropagation);
  });
}

function scrollMessagesToBottom() {
  if (!messagesEl) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(text, role) {
  if (!messagesEl || typeof document === 'undefined') return;

  const content = sanitizeText(text, 8000) || '';
  const msg = document.createElement('div');
  const useMarkdown = role === 'assistant';
  msg.className = `ai-agent-msg ${role} ${useMarkdown ? 'markdown' : 'plain'}`;
  msg.appendChild(buildMessageBody(content, role));
  messagesEl.appendChild(msg);
  scrollMessagesToBottom();
}

function createWelcomeMarkup() {
  const promptCards = WELCOME_PROMPTS.map(
    ({ title, description, prompt }) => `
      <button class="ai-agent-suggestion" type="button" data-prompt="${escapeAttribute(prompt)}">
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(description)}</span>
      </button>
    `
  ).join('');

  return `
    <div class="ai-agent-welcome-label">AI Copilot</div>
    <h2 class="ai-agent-welcome-title">把页面问题直接说出来</h2>
    <p class="ai-agent-welcome-desc">无论你是想问当前页怎么操作、查找某个入口，还是直接跳转到目标页面，都可以像和 AI 产品对话一样自然地输入。</p>
    <div class="ai-agent-welcome-grid">${promptCards}</div>
  `;
}

function appendWelcomeMessage() {
  if (!messagesEl || typeof document === 'undefined') return;

  const welcome = document.createElement('section');
  welcome.className = 'ai-agent-welcome';
  welcome.innerHTML = createWelcomeMarkup();
  messagesEl.appendChild(welcome);
  scrollMessagesToBottom();
}

function handleMessagesAreaClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const promptButton = target.closest('[data-prompt]');
  if (!promptButton || !messagesEl?.contains(promptButton) || sendBtn?.disabled) return;

  const prompt = sanitizeText(promptButton.getAttribute('data-prompt'), 300);
  if (!prompt) return;

  if (inputEl) {
    inputEl.value = prompt;
    inputEl.focus();
  }

  processMessage(prompt).catch(() => {});
}

function clearMessages() {
  if (!messagesEl) return;
  messagesEl.textContent = '';
}

function resetConversationView() {
  clearMessages();
  appendWelcomeMessage();
}

function appendThinkingPanel() {
  if (!messagesEl || typeof document === 'undefined') {
    return {
      addLine() {},
      finish() {},
    };
  }

  const wrap = document.createElement('div');
  wrap.className = 'ai-agent-msg assistant thinking';

  const details = document.createElement('details');
  details.className = 'ai-agent-thinking';
  details.open = false;

  const summary = document.createElement('summary');
  summary.textContent = '思考过程';

  const body = document.createElement('div');
  body.className = 'ai-agent-thinking-body';

  details.appendChild(summary);
  details.appendChild(body);
  wrap.appendChild(details);
  messagesEl.appendChild(wrap);
  scrollMessagesToBottom();

  let combinedText = '';
  let lastStage = '';
  let lastTitle = '';

  function addLine(text, type = 'info', meta = {}) {
    if (!text || typeof text !== 'string') return;

    const nextText = text.trim();
    if (!nextText) return;

    const stage = typeof meta.stage === 'string' ? meta.stage.trim() : '';
    const title = typeof meta.title === 'string' ? meta.title.trim() : '';
    const sameGroup = combinedText && stage && stage === lastStage;
    const sameTitle = combinedText && title && title === lastTitle;

    if (combinedText === '模型处理中...' && lastStage === 'pending' && stage && stage !== 'pending') {
      combinedText = nextText;
    } else if (!combinedText) {
      combinedText = nextText;
    } else if (sameGroup || sameTitle) {
      combinedText += `\n${nextText}`;
    } else {
      combinedText += `\n\n${nextText}`;
    }

    body.className = `ai-agent-thinking-body ${type}`;
    body.textContent = combinedText;
    lastStage = stage || lastStage;
    lastTitle = title || lastTitle;
    scrollMessagesToBottom();
  }

  function finish() {
    summary.textContent = '思考过程';
  }

  return { addLine, finish };
}

function setPending(isPending) {
  if (sendBtn) sendBtn.disabled = isPending;
  if (inputEl) inputEl.disabled = isPending;
  if (newSessionBtn) newSessionBtn.disabled = isPending;
}

async function executeAction(actionObj) {
  if (!actionObj || typeof actionObj !== 'object') {
    return { ok: false, message: '无效动作' };
  }

  logAgent('info', 'Execute action request', actionObj);

  if (actionObj.action !== 'navigate') {
    return { ok: false, message: `不支持的动作：${String(actionObj.action || '')}` };
  }

  const route = actionObj.params?.route;
  if (!isSafeRoute(route)) {
    return { ok: false, message: '无效跳转地址' };
  }

  if (typeof config.routerPush === 'function') {
    config.routerPush(route);
  } else if (globalObject.location && typeof globalObject.location.assign === 'function') {
    globalObject.location.assign(route);
  } else {
    return { ok: false, message: '当前环境不支持路由跳转' };
  }

  logAgent('info', 'Navigate action executed', { route });
  return { ok: true, message: route };
}

function getActionExecutionMessage(action) {
  if (action.action === 'navigate') {
    return `正在跳转到 ${action.params.route}`;
  }
  return '正在执行操作...';
}

async function applyResolvedAction(action, backendMessage = '', options = {}) {
  const announce = options.announce !== false;
  const actionMessage = action.message || backendMessage || getActionExecutionMessage(action);

  if (announce) {
    appendMessage(actionMessage, 'assistant');
  }

  const execution = await executeAction(action);
  if (!execution.ok && announce) {
    appendMessage(execution.message || '动作执行失败', 'error');
  }

  return { action, execution };
}

async function processMessage(rawText, options = {}) {
  const validation = validateInput(rawText);
  if (!validation.valid) {
    appendMessage(validation.error, 'error');
    throw new Error(validation.error);
  }

  if (options.newSession) {
    await startNewSession({
      clearMessages: options.clearMessages !== false,
      openWidget: false,
      announce: false,
    });
  }

  const text = validation.text;

  if (options.clearInput !== false && inputEl) {
    inputEl.value = '';
  }

  appendMessage(text, 'user');
  setPending(true);
  const thinkingPanel = appendThinkingPanel();
  thinkingPanel.addLine('模型处理中...', 'info', { stage: 'pending', title: '处理中' });

  try {
    const { payload } = await sendToBackend(text, {
      onThinking(eventPayload) {
        const title = typeof eventPayload.title === 'string' ? eventPayload.title.trim() : '';
        const chunkText =
          typeof eventPayload.text === 'string'
            ? eventPayload.text.trim()
            : typeof eventPayload.chunk === 'string'
            ? eventPayload.chunk.trim()
            : '';
        const summary = typeof eventPayload.summary === 'string' ? eventPayload.summary.trim() : '';
        const body = chunkText || summary;
        const line = body ? [title, body].filter(Boolean).join('：') : title;
        thinkingPanel.addLine(line || '模型处理中...', 'info', {
          stage: typeof eventPayload.stage === 'string' ? eventPayload.stage : '',
          title,
        });
      },
      onStreamError(eventPayload) {
        const msg = extractMessageFromPayload(eventPayload) || '流式处理异常';
        thinkingPanel.addLine(msg, 'warn', { stage: 'stream_error', title: '流式异常' });
      },
    });

    thinkingPanel.finish();

    const action = parseActionFromPayload(payload);
    const backendMessage = extractMessageFromPayload(payload);

    if (!action) {
      appendMessage(backendMessage || '后端未返回可执行指令', 'assistant');
      return { action: null, payload };
    }

    const result = await applyResolvedAction(action, backendMessage);
    return { ...result, payload };
  } catch (error) {
    thinkingPanel.finish();
    appendMessage(`请求失败：${error.message || '网络错误'}`, 'error');
    throw error;
  } finally {
    setPending(false);
  }
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getFloatingMargin() {
  return (globalObject.innerWidth || 0) <= MOBILE_BREAKPOINT ? FLOATING_MARGIN_MOBILE : FLOATING_MARGIN;
}

function getViewportSize() {
  const width = globalObject.innerWidth || document.documentElement?.clientWidth || 0;
  const height = globalObject.innerHeight || document.documentElement?.clientHeight || 0;
  return { width, height };
}

function clampFloatingPosition(element, position) {
  const margin = getFloatingMargin();
  const viewport = getViewportSize();
  const width = element?.offsetWidth || 0;
  const height = element?.offsetHeight || 0;
  const maxX = Math.max(margin, viewport.width - width - margin);
  const maxY = Math.max(margin, viewport.height - height - margin);

  return {
    x: clamp(position?.x ?? margin, margin, maxX),
    y: clamp(position?.y ?? margin, margin, maxY),
  };
}

function applyFloatingPosition(element, position) {
  if (!element) return { x: 0, y: 0 };
  const next = clampFloatingPosition(element, position);
  element.style.left = `${next.x}px`;
  element.style.top = `${next.y}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  return next;
}

function getDefaultTriggerPosition() {
  const margin = getFloatingMargin();
  const viewport = getViewportSize();
  const width = triggerBtn?.offsetWidth || 56;
  const height = triggerBtn?.offsetHeight || 56;
  return {
    x: Math.max(margin, viewport.width - width - margin),
    y: Math.max(margin, viewport.height - height - margin),
  };
}

function getDefaultPanelPosition() {
  const margin = getFloatingMargin();
  const viewport = getViewportSize();
  const width = panelEl?.offsetWidth || Math.min(380, Math.max(0, viewport.width - margin * 2));
  const height = panelEl?.offsetHeight || 520;
  return {
    x: Math.max(margin, viewport.width - width - margin),
    y: Math.max(margin, viewport.height - height - margin),
  };
}

function getAnchoredPanelPosition() {
  const margin = getFloatingMargin();
  const viewport = getViewportSize();
  const panelWidth = panelEl?.offsetWidth || 380;
  const panelHeight = panelEl?.offsetHeight || 520;
  const triggerWidth = triggerBtn?.offsetWidth || 56;
  const triggerHeight = triggerBtn?.offsetHeight || 56;
  const triggerPosition = widgetPosition.trigger || getDefaultTriggerPosition();

  let x = triggerPosition.x + triggerWidth - panelWidth;
  let y = triggerPosition.y - panelHeight - FLOATING_GAP;

  if (y < margin) {
    y = triggerPosition.y + triggerHeight + FLOATING_GAP;
  }

  return {
    x: clamp(x, margin, Math.max(margin, viewport.width - panelWidth - margin)),
    y: clamp(y, margin, Math.max(margin, viewport.height - panelHeight - margin)),
  };
}

function syncTriggerPosition() {
  if (!triggerBtn) return;
  widgetPosition.trigger = applyFloatingPosition(triggerBtn, widgetPosition.trigger || getDefaultTriggerPosition());
}

function syncPanelPosition(options = {}) {
  if (!panelEl) return;
  const alignToTrigger = options.alignToTrigger === true;
  const basePosition = hasCustomPanelPosition
    ? widgetPosition.panel || getDefaultPanelPosition()
    : alignToTrigger
    ? getAnchoredPanelPosition()
    : getDefaultPanelPosition();

  const next = applyFloatingPosition(panelEl, basePosition);
  if (hasCustomPanelPosition) {
    widgetPosition.panel = next;
  }
}

function syncFloatingLayout() {
  syncTriggerPosition();
  if (panelEl && !panelEl.classList.contains('hidden')) {
    syncPanelPosition({ alignToTrigger: !hasCustomPanelPosition });
  }
}

function stopDragging(pointerId) {
  if (!dragState) return;
  if (pointerId != null && dragState.pointerId !== pointerId) return;

  const { kind, handle, pointerId: activePointerId, moved } = dragState;
  handle?.classList.remove('dragging');
  handle?.releasePointerCapture?.(activePointerId);
  globalObject.removeEventListener('pointermove', handleDragMove, DRAG_EVENT_CAPTURE);
  globalObject.removeEventListener('pointerup', handleDragEnd, DRAG_EVENT_CAPTURE);
  globalObject.removeEventListener('pointercancel', handleDragEnd, DRAG_EVENT_CAPTURE);
  dragState = null;

  if (kind === 'trigger' && moved) {
    suppressTriggerClick = true;
    globalObject.setTimeout(() => {
      suppressTriggerClick = false;
    }, 0);
  }
}

function handleDragMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;
  if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) > 4) {
    dragState.moved = true;
  }

  const next = applyFloatingPosition(dragState.target, {
    x: dragState.origin.x + deltaX,
    y: dragState.origin.y + deltaY,
  });

  if (dragState.kind === 'trigger') {
    widgetPosition.trigger = next;
  } else {
    hasCustomPanelPosition = true;
    widgetPosition.panel = next;
  }
}

function handleDragEnd(event) {
  stopDragging(event.pointerId);
}

function startDragging(event, kind, target, handle) {
  if (!target || !handle) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();

  const origin =
    kind === 'trigger'
      ? widgetPosition.trigger || getDefaultTriggerPosition()
      : hasCustomPanelPosition
      ? widgetPosition.panel || getDefaultPanelPosition()
      : getAnchoredPanelPosition();

  dragState = {
    kind,
    target,
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin,
    moved: false,
  };

  handle.classList.add('dragging');
  handle.setPointerCapture?.(event.pointerId);
  globalObject.addEventListener('pointermove', handleDragMove, DRAG_EVENT_CAPTURE);
  globalObject.addEventListener('pointerup', handleDragEnd, DRAG_EVENT_CAPTURE);
  globalObject.addEventListener('pointercancel', handleDragEnd, DRAG_EVENT_CAPTURE);
}

function openWidget() {
  if (!panelEl || !triggerBtn) return;
  panelEl.classList.remove('hidden');
  syncPanelPosition({ alignToTrigger: !hasCustomPanelPosition });
  triggerBtn.classList.add('hidden');
  if (inputEl) inputEl.focus();
}

function closeWidget() {
  if (!panelEl || !triggerBtn) return;
  panelEl.classList.add('hidden');
  triggerBtn.classList.remove('hidden');
  syncTriggerPosition();
}

async function startNewSession(options = {}) {
  initWidget();

  const clearMessagesOnStart = options.clearMessages !== false;
  const announce = options.announce !== false;
  const openAfterCreate = options.openWidget !== false;
  const previousSessionId = config.sessionId;

  config.sessionId = await createFreshSessionId();

  if (clearMessagesOnStart) {
    resetConversationView();
  }

  if (openAfterCreate) {
    openWidget();
  }

  if (announce) {
    appendMessage('已开始新会话。', 'assistant');
  }

  return {
    sessionId: config.sessionId,
    previousSessionId,
  };
}

function initWidget() {
  if (hostEl || typeof document === 'undefined') return;

  hostEl = document.createElement('div');
  hostEl.className = 'ai-agent-widget-host';
  shadowRoot = hostEl.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = createStyles();

  const wrapperEl = document.createElement('div');
  wrapperEl.innerHTML = createWidgetHTML();

  shadowRoot.appendChild(styleEl);
  shadowRoot.appendChild(wrapperEl);
  document.body.appendChild(hostEl);

  panelEl = shadowRoot.querySelector('[data-role="panel"]');
  messagesEl = shadowRoot.querySelector('[data-role="messages"]');
  inputEl = shadowRoot.querySelector('[data-role="input"]');
  sendBtn = shadowRoot.querySelector('[data-role="send"]');
  triggerBtn = shadowRoot.querySelector('[data-role="trigger"]');
  newSessionBtn = shadowRoot.querySelector('[data-role="new-session"]');
  headerEl = shadowRoot.querySelector('.ai-agent-header');
  closeBtn = shadowRoot.querySelector('.ai-agent-close');

  // Keep widget interactions inside the shadow host so host apps do not react
  // to typing, clicks, or shortcuts triggered inside the agent UI.
  isolateWidgetEvents(panelEl, ISOLATED_PANEL_EVENT_TYPES);
  isolateWidgetEvents(triggerBtn, ISOLATED_TRIGGER_EVENT_TYPES);

  messagesEl.addEventListener('click', handleMessagesAreaClick);

  syncTriggerPosition();

  triggerBtn.addEventListener('pointerdown', (event) => {
    startDragging(event, 'trigger', triggerBtn, triggerBtn);
  });
  triggerBtn.addEventListener('click', (event) => {
    if (suppressTriggerClick) {
      event.preventDefault();
      suppressTriggerClick = false;
      return;
    }
    openWidget();
  });

  headerEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.ai-agent-header-actions')) return;
    startDragging(event, 'panel', panelEl, headerEl);
  });

  closeBtn.addEventListener('click', closeWidget);
  newSessionBtn.addEventListener('click', async () => {
    setPending(true);
    try {
      await startNewSession({ clearMessages: true, openWidget: true, announce: true });
    } catch (error) {
      appendMessage(`新建会话失败：${error.message || '未知错误'}`, 'error');
    } finally {
      setPending(false);
    }
  });

  sendBtn.addEventListener('click', () => {
    processMessage(inputEl.value).catch(() => {});
  });

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      processMessage(inputEl.value).catch(() => {});
    }
  });

  globalObject.addEventListener('resize', syncFloatingLayout);

  appendWelcomeMessage();
}

const AIAgent = {
  init(options = {}) {
    config = normalizeConfig(options);
    initWidget();
    return this;
  },

  async sendMessage(text, options = {}) {
    initWidget();
    openWidget();
    return processMessage(text, options);
  },

  async execute(payload, options = {}) {
    initWidget();
    if (options.openWidget) {
      openWidget();
    }

    const action = parseActionFromPayload(payload);
    if (!action) {
      throw new Error('未识别到可执行动作');
    }

    return applyResolvedAction(action, extractMessageFromPayload(payload), {
      announce: options.announce !== false,
    });
  },

  async startNewSession(options = {}) {
    return startNewSession(options);
  },

  resetSession(options = {}) {
    return this.startNewSession(options);
  },

  getSessionId() {
    return config.sessionId || null;
  },

  setSessionId(sessionId) {
    const normalized = sanitizeText(sessionId, 200);
    config.sessionId = normalized || null;
    return config.sessionId;
  },

  getConfig() {
    return { ...config };
  },
};

globalObject.AIAgent = AIAgent;

function getAutoInitConfig(script) {
  if (!script || !script.dataset) return null;

  const backendUrl = script.dataset.backendUrl || script.dataset.apiBase;
  if (!backendUrl) return null;

  const cfg = { backendUrl };
  if (script.dataset.mode) cfg.mode = script.dataset.mode;
  if (script.dataset.chatPath) cfg.chatPath = script.dataset.chatPath;
  if (script.dataset.streamPath) cfg.streamPath = script.dataset.streamPath;
  if (script.dataset.sessionId) cfg.sessionId = script.dataset.sessionId;
  if (typeof script.dataset.stream === 'string') cfg.stream = script.dataset.stream !== 'false';

  return cfg;
}

function tryAutoInit() {
  if (typeof document === 'undefined') return;

  const script = document.currentScript || document.querySelector('script[src*="agent-widget"]');
  if (script?.type === 'module') return;

  const autoConfig = getAutoInitConfig(script);
  if (autoConfig) {
    AIAgent.init(autoConfig);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryAutoInit, { once: true });
  } else {
    tryAutoInit();
  }
}

export { AIAgent };
export default AIAgent;
