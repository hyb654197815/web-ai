#!/usr/bin/env node
/**
 * webGenerate
 *
 * This CLI only manages assistant skill installation/uninstallation.
 * Knowledge docs generation now happens inside assistant commands:
 * - /webGenerate ...   (Claude/OpenCode/Trae/Copilot/Gemini/Cursor/Antigravity)
 * - $webGenerate ...   (Codex)
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATE_ROOT = join(PROJECT_ROOT, 'templates', 'webGenerate');
const MANIFEST_DIR = '.webgenerate';
const PLATFORM_CONFIG_FILE = 'platform.json';
const VERSION = readVersion();

const MARKER = 'webGenerate';
const CLAUDE_FILE = 'CLAUDE.md';
const AGENTS_FILE = 'AGENTS.md';
const GEMINI_FILE = 'GEMINI.md';
const ANTIGRAVITY_RULE_FILE = join('.agents', 'rules', 'webGenerate.md');
const ANTIGRAVITY_WORKFLOW_FILE = join('.agents', 'workflows', 'webGenerate.md');
const COPILOT_INSTRUCTIONS_FILE = join('.github', 'copilot-instructions.md');
const CURSOR_RULE_FILE = join('.cursor', 'rules', 'webGenerate.mdc');
const SKILL_VERSION_FILE = '.webgenerate_version';

const PLATFORM_CONFIG = {
  claude: {
    label: 'Claude Code',
    template: 'skill-claude.md',
    skillDst: ['.claude', 'skills', 'webGenerate', 'SKILL.md'],
  },
  codex: {
    label: 'Codex',
    template: 'skill-codex.md',
    skillDst: ['.agents', 'skills', 'webGenerate', 'SKILL.md'],
    aliases: [['.agents', 'skills', 'webgenerate-alias', 'SKILL.md']],
  },
  opencode: {
    label: 'OpenCode',
    template: 'skill-opencode.md',
    skillDst: ['.config', 'opencode', 'skills', 'webGenerate', 'SKILL.md'],
  },
  'copilot-cli': {
    label: 'GitHub Copilot CLI',
    template: 'skill-opencode.md',
    skillDst: ['.copilot', 'skills', 'webGenerate', 'SKILL.md'],
    projectRules: [COPILOT_INSTRUCTIONS_FILE],
  },
  'vscode-copilot': {
    label: 'VS Code Copilot Chat',
    template: 'skill-opencode.md',
    skillDst: ['.vscode-copilot', 'skills', 'webGenerate', 'SKILL.md'],
    projectRules: [COPILOT_INSTRUCTIONS_FILE],
  },
  gemini: {
    label: 'Gemini CLI',
    template: 'skill-opencode.md',
    skillDst: ['.gemini', 'skills', 'webGenerate', 'SKILL.md'],
    projectRules: [GEMINI_FILE],
  },
  antigravity: {
    label: 'Google Antigravity',
    template: 'skill-opencode.md',
    skillDst: ['.antigravity', 'skills', 'webGenerate', 'SKILL.md'],
    projectRules: [ANTIGRAVITY_RULE_FILE, ANTIGRAVITY_WORKFLOW_FILE],
  },
  cursor: {
    label: 'Cursor',
    template: 'skill-opencode.md',
    skillDst: ['.cursor', 'skills', 'webGenerate', 'SKILL.md'],
    projectRules: [CURSOR_RULE_FILE],
  },
  trae: {
    label: 'Trae',
    template: 'skill-trae.md',
    skillDst: ['.trae', 'skills', 'webGenerate', 'SKILL.md'],
  },
  'trae-cn': {
    label: 'Trae CN',
    template: 'skill-trae.md',
    skillDst: ['.trae-cn', 'skills', 'webGenerate', 'SKILL.md'],
  },
};

const PLATFORM_ALIASES = {
  copilot: 'copilot-cli',
  'github-copilot': 'copilot-cli',
  'github-copilot-cli': 'copilot-cli',
  'copilot-chat': 'vscode-copilot',
  vscode: 'vscode-copilot',
  'vs-code-copilot': 'vscode-copilot',
  'gemini-cli': 'gemini',
  'google-antigravity': 'antigravity',
};

const KNOWLEDGE_DOC_CANDIDATES = [
  'webAIDocs/routes.md',
];

const REMINDER_TEXT = 'webGenerate: For page feature changes, read webAIDocs/routes.md and related page-xxx.md before editing code.';
const HOOK_FILE_CHECK = KNOWLEDGE_DOC_CANDIDATES.map((p) => `[ -f ${p} ]`).join(' || ');
const HOOK_ECHO_JSON = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"${REMINDER_TEXT}"}}'`;
const HOOK_COMMAND = `(${HOOK_FILE_CHECK}) && ${HOOK_ECHO_JSON} || true`;

const CLAUDE_HOOK = {
  matcher: 'Glob|Grep',
  hooks: [
    {
      type: 'command',
      command: HOOK_COMMAND,
    },
  ],
};

const CODEX_HOOK = {
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command: HOOK_COMMAND,
    },
  ],
};

const GEMINI_HOOK = {
  matcher: 'read_file|glob|grep',
  hooks: [
    {
      type: 'command',
      command: HOOK_COMMAND,
    },
  ],
};

const OPENCODE_PLUGIN_PATH = join('.opencode', 'plugins', 'webGenerate.js');
const OPENCODE_CONFIG_PATH = 'opencode.json';
const OPENCODE_PLUGIN_SOURCE = `// webGenerate OpenCode plugin
// Injects a reminder to use generated knowledge docs before heavy raw-file search.
import { existsSync } from "fs";
import { join } from "path";

const DOC_CANDIDATES = ${JSON.stringify(KNOWLEDGE_DOC_CANDIDATES)};

export const WebGeneratePlugin = async ({ directory }) => {
  let reminded = false;

  const hasKnowledgeDocs = () => (
    DOC_CANDIDATES.some((relativePath) => existsSync(join(directory, relativePath)))
  );

  return {
    "tool.execute.before": async (input, output) => {
      if (reminded) return;
      if (input.tool !== "bash") return;
      if (!hasKnowledgeDocs()) return;

      output.args.command =
        'echo "[webGenerate] For page feature changes, read webAIDocs/routes.md and related page-xxx.md before editing code." && ' +
        output.args.command;
      reminded = true;
    },
  };
};
`;

const CLAUDE_MD_SECTION = `## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated, run \`/webGenerate .\`
- After code changes, run \`/webGenerate . --update\` to sync only changed files
`;

const AGENTS_MD_SECTION = `## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated:
  - Codex uses \`$webGenerate .\`
  - Claude/OpenCode/Trae/Trae CN/Copilot/Gemini/Cursor/Antigravity use \`/webGenerate .\`
- After code changes, run incremental sync with the same trigger form and \`--update\`
`;

const COPILOT_MD_SECTION = `## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated, run \`/webGenerate .\` in an agent-capable chat or ask Copilot to follow the webGenerate workflow for the current workspace
- After code changes, run \`/webGenerate . --update\` or ask Copilot to incrementally sync webAIDocs
`;

const GEMINI_MD_SECTION = `## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated, run \`/webGenerate .\`
- After code changes, run \`/webGenerate . --update\`
`;

const ANTIGRAVITY_RULE_SECTION = `## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated, run \`/webGenerate .\`
- After code changes, run \`/webGenerate . --update\`
`;

const ANTIGRAVITY_WORKFLOW_SECTION = `## webGenerate

Slash command workflow:
- \`/webGenerate .\` runs a full webAIDocs generation workflow for the current workspace
- \`/webGenerate . --update\` incrementally syncs changed pages after code changes
- Output must be written only to \`webAIDocs/routes.md\` and \`webAIDocs/page-xxx.md\`
`;

const CURSOR_MDC_SECTION = `---
alwaysApply: true
---

## webGenerate

This project uses webGenerate-generated knowledge docs.

Rules:
- Before answering frontend business questions, read webAIDocs/routes.md if it exists
- For page feature refactor/development, first read webAIDocs/routes.md and the matched webAIDocs/page-xxx.md, then locate component/api/store files for code changes
- If routes/page docs are missing or outdated, run \`/webGenerate .\` or ask Cursor Agent to follow the webGenerate workflow for this workspace
- After code changes, run \`/webGenerate . --update\` or ask Cursor Agent to incrementally sync webAIDocs
`;

async function main() {
  const args = process.argv.slice(2);

  if (args[0] && args[0].toLowerCase() === 'mcp') {
    startMcpServer(args.slice(1));
    return;
  }

  if (
    args.length === 0
    || args.includes('-h')
    || args.includes('--help')
    || args[0] === 'help'
  ) {
    printHelp();
    return;
  }

  if (tryHandleInstallCommand(args)) {
    return;
  }

  console.error('error: this command only manages webGenerate skill install/uninstall.');
  console.error('Run: webGenerate <platform> install');
  console.error('After install, generate docs in your assistant with /webGenerate (Codex: $webGenerate).');
  process.exit(1);
}

function printHelp() {
  console.log('Usage: webGenerate <platform> <install|uninstall>');
  console.log('       webGenerate MCP [--root <projectRoot>]');
  console.log('');
  console.log('Platforms:');
  console.log('  claude | codex | opencode | copilot-cli | vscode-copilot | gemini | antigravity | cursor | trae | trae-cn');
  console.log('');
  console.log('Install:');
  console.log('  webGenerate claude install');
  console.log('  webGenerate codex install');
  console.log('  webGenerate opencode install');
  console.log('  webGenerate copilot-cli install');
  console.log('  webGenerate vscode-copilot install');
  console.log('  webGenerate gemini install');
  console.log('  webGenerate antigravity install');
  console.log('  webGenerate cursor install');
  console.log('  webGenerate trae install');
  console.log('  webGenerate trae-cn install');
  console.log('');
  console.log('Uninstall (optional):');
  console.log('  webGenerate <platform> uninstall');
  console.log('');
  console.log('Alternative form:');
  console.log('  webGenerate install --platform codex');
  console.log('');
  console.log('This command only installs/removes assistant skills.');
  console.log('Use assistant command to generate docs:');
  console.log('  /webGenerate [path] [--update]');
  console.log('  $webGenerate [path] [--update]   (Codex)');
  console.log('');
  console.log('MCP:');
  console.log('  webGenerate MCP');
  console.log('  webGenerate MCP --root ./your-project');
}

function startMcpServer(args) {
  const root = resolve(readMcpRootArg(args) || process.cwd());
  const state = {
    root,
    docsDir: join(root, 'webAIDocs'),
  };

  let inputBuffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    inputBuffer += chunk;
    let newlineIndex = inputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = inputBuffer.slice(0, newlineIndex).trim();
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      if (line) handleMcpLine(line, state);
      newlineIndex = inputBuffer.indexOf('\n');
    }
  });

  process.stdin.on('end', () => {
    const line = inputBuffer.trim();
    if (line) handleMcpLine(line, state);
  });
}

function readMcpRootArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) return args[i + 1];
    if (arg.startsWith('--root=')) return arg.slice('--root='.length);
  }
  return null;
}

function handleMcpLine(line, state) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeMcpError(null, -32700, `Parse error: ${error.message}`);
    return;
  }

  if (!message || typeof message !== 'object') {
    writeMcpError(null, -32600, 'Invalid JSON-RPC message');
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return;
  }

  try {
    const result = handleMcpRequest(message.method, message.params || {}, state);
    writeMcpResponse(message.id, result);
  } catch (error) {
    writeMcpError(message.id, error.code || -32000, error.message || String(error));
  }
}

function handleMcpRequest(method, params, state) {
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'webGenerate', version: VERSION },
    };
  }

  if (method === 'ping') {
    return {};
  }

  if (method === 'tools/list') {
    return { tools: buildMcpToolDefinitions() };
  }

  if (method === 'tools/call') {
    return callMcpTool(params, state);
  }

  const error = new Error(`Unsupported MCP method: ${method}`);
  error.code = -32601;
  throw error;
}

function buildMcpToolDefinitions() {
  return [
    {
      name: 'list_routes',
      description: 'List routes from webAIDocs/routes.md for the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keyword used to filter route path, title, or doc file.',
          },
        },
      },
    },
    {
      name: 'search_routes',
      description: 'Search route candidates by business text, page title, path, or doc file.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of route candidates to return.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_page_doc',
      description: 'Read one webAIDocs/page-xxx.md document by route path, page doc filename, or exact page title.',
      inputSchema: {
        type: 'object',
        properties: {
          route_or_doc: {
            type: 'string',
            description: 'Route path, page-xxx.md filename, or exact page title.',
          },
        },
        required: ['route_or_doc'],
      },
    },
    {
      name: 'list_page_docs',
      description: 'List available webAIDocs/page-*.md document files.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

function callMcpTool(params, state) {
  const name = String(params?.name || '').trim();
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};

  if (name === 'list_routes') {
    const query = String(args.query || '').trim();
    const routes = query ? filterRoutes(readRoutes(state), query) : readRoutes(state);
    return textToolResult(formatRoutes(routes));
  }

  if (name === 'search_routes') {
    const query = String(args.query || '').trim();
    const limit = Math.max(1, Number.parseInt(args.limit || '8', 10) || 8);
    const routes = filterRoutes(readRoutes(state), query).slice(0, limit);
    return textToolResult(formatRoutes(routes));
  }

  if (name === 'get_page_doc') {
    const reference = String(args.route_or_doc || '').trim();
    const route = resolveRouteReference(reference, readRoutes(state));
    if (!route) {
      return textToolResult(`未能定位到页面文档：${reference}`, true);
    }
    if (!route.docFile) {
      return textToolResult(`路由 ${route.path} 没有关联的页面文档。`, true);
    }
    const doc = readSafePageDoc(state, route.docFile);
    if (!doc.trim()) {
      return textToolResult(`未读取到 ${route.docFile} 的内容。`, true);
    }
    return textToolResult([
      `route: ${route.path}`,
      `title: ${route.title || '-'}`,
      `doc_file: ${route.docFile}`,
      '',
      doc,
    ].join('\n'));
  }

  if (name === 'list_page_docs') {
    return textToolResult(listPageDocs(state).join('\n') || '未找到 page-*.md 文档。');
  }

  const error = new Error(`Unknown tool: ${name}`);
  error.code = -32602;
  throw error;
}

function writeMcpResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function writeMcpError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function textToolResult(text, isError = false) {
  return {
    content: [{ type: 'text', text: String(text || '') }],
    isError,
  };
}

function readRoutesDoc(state) {
  const routesPath = join(state.docsDir, 'routes.md');
  if (!existsSync(routesPath)) return '';
  try {
    return readFileSync(routesPath, 'utf8');
  } catch {
    return '';
  }
}

function readRoutes(state) {
  const markdown = readRoutesDoc(state);
  const tables = parseMarkdownTables(markdown);
  const routes = [];

  for (const table of tables) {
    if (table.headers.length < 2) continue;
    const pathIdx = findTableColumn(table.headers, ['路径', 'path', 'route'], 0);
    const titleIdx = findTableColumn(table.headers, ['页面', 'title', 'name', '说明'], 1);
    const docIdx = findTableColumn(table.headers, ['文档', 'doc', 'file'], Math.min(3, table.headers.length - 1));

    for (const row of table.rows) {
      const routePath = String(row[pathIdx] || '').trim();
      if (!routePath || routePath === '-') continue;
      const title = String(row[titleIdx] || '').trim();
      const docFile = normalizeDocFile(row[docIdx] || '');
      routes.push({ path: routePath, title, docFile });
    }
  }

  return routes;
}

function parseMarkdownTables(markdown) {
  const tables = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const first = splitTableRow(lines[index]);
    if (!first.length) {
      index += 1;
      continue;
    }

    const block = [first];
    index += 1;
    while (index < lines.length) {
      const row = splitTableRow(lines[index]);
      if (!row.length) break;
      block.push(row);
      index += 1;
    }

    if (block.length >= 2 && isSeparatorRow(block[1])) {
      tables.push({ headers: block[0], rows: block.slice(2) });
    }
  }

  return tables;
}

function splitTableRow(line) {
  let text = String(line || '').trim();
  if (!text.includes('|')) return [];
  if (text.startsWith('|')) text = text.replace(/^\|/, '').replace(/\|$/, '');
  return text.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || '').replace(/\s/g, '')));
}

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-:/]/g, '');
}

function findTableColumn(headers, keywords, defaultIdx) {
  const normalized = headers.map(normalizeHeader);
  const found = normalized.findIndex((header) => keywords.some((keyword) => header.includes(keyword.toLowerCase())));
  if (found >= 0) return found;
  return Math.min(defaultIdx, Math.max(0, headers.length - 1));
}

function normalizeDocFile(value) {
  const text = String(value || '').trim();
  if (!text || text === '-' || text === 'null') return '';
  const match = text.match(/page-[A-Za-z0-9._-]+\.md/);
  return cleanPageDocFilename(match ? match[0] : text);
}

function cleanPageDocFilename(filename) {
  const candidate = String(filename || '').replace(/\\/g, '/').split('/').pop();
  if (!candidate || !candidate.endsWith('.md') || candidate.includes('..')) return '';
  return candidate;
}

function filterRoutes(routes, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return routes;
  return routes
    .map((route) => ({ route, score: routeScore(route, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.route);
}

function routeScore(route, query) {
  const haystacks = [route.path, route.title, route.docFile].map((item) => String(item || '').toLowerCase());
  let score = 0;
  for (const item of haystacks) {
    if (!item) continue;
    if (item === query) score += 20;
    if (item.includes(query)) score += 10;
    for (const token of query.split(/[\s/_-]+/)) {
      if (token.length >= 2 && item.includes(token)) score += 2;
    }
  }
  return score;
}

function resolveRouteReference(reference, routes) {
  const raw = String(reference || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, '/');
  const docFile = normalized.endsWith('.md') ? cleanPageDocFilename(normalized) : '';

  if (docFile) {
    return routes.find((route) => route.docFile === docFile) || null;
  }

  const exactPath = routes.find((route) => route.path === normalized);
  if (exactPath) return exactPath;

  const lowered = normalized.toLowerCase();
  const exactTitle = routes.filter((route) => String(route.title || '').toLowerCase() === lowered);
  if (exactTitle.length === 1) return exactTitle[0];

  const exactDoc = routes.filter((route) => String(route.docFile || '').toLowerCase().replace(/\.md$/, '') === lowered);
  if (exactDoc.length === 1) return exactDoc[0];

  return null;
}

function formatRoutes(routes) {
  if (!routes.length) return '未找到匹配的路由。';
  return routes.map((route) => `- ${route.path} | ${route.title || '-'} | ${route.docFile || '-'}`).join('\n');
}

function listPageDocs(state) {
  if (!existsSync(state.docsDir)) return [];
  try {
    return readdirSync(state.docsDir)
      .filter((name) => /^page-[A-Za-z0-9._-]+\.md$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function readSafePageDoc(state, filename) {
  const safe = cleanPageDocFilename(filename);
  if (!safe) return '';
  const filePath = join(state.docsDir, safe);
  if (!existsSync(filePath)) return '';
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function tryHandleInstallCommand(args) {
  const firstPlatform = normalizePlatform(args[0]);
  if (firstPlatform && (args[1] === 'install' || args[1] === 'uninstall')) {
    const platform = firstPlatform;
    const action = args[1];
    if (action === 'install') {
      installPlatform(platform, resolve(process.cwd()));
    } else {
      uninstallPlatform(platform, resolve(process.cwd()));
    }
    return true;
  }

  if (args[0] === 'install' || args[0] === 'uninstall') {
    const action = args[0];
    const platform = readPlatformFromArgs(args.slice(1));
    if (!platform) {
      console.error(`error: missing --platform. Expected one of: ${platformList()}`);
      process.exit(1);
    }
    if (!(platform in PLATFORM_CONFIG)) {
      console.error(`error: unsupported platform "${platform}"`);
      process.exit(1);
    }

    if (action === 'install') {
      installPlatform(platform, resolve(process.cwd()));
    } else {
      uninstallPlatform(platform, resolve(process.cwd()));
    }
    return true;
  }

  return false;
}

function readPlatformFromArgs(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--platform=')) return normalizePlatform(arg.split('=', 2)[1]);
    if (arg === '--platform' && i + 1 < args.length) return normalizePlatform(args[i + 1]);
    const platform = normalizePlatform(arg);
    if (platform) return platform;
  }
  return null;
}

function normalizePlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized in PLATFORM_CONFIG) return normalized;
  return PLATFORM_ALIASES[normalized] || null;
}

function platformList() {
  return Object.keys(PLATFORM_CONFIG).join(', ');
}

function installPlatform(platform, projectRoot) {
  const cfg = PLATFORM_CONFIG[platform];
  const templatePath = join(TEMPLATE_ROOT, cfg.template);
  if (!existsSync(templatePath)) {
    console.error(`error: template not found: ${templatePath}`);
    process.exit(1);
  }

  const skillDst = homePath(...cfg.skillDst);
  mkdirSync(dirname(skillDst), { recursive: true });
  copyFileSync(templatePath, skillDst);
  writeFileSync(join(dirname(skillDst), SKILL_VERSION_FILE), `${VERSION}\n`, 'utf8');
  console.log(`skill installed: ${skillDst}`);

  for (const aliasSegments of (cfg.aliases || [])) {
    const aliasDst = homePath(...aliasSegments);
    if (samePath(aliasDst, skillDst)) {
      console.log(`skill alias skipped (same path): ${aliasDst}`);
      continue;
    }
    mkdirSync(dirname(aliasDst), { recursive: true });
    const aliasSkillName = aliasSegments[aliasSegments.length - 2] || 'webGenerate';
    const aliasMarkdown = buildAliasSkillMarkdown(templatePath, aliasSkillName);
    writeFileSync(aliasDst, aliasMarkdown, 'utf8');
    writeFileSync(join(dirname(aliasDst), SKILL_VERSION_FILE), `${VERSION}\n`, 'utf8');
    console.log(`skill alias installed: ${aliasDst}`);
  }

  writeProjectPlatformConfig(projectRoot, platform);
  console.log(`project platform locked: ${platform} (${join(projectRoot, MANIFEST_DIR, PLATFORM_CONFIG_FILE)})`);

  if (platform === 'claude') {
    const changed = upsertMarkdownSection(join(projectRoot, CLAUDE_FILE), MARKER, CLAUDE_MD_SECTION);
    console.log(changed
      ? `configured: ${join(projectRoot, CLAUDE_FILE)}`
      : `already configured: ${join(projectRoot, CLAUDE_FILE)}`);
    installClaudeHook(projectRoot);
  } else {
    const changed = upsertMarkdownSection(join(projectRoot, AGENTS_FILE), MARKER, AGENTS_MD_SECTION);
    console.log(changed
      ? `configured: ${join(projectRoot, AGENTS_FILE)}`
      : `already configured: ${join(projectRoot, AGENTS_FILE)}`);
    if (platform === 'codex') installCodexHook(projectRoot);
    if (platform === 'opencode') installOpenCodePlugin(projectRoot);
    if (platform === 'gemini') installGeminiHook(projectRoot);
  }

  installProjectRules(projectRoot, cfg);

  console.log('');
  console.log(`${cfg.label} install completed.`);
  if (platform === 'codex') {
    console.log('Use in Codex: $webGenerate .');
    console.log('Incremental sync: $webGenerate . --update');
    console.log('Alias (case-safe): $webgenerate .');
  } else if (platform === 'copilot-cli' || platform === 'vscode-copilot' || platform === 'cursor') {
    console.log('Use in assistant: ask it to run /webGenerate . or follow the webGenerate workflow.');
    console.log('Incremental sync: ask it to run /webGenerate . --update or sync webAIDocs incrementally.');
  } else {
    console.log('Use in assistant: /webGenerate .');
    console.log('Incremental sync: /webGenerate . --update');
  }
}

function uninstallPlatform(platform, projectRoot) {
  const cfg = PLATFORM_CONFIG[platform];
  const skillDst = homePath(...cfg.skillDst);
  removeFileIfExists(skillDst);
  removeFileIfExists(join(dirname(skillDst), SKILL_VERSION_FILE));
  removeEmptyParents(dirname(skillDst), os.homedir());

  for (const aliasSegments of (cfg.aliases || [])) {
    const aliasDst = homePath(...aliasSegments);
    removeFileIfExists(aliasDst);
    removeFileIfExists(join(dirname(aliasDst), SKILL_VERSION_FILE));
    removeEmptyParents(dirname(aliasDst), os.homedir());
  }

  removeProjectPlatformConfig(projectRoot, platform);

  if (platform === 'claude') {
    const removed = removeMarkdownSection(join(projectRoot, CLAUDE_FILE), MARKER);
    console.log(removed
      ? `removed from: ${join(projectRoot, CLAUDE_FILE)}`
      : `no section found: ${join(projectRoot, CLAUDE_FILE)}`);
    uninstallClaudeHook(projectRoot);
  } else {
    const removed = removeMarkdownSection(join(projectRoot, AGENTS_FILE), MARKER);
    console.log(removed
      ? `removed from: ${join(projectRoot, AGENTS_FILE)}`
      : `no section found: ${join(projectRoot, AGENTS_FILE)}`);
    if (platform === 'codex') uninstallCodexHook(projectRoot);
    if (platform === 'opencode') uninstallOpenCodePlugin(projectRoot);
    if (platform === 'gemini') uninstallGeminiHook(projectRoot);
  }

  uninstallProjectRules(projectRoot, cfg);

  console.log(`${cfg.label} uninstall completed.`);
}

function installProjectRules(projectRoot, cfg) {
  for (const relativeFile of (cfg.projectRules || [])) {
    const filePath = join(projectRoot, relativeFile);
    const changed = upsertMarkdownSection(filePath, MARKER, ruleSectionForFile(relativeFile));
    console.log(changed
      ? `configured: ${filePath}`
      : `already configured: ${filePath}`);
  }
}

function uninstallProjectRules(projectRoot, cfg) {
  for (const relativeFile of (cfg.projectRules || [])) {
    const filePath = join(projectRoot, relativeFile);
    const removed = removeMarkdownSection(filePath, MARKER);
    console.log(removed
      ? `removed from: ${filePath}`
      : `no section found: ${filePath}`);
  }
}

function ruleSectionForFile(relativeFile) {
  if (relativeFile === COPILOT_INSTRUCTIONS_FILE) return COPILOT_MD_SECTION;
  if (relativeFile === GEMINI_FILE) return GEMINI_MD_SECTION;
  if (relativeFile === ANTIGRAVITY_RULE_FILE) return ANTIGRAVITY_RULE_SECTION;
  if (relativeFile === ANTIGRAVITY_WORKFLOW_FILE) return ANTIGRAVITY_WORKFLOW_SECTION;
  if (relativeFile === CURSOR_RULE_FILE) return CURSOR_MDC_SECTION;
  return AGENTS_MD_SECTION;
}

function upsertMarkdownSection(filePath, marker, sectionText) {
  const markerTitle = `## ${marker}`;
  const payload = sectionText.trimEnd();
  const sectionRegex = new RegExp(`(?:^|\\r?\\n)## ${escapeRegExp(marker)}\\r?\\n[\\s\\S]*?(?=\\r?\\n## |$)`, 'g');

  if (existsSync(filePath)) {
    const current = readFileSync(filePath, 'utf8');
    if (current.includes(markerTitle)) {
      const replaced = current.replace(sectionRegex, (match) => {
        const prefix = match.startsWith('\n') || match.startsWith('\r\n') ? match.match(/^\r?\n/)?.[0] || '' : '';
        return `${prefix}${payload}`;
      });
      if (replaced.trimEnd() === current.trimEnd()) return false;
      writeFileSync(filePath, `${replaced.trimEnd()}\n`, 'utf8');
      return true;
    }
    writeFileSync(filePath, `${current.trimEnd()}\n\n${payload}\n`, 'utf8');
    return true;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${payload}\n`, 'utf8');
  return true;
}

function removeMarkdownSection(filePath, marker) {
  if (!existsSync(filePath)) return false;
  const markerTitle = `## ${marker}`;
  const current = readFileSync(filePath, 'utf8');
  if (!current.includes(markerTitle)) return false;

  const regex = new RegExp(`(?:^|\\r?\\n)## ${escapeRegExp(marker)}\\r?\\n[\\s\\S]*?(?=\\r?\\n## |$)`, 'g');
  const cleaned = current.replace(regex, '').trim();

  if (cleaned) {
    writeFileSync(filePath, `${cleaned}\n`, 'utf8');
  } else {
    unlinkSync(filePath);
  }

  return true;
}

function installClaudeHook(projectRoot) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  const settings = readJsonFile(settingsPath, {});
  const hooks = ensureObject(settings, 'hooks');
  const preToolUse = ensureArray(hooks, 'PreToolUse');
  hooks.PreToolUse = preToolUse.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  hooks.PreToolUse.push(CLAUDE_HOOK);
  writeJsonFile(settingsPath, settings);
  console.log('hook registered: .claude/settings.json');
}

function uninstallClaudeHook(projectRoot) {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return;
  const settings = readJsonFile(settingsPath, null);
  if (!settings || typeof settings !== 'object') return;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  hooks.PreToolUse = preToolUse.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  writeJsonFile(settingsPath, settings);
  console.log('hook removed: .claude/settings.json');
}

function installCodexHook(projectRoot) {
  const hooksPath = join(projectRoot, '.codex', 'hooks.json');
  const hooks = readJsonFile(hooksPath, {});
  const root = ensureObject(hooks, 'hooks');
  const preToolUse = ensureArray(root, 'PreToolUse');
  root.PreToolUse = preToolUse.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  root.PreToolUse.push(CODEX_HOOK);
  writeJsonFile(hooksPath, hooks);
  console.log('hook registered: .codex/hooks.json');
}

function uninstallCodexHook(projectRoot) {
  const hooksPath = join(projectRoot, '.codex', 'hooks.json');
  if (!existsSync(hooksPath)) return;
  const hooks = readJsonFile(hooksPath, null);
  if (!hooks || typeof hooks !== 'object') return;
  const root = hooks.hooks;
  if (!root || typeof root !== 'object') return;
  const preToolUse = Array.isArray(root.PreToolUse) ? root.PreToolUse : [];
  root.PreToolUse = preToolUse.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  writeJsonFile(hooksPath, hooks);
  console.log('hook removed: .codex/hooks.json');
}

function installGeminiHook(projectRoot) {
  const settingsPath = join(projectRoot, '.gemini', 'settings.json');
  const settings = readJsonFile(settingsPath, {});
  const hooks = ensureObject(settings, 'hooks');
  const beforeTool = ensureArray(hooks, 'BeforeTool');
  hooks.BeforeTool = beforeTool.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  hooks.BeforeTool.push(GEMINI_HOOK);
  writeJsonFile(settingsPath, settings);
  console.log('hook registered: .gemini/settings.json');
}

function uninstallGeminiHook(projectRoot) {
  const settingsPath = join(projectRoot, '.gemini', 'settings.json');
  if (!existsSync(settingsPath)) return;
  const settings = readJsonFile(settingsPath, null);
  if (!settings || typeof settings !== 'object') return;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  const beforeTool = Array.isArray(hooks.BeforeTool) ? hooks.BeforeTool : [];
  hooks.BeforeTool = beforeTool.filter((entry) => !JSON.stringify(entry).includes('webGenerate'));
  writeJsonFile(settingsPath, settings);
  console.log('hook removed: .gemini/settings.json');
}

function installOpenCodePlugin(projectRoot) {
  const pluginPath = join(projectRoot, OPENCODE_PLUGIN_PATH);
  mkdirSync(dirname(pluginPath), { recursive: true });
  writeFileSync(pluginPath, OPENCODE_PLUGIN_SOURCE, 'utf8');
  console.log(`plugin written: ${OPENCODE_PLUGIN_PATH}`);

  const configPath = join(projectRoot, OPENCODE_CONFIG_PATH);
  const config = readJsonFile(configPath, {});
  const plugins = ensureArray(config, 'plugin');
  const entry = OPENCODE_PLUGIN_PATH.replaceAll('\\', '/');
  if (!plugins.includes(entry)) {
    plugins.push(entry);
  }
  writeJsonFile(configPath, config);
  console.log(`plugin registered: ${OPENCODE_CONFIG_PATH}`);
}

function uninstallOpenCodePlugin(projectRoot) {
  const pluginPath = join(projectRoot, OPENCODE_PLUGIN_PATH);
  removeFileIfExists(pluginPath);

  const configPath = join(projectRoot, OPENCODE_CONFIG_PATH);
  if (!existsSync(configPath)) return;
  const config = readJsonFile(configPath, null);
  if (!config || typeof config !== 'object') return;
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  const entry = OPENCODE_PLUGIN_PATH.replaceAll('\\', '/');
  const next = plugins.filter((item) => item !== entry);
  if (next.length > 0) {
    config.plugin = next;
  } else {
    delete config.plugin;
  }
  writeJsonFile(configPath, config);
  console.log(`plugin unregistered: ${OPENCODE_CONFIG_PATH}`);
}

function writeProjectPlatformConfig(projectRoot, platform) {
  const dirPath = join(projectRoot, MANIFEST_DIR);
  const filePath = join(dirPath, PLATFORM_CONFIG_FILE);
  mkdirSync(dirPath, { recursive: true });
  writeJsonFile(filePath, {
    platform,
    version: VERSION,
    installedAt: new Date().toISOString(),
  });
}

function removeProjectPlatformConfig(projectRoot, uninstallPlatformName) {
  const filePath = join(projectRoot, MANIFEST_DIR, PLATFORM_CONFIG_FILE);
  if (!existsSync(filePath)) return;

  const current = readJsonFile(filePath, null);
  if (!current || typeof current !== 'object') return;
  if (current.platform !== uninstallPlatformName) return;

  removeFileIfExists(filePath);
  const dirPath = join(projectRoot, MANIFEST_DIR);
  try {
    rmdirSync(dirPath);
  } catch {
    // keep directory when it still contains other files
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function buildAliasSkillMarkdown(templatePath, aliasSkillName) {
  const source = readFileSync(templatePath, 'utf8');
  const normalized = String(aliasSkillName || '').trim().replace(/-alias$/i, '');
  if (!normalized || normalized === 'webGenerate') return source;

  const triggerMatch = source.match(/^trigger:\s*([^\r\n]+)$/m);
  const currentTrigger = triggerMatch ? triggerMatch[1].trim() : '/webGenerate';
  const prefix = currentTrigger.startsWith('$') ? '$' : '/';

  return source
    .replace(/^name:[^\r\n]*$/m, `name: ${normalized}`)
    .replace(/^trigger:[^\r\n]*$/m, `trigger: ${prefix}${normalized}`);
}

function readJsonFile(filePath, fallbackValue) {
  if (!existsSync(filePath)) return fallbackValue;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

function ensureArray(parent, key) {
  if (!Array.isArray(parent[key])) {
    parent[key] = [];
  }
  return parent[key];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function samePath(leftPath, rightPath) {
  return resolve(leftPath).toLowerCase() === resolve(rightPath).toLowerCase();
}

function homePath(...segments) {
  return join(os.homedir(), ...segments);
}

function removeFileIfExists(filePath) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

function removeEmptyParents(startDir, stopDir) {
  let current = resolve(startDir);
  const stop = resolve(stopDir);

  while (current.startsWith(stop) && current !== stop) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
