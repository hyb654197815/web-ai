#!/usr/bin/env node
/**
 * 知识文档生成：
 * 1. 根据 runner 选择 OpenCode / Codex / Claude Code
 * 2. 将 widget-knowledge-* Skill 安装到对应运行时的默认 skills 目录
 * 3. 调用对应 CLI 执行全量或增量知识文档生成
 *
 * 用法：
 *   node scripts/generate-docs.js [选项] <项目路径>
 *   npm run gen-docs -- [选项] <项目路径>
 *
 * 选项：
 *   --runner, --runtime, -r <runner>  opencode | codex | claude，默认 opencode
 *   --model, -m <model>               指定模型
 *   --mode <mode>                     full | incremental，默认 full
 *   --changed, -c <file>              增量模式下的变更文件，可重复传入
 *   --scope, -s <text>                增量模式下的业务范围说明
 *   --verify                          强制在主流程完成后再执行一次检查补全
 *   --skip-verify                     跳过检查补全；full 默认开启，incremental 默认关闭
 *   --print-prompt                    仅输出一条可直接粘贴到 Cursor / 通用 Agent 的 prompt，不执行 CLI
 *   --global-config                   仅对 OpenCode 生效，不隔离到 .opencode-xdg
 *
 * 环境变量：
 *   WIDGET_DOCS_RUNNER
 *   WIDGET_SKILLS_DIR
 *   WIDGET_KNOWLEDGE_DIR
 *   WIDGET_KNOWLEDGE_SKILL_DIR
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_ROOT = resolve(__dirname, '..');
const SYMLINK_NAME = '.opencode-gen-target';
const SKILL_NAMES = ['widget-knowledge-generator', 'widget-knowledge-system', 'widget-knowledge-updater'];
const PROMPT_TEMPLATE_FILES = {
  full: join(SCRIPT_ROOT, 'prompts', 'generate-docs-full.txt'),
  incremental: join(SCRIPT_ROOT, 'prompts', 'generate-docs-incremental.txt'),
  verifyFull: join(SCRIPT_ROOT, 'prompts', 'generate-docs-verify-full.txt'),
  verifyIncremental: join(SCRIPT_ROOT, 'prompts', 'generate-docs-verify-incremental.txt'),
  directFull: join(SCRIPT_ROOT, 'prompts', 'generate-docs-direct-full.txt'),
  directIncremental: join(SCRIPT_ROOT, 'prompts', 'generate-docs-direct-incremental.txt'),
};
const DEFAULT_SOURCE_SKILLS_DIRS = [
  join(SCRIPT_ROOT, '.opencode', 'skills'),
  join(SCRIPT_ROOT, 'skills'),
  join(SCRIPT_ROOT, '.codex', 'skills'),
  join(SCRIPT_ROOT, '.claude', 'skills'),
];
const PROMPT_TEMPLATE_CACHE = new Map();
const SKILL_CALL_PATTERN = /^调用 skill\(\{ name: "([^"]+)" \}\)\s*/u;
const RUNTIME_CONFIGS = {
  opencode: {
    label: 'OpenCode',
    command: 'opencode',
    skillRootDir: '.opencode',
  },
  codex: {
    label: 'Codex',
    command: 'codex',
    skillRootDir: '.codex',
  },
  claude: {
    label: 'Claude Code',
    command: 'claude',
    skillRootDir: '.claude',
  },
};

function isUnderCwd(cwd, targetPath) {
  const rel = relative(cwd, resolve(targetPath));
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function toPromptPath(targetPath) {
  return resolve(targetPath).replaceAll('\\', '/');
}

function resolveOptionalDir(dirPath) {
  if (!dirPath) return null;
  return resolve(process.cwd(), dirPath);
}

function normalizeRunner(runner) {
  const normalized = (runner || 'opencode').trim().toLowerCase();
  if (normalized === 'claude-code' || normalized === 'claudecode') return 'claude';
  return normalized;
}

function getRuntimeConfig(runner) {
  return RUNTIME_CONFIGS[normalizeRunner(runner)] ?? null;
}

function resolveSourceSkillsDir() {
  const configuredDirs = [process.env.WIDGET_SKILLS_DIR]
    .map((dirPath) => resolveOptionalDir(dirPath))
    .filter(Boolean);
  const candidates = [...configuredDirs, ...DEFAULT_SOURCE_SKILLS_DIRS];
  return candidates.find((skillsDir) => (
    SKILL_NAMES.every((skillName) => existsSync(join(skillsDir, skillName, 'SKILL.md')))
  )) ?? null;
}

function getRuntimeSkillsDir(cwd, runner) {
  const runtimeConfig = getRuntimeConfig(runner);
  if (!runtimeConfig) {
    throw new Error(`错误：不支持的运行方式: ${runner}`);
  }
  return join(cwd, runtimeConfig.skillRootDir, 'skills');
}

function loadPromptTemplate(templateName) {
  const templatePath = PROMPT_TEMPLATE_FILES[templateName];
  if (!templatePath) {
    throw new Error(`错误：未知的提示词模板类型: ${templateName}`);
  }
  if (!existsSync(templatePath)) {
    throw new Error(`错误：提示词模板不存在: ${templatePath}`);
  }
  if (!PROMPT_TEMPLATE_CACHE.has(templateName)) {
    PROMPT_TEMPLATE_CACHE.set(templateName, readFileSync(templatePath, 'utf8').trim());
  }
  return PROMPT_TEMPLATE_CACHE.get(templateName);
}

function renderPromptTemplate(templateName, variables) {
  let template = loadPromptTemplate(templateName);
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value ?? '');
  }

  const unresolvedVariables = [...template.matchAll(/{{([A-Z0-9_]+)}}/g)]
    .map((match) => match[1]);
  if (unresolvedVariables.length) {
    throw new Error(`错误：提示词模板仍有未替换变量: ${[...new Set(unresolvedVariables)].join(', ')}`);
  }
  return template;
}

function resolveKnowledgeLocations(cwd, runner) {
  const explicitReferencesDir = resolveOptionalDir(process.env.WIDGET_KNOWLEDGE_DIR);
  if (explicitReferencesDir) {
    return {
      knowledgeSkillRoot: dirname(explicitReferencesDir),
      referencesDir: explicitReferencesDir,
    };
  }

  const explicitSkillRoot = resolveOptionalDir(process.env.WIDGET_KNOWLEDGE_SKILL_DIR);
  if (explicitSkillRoot) {
    return {
      knowledgeSkillRoot: explicitSkillRoot,
      referencesDir: join(explicitSkillRoot, 'references'),
    };
  }

  const explicitSkillsDir = resolveOptionalDir(process.env.WIDGET_SKILLS_DIR);
  if (explicitSkillsDir) {
    const skillRoot = join(explicitSkillsDir, 'widget-knowledge-system');
    return {
      knowledgeSkillRoot: skillRoot,
      referencesDir: join(skillRoot, 'references'),
    };
  }

  const runtimeSkillsDir = getRuntimeSkillsDir(cwd, runner);
  const knowledgeSkillRoot = join(runtimeSkillsDir, 'widget-knowledge-system');
  return {
    knowledgeSkillRoot,
    referencesDir: join(knowledgeSkillRoot, 'references'),
  };
}

function ensureSymlink(cwd, targetRoot) {
  if (isUnderCwd(cwd, targetRoot)) return null;
  const linkPath = join(cwd, SYMLINK_NAME);
  if (existsSync(linkPath)) unlinkSync(linkPath);
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(targetRoot, linkPath, type);
  return linkPath;
}

function splitSkillMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: '',
      body: markdown,
    };
  }
  return {
    frontmatter: match[1],
    body: match[2],
  };
}

function parseFrontmatterField(frontmatter, fieldName) {
  const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(pattern);
  if (!match) return null;

  const rawValue = match[1].trim();
  if (
    (rawValue.startsWith('"') && rawValue.endsWith('"'))
    || (rawValue.startsWith('\'') && rawValue.endsWith('\''))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function toYamlScalar(value) {
  return JSON.stringify(value ?? '');
}

function buildRuntimeSkillMarkdown(skillName, sourceSkillFile, runner) {
  if (runner === 'opencode') {
    return readFileSync(sourceSkillFile, 'utf8');
  }

  const sourceMarkdown = readFileSync(sourceSkillFile, 'utf8');
  const { frontmatter, body } = splitSkillMarkdown(sourceMarkdown);
  const name = parseFrontmatterField(frontmatter, 'name') || skillName;
  const description = parseFrontmatterField(frontmatter, 'description') || '';
  const nextFrontmatter = [
    '---',
    `name: ${toYamlScalar(name)}`,
    `description: ${toYamlScalar(description)}`,
  ];

  if (runner === 'claude') {
    // Claude Code headless mode cannot invoke slash skills, so keep
    // generation skills available for model-driven invocation.
    if (skillName === 'widget-knowledge-system') {
      nextFrontmatter.push('user-invocable: false');
    }
  }

  nextFrontmatter.push('---', '', body.trimStart());
  return nextFrontmatter.join('\n');
}

function copyMissingSkillEntries(sourceSkillDir, targetSkillDir) {
  mkdirSync(targetSkillDir, { recursive: true });

  for (const entryName of readdirSync(sourceSkillDir)) {
    if (entryName === 'SKILL.md') continue;

    const sourceEntry = join(sourceSkillDir, entryName);
    const targetEntry = join(targetSkillDir, entryName);
    if (!existsSync(targetEntry)) {
      cpSync(sourceEntry, targetEntry, { recursive: true });
    }
  }
}

function ensureSkillsInCwd(cwd, sourceSkillsDir, runner) {
  const skillsDir = getRuntimeSkillsDir(cwd, runner);
  mkdirSync(skillsDir, { recursive: true });

  for (const skillName of SKILL_NAMES) {
    const sourceSkillDir = join(sourceSkillsDir, skillName);
    const targetSkillDir = join(skillsDir, skillName);
    const sourceSkillFile = join(sourceSkillDir, 'SKILL.md');
    const runtimeSkillFile = join(targetSkillDir, 'SKILL.md');

    if (!existsSync(targetSkillDir)) {
      cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
    } else {
      copyMissingSkillEntries(sourceSkillDir, targetSkillDir);
    }

    if (runner !== 'opencode') {
      writeFileSync(runtimeSkillFile, buildRuntimeSkillMarkdown(skillName, sourceSkillFile, runner), 'utf8');
    } else if (!existsSync(runtimeSkillFile)) {
      cpSync(sourceSkillFile, runtimeSkillFile);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let model = null;
  let runner = normalizeRunner(process.env.WIDGET_DOCS_RUNNER || 'opencode');
  let target = process.env.PROJECT_ROOT || '.';
  let globalConfig = false;
  let printPrompt = false;
  let mode = 'full';
  let verifyMode = 'auto';
  let scope = null;
  const changedFiles = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') {
      model = args[++i] ?? null;
    } else if (args[i] === '--runner' || args[i] === '--runtime' || args[i] === '-r') {
      runner = normalizeRunner(args[++i] ?? runner);
    } else if (args[i] === '--mode') {
      mode = args[++i] ?? mode;
    } else if (args[i] === '--changed' || args[i] === '-c') {
      const changedFile = args[++i] ?? null;
      if (changedFile) changedFiles.push(changedFile);
    } else if (args[i] === '--scope' || args[i] === '-s') {
      scope = args[++i] ?? null;
    } else if (args[i] === '--verify') {
      verifyMode = 'always';
    } else if (args[i] === '--skip-verify' || args[i] === '--no-verify') {
      verifyMode = 'never';
    } else if (args[i] === '--print-prompt' || args[i] === '--prompt-only') {
      printPrompt = true;
    } else if (args[i] === '--global-config') {
      globalConfig = true;
    } else if (!args[i].startsWith('-')) {
      target = args[i];
    }
  }

  return { model, runner, target, globalConfig, printPrompt, mode, verifyMode, scope, changedFiles };
}

function buildVerificationContext({ mode, changedFiles, scope }) {
  const lines = [
    `本次触发来源：${mode === 'full' ? '全量生成后的自动检查补全' : '增量同步后的检查补全'}`,
  ];

  if (changedFiles.length) {
    lines.push('已知变更文件：');
    lines.push(...changedFiles.map((file) => `- ${file}`));
  } else if (mode === 'incremental') {
    lines.push('已知变更文件：');
    lines.push('- 未显式提供变更文件');
  }

  if (scope) {
    lines.push(`业务范围说明：${scope}`);
  }

  return lines.join('\n');
}

function buildPromptVariables({
  mode,
  analyzePath,
  changedFiles,
  scope,
  knowledgeSkillRoot,
  referencesDir,
  workspaceRoot,
  sourceSkillsDir,
  verifyEnabled,
}) {
  const promptAnalyzePath = toPromptPath(analyzePath);
  const promptKnowledgeSkillRoot = toPromptPath(knowledgeSkillRoot);
  const promptReferencesDir = toPromptPath(referencesDir);
  const promptWorkspaceRoot = toPromptPath(workspaceRoot);
  const generatorSkillFile = toPromptPath(join(sourceSkillsDir, 'widget-knowledge-generator', 'SKILL.md'));
  const updaterSkillFile = toPromptPath(join(sourceSkillsDir, 'widget-knowledge-updater', 'SKILL.md'));
  const systemSkillFile = toPromptPath(join(sourceSkillsDir, 'widget-knowledge-system', 'SKILL.md'));
  const normalizedChangedFiles = changedFiles.map((file) => file.replaceAll('\\', '/'));

  return {
    ANALYZE_PATH: promptAnalyzePath,
    WORKSPACE_ROOT: promptWorkspaceRoot,
    KNOWLEDGE_SKILL_ROOT: promptKnowledgeSkillRoot,
    REFERENCES_DIR: promptReferencesDir,
    GENERATOR_SKILL_FILE: generatorSkillFile,
    UPDATER_SKILL_FILE: updaterSkillFile,
    SYSTEM_SKILL_FILE: systemSkillFile,
    CHANGE_LIST: normalizedChangedFiles.length
      ? normalizedChangedFiles.map((file) => `- ${file}`).join('\n')
      : '- 未显式提供变更文件',
    SCOPE_BLOCK: scope ? `\n业务范围说明：${scope}` : '',
    VERIFY_BLOCK: verifyEnabled
      ? (
        mode === 'full'
          ? '\n7. 主任务完成后，不要立刻结束；再做一次全量校准补全，确认没有遗漏路由、缺失页面文档或 slug 不一致问题。'
          : '\n7. 主任务完成后，再做一次“检查补全”，只修正仍然缺失或不一致的 routes.md 行与 page-xxx.md。'
      )
      : '\n7. 结束前至少完成一轮自检，确认本次写入结果与源码一致。',
    VERIFICATION_CONTEXT: buildVerificationContext({
      mode,
      changedFiles: normalizedChangedFiles,
      scope,
    }),
  };
}

function adaptPromptForRunner(prompt, runner) {
  if (runner === 'opencode') return prompt;

  const match = prompt.match(SKILL_CALL_PATTERN);
  if (!match) return prompt;

  const [, skillName] = match;
  const rest = prompt.slice(match[0].length).trimStart();

  if (runner === 'codex' || runner === 'claude') {
    return `使用 \`${skillName}\` skill 完成下面任务。\n\n${rest}`;
  }

  return prompt;
}

function buildPrimaryPrompt({ mode, promptVariables, runner }) {
  const templateName = mode === 'incremental' ? 'incremental' : 'full';
  return adaptPromptForRunner(renderPromptTemplate(templateName, promptVariables), runner);
}

function buildVerificationPrompt(mode, promptVariables, runner) {
  const templateName = mode === 'incremental' ? 'verifyIncremental' : 'verifyFull';
  return adaptPromptForRunner(renderPromptTemplate(templateName, promptVariables), runner);
}

function buildDirectPrompt(mode, promptVariables) {
  const templateName = mode === 'incremental' ? 'directIncremental' : 'directFull';
  return renderPromptTemplate(templateName, promptVariables);
}

function shouldRunVerification(mode, verifyMode) {
  return verifyMode === 'always' || (verifyMode === 'auto' && mode === 'full');
}

function formatVerificationStatus(mode, verifyMode, enabled) {
  if (enabled) {
    return verifyMode === 'always' ? '开启（显式指定）' : `${mode} 模式默认开启`;
  }
  return verifyMode === 'never' ? '关闭（显式跳过）' : `${mode} 模式默认关闭`;
}

function buildOpencodeEnv(cwd, globalConfig) {
  let configHome = null;
  let cacheHome = null;
  let dataHome = null;

  if (!globalConfig) {
    const xdgRoot = join(cwd, '.opencode-xdg');
    configHome = join(xdgRoot, 'config');
    cacheHome = join(xdgRoot, 'cache');
    dataHome = join(xdgRoot, 'data');
    mkdirSync(configHome, { recursive: true });
    mkdirSync(cacheHome, { recursive: true });
    mkdirSync(dataHome, { recursive: true });
  }

  let permission = {};
  if (process.env.OPENCODE_PERMISSION) {
    try {
      const parsed = JSON.parse(process.env.OPENCODE_PERMISSION);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        permission = parsed;
      }
    } catch {
      // Ignore invalid OPENCODE_PERMISSION and rebuild a safe value below.
    }
  }

  const existingExternal = permission.external_directory;
  if (existingExternal && typeof existingExternal === 'object' && !Array.isArray(existingExternal)) {
    permission.external_directory = { ...existingExternal, '*': 'allow' };
  } else {
    permission.external_directory = 'allow';
  }

  const env = {
    ...process.env,
    OPENCODE_YOLO: 'true',
    OPENCODE_PERMISSION: JSON.stringify(permission),
  };

  if (!globalConfig) {
    env.XDG_CONFIG_HOME = configHome;
    env.XDG_CACHE_HOME = cacheHome;
    env.XDG_DATA_HOME = dataHome;
  }

  return env;
}

function buildRuntimeEnv(cwd, runner, globalConfig) {
  if (runner === 'opencode') {
    return buildOpencodeEnv(cwd, globalConfig);
  }
  return { ...process.env };
}

function runnerUsesStdin(runner) {
  return runner === 'codex' || runner === 'claude';
}

function runnerUsesManagedOutput(runner) {
  return runner === 'claude';
}

function summarizeJsonSnippet(text, maxLength = 220) {
  if (!text) return '';

  const compactText = String(text).replace(/\s+/g, ' ').trim();
  if (compactText.length <= maxLength) return compactText;
  return `${compactText.slice(0, maxLength - 3)}...`;
}

function extractAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function createClaudeOutputManager(label) {
  const state = {
    stdoutBuffer: '',
    currentToolName: null,
    currentToolInput: '',
    textActive: false,
    currentMessageHadTextDelta: false,
    lastVisibleOutputAt: Date.now(),
    toolProgressSeenAt: new Map(),
  };

  const noteVisibleOutput = () => {
    state.lastVisibleOutputAt = Date.now();
  };

  const ensureTextBoundary = () => {
    if (!state.textActive) return;
    process.stdout.write('\n');
    state.textActive = false;
  };

  const writeLine = (line, stream = process.stdout) => {
    if (!line) return;
    ensureTextBoundary();
    stream.write(`${line}\n`);
    noteVisibleOutput();
  };

  const writeText = (text) => {
    if (!text) return;
    process.stdout.write(text);
    state.textActive = true;
    noteVisibleOutput();
  };

  const handleStreamEvent = (event) => {
    if (!event || typeof event !== 'object') return;

    const eventType = event.type;
    if (eventType === 'message_start') {
      state.currentMessageHadTextDelta = false;
      return;
    }

    if (eventType === 'content_block_start') {
      const contentBlock = event.content_block ?? {};
      if (contentBlock.type === 'tool_use') {
        state.currentToolName = contentBlock.name || 'unknown';
        state.currentToolInput = '';
        writeLine(`[${label}] Claude 调用工具: ${state.currentToolName}`);
      }
      return;
    }

    if (eventType === 'content_block_delta') {
      const delta = event.delta ?? {};
      if (delta.type === 'text_delta') {
        state.currentMessageHadTextDelta = true;
        writeText(delta.text || '');
        return;
      }

      if (delta.type === 'input_json_delta' && state.currentToolName) {
        state.currentToolInput += delta.partial_json || '';
      }
      return;
    }

    if (eventType === 'content_block_stop') {
      if (state.currentToolName) {
        const summary = summarizeJsonSnippet(state.currentToolInput);
        if (summary) {
          writeLine(`[${label}] 工具输入: ${summary}`);
        }
        state.currentToolName = null;
        state.currentToolInput = '';
        return;
      }

      ensureTextBoundary();
      return;
    }

    if (eventType === 'message_stop') {
      ensureTextBoundary();
    }
  };

  const handleJsonMessage = (message) => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'stream_event') {
      handleStreamEvent(message.event);
      return;
    }

    if (message.type === 'assistant') {
      if (!state.currentMessageHadTextDelta) {
        const text = extractAssistantText(message.message);
        if (text) {
          writeLine(text.trimEnd());
        }
      }
      return;
    }

    if (message.type === 'tool_progress') {
      const toolKey = message.tool_use_id || message.tool_name || 'tool';
      const now = Date.now();
      const lastSeen = state.toolProgressSeenAt.get(toolKey) ?? 0;
      if (now - lastSeen >= 10000) {
        const seconds = Math.round(message.elapsed_time_seconds || 0);
        writeLine(`[${label}] 工具执行中: ${message.tool_name} (${seconds}s)`);
        state.toolProgressSeenAt.set(toolKey, now);
      }
      return;
    }

    if (message.type === 'system') {
      if (message.subtype === 'init') {
        const skillCount = Array.isArray(message.skills) ? message.skills.length : 0;
        const model = message.model || 'unknown';
        writeLine(`[${label}] Claude 会话已启动，模型: ${model}，skills: ${skillCount}`);
        return;
      }

      if (message.subtype === 'status' && message.status) {
        writeLine(`[${label}] 状态更新: ${message.status}`);
        return;
      }

      if (message.subtype === 'task_started' && message.description) {
        writeLine(`[${label}] 后台任务开始: ${message.description}`);
        return;
      }

      if (message.subtype === 'task_progress' && message.description) {
        writeLine(`[${label}] 后台任务进行中: ${message.description}`);
        return;
      }

      if (message.subtype === 'task_notification' && message.summary) {
        writeLine(`[${label}] 后台任务${message.status}: ${message.summary}`);
        return;
      }

      return;
    }

    if (message.type === 'auth_status') {
      const output = Array.isArray(message.output) ? message.output.join(' ') : '';
      if (output) writeLine(`[${label}] 认证状态: ${output}`);
      if (message.error) writeLine(`[${label}] 认证错误: ${message.error}`, process.stderr);
      return;
    }

    if (message.type === 'rate_limit_event') {
      const status = message.rate_limit_info?.status;
      if (status) writeLine(`[${label}] 速率限制状态: ${status}`);
      return;
    }

    if (message.type === 'result') {
      ensureTextBoundary();
      if (message.subtype !== 'success' && Array.isArray(message.errors)) {
        for (const errorMessage of message.errors) {
          writeLine(`[${label}] ${errorMessage}`, process.stderr);
        }
      }

      if (typeof message.duration_ms === 'number' || typeof message.total_cost_usd === 'number') {
        const seconds = typeof message.duration_ms === 'number'
          ? Math.max(1, Math.round(message.duration_ms / 1000))
          : null;
        const cost = typeof message.total_cost_usd === 'number'
          ? message.total_cost_usd.toFixed(4)
          : null;
        const parts = [];
        if (typeof message.num_turns === 'number') parts.push(`${message.num_turns} 轮`);
        if (seconds !== null) parts.push(`${seconds}s`);
        if (cost !== null) parts.push(`$${cost}`);
        if (parts.length) writeLine(`[${label}] Claude 结束: ${parts.join(' / ')}`);
      }
      return;
    }
  };

  const flushStdoutLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      handleJsonMessage(JSON.parse(trimmed));
    } catch {
      writeLine(trimmed);
    }
  };

  return {
    handleStdoutChunk(chunk) {
      state.stdoutBuffer += chunk;

      let newlineIndex = state.stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = state.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
        state.stdoutBuffer = state.stdoutBuffer.slice(newlineIndex + 1);
        flushStdoutLine(line);
        newlineIndex = state.stdoutBuffer.indexOf('\n');
      }
    },
    handleStdoutEnd() {
      const tail = state.stdoutBuffer.replace(/\r$/, '');
      state.stdoutBuffer = '';
      flushStdoutLine(tail);
      ensureTextBoundary();
    },
    handleStderrChunk(chunk) {
      ensureTextBoundary();
      process.stderr.write(chunk);
      noteVisibleOutput();
    },
    maybeEmitIdleNotice() {
      const silenceMs = Date.now() - state.lastVisibleOutputAt;
      if (silenceMs >= 15000) {
        writeLine(`[${label}] Claude Code 正在处理，等待下一条输出...`);
      }
    },
    finish() {
      ensureTextBoundary();
    },
  };
}

function buildRuntimeArgs({ cwd, runner, model, prompt, targetRoot }) {
  if (runner === 'opencode') {
    const args = ['run', '--print-logs'];
    if (model) args.push('--model', model);
    args.push(prompt);
    return args;
  }

  if (runner === 'codex') {
    const args = ['exec', '-s', 'danger-full-access', '--skip-git-repo-check'];
    if (model) args.push('--model', model);
    if (!isUnderCwd(cwd, targetRoot)) {
      args.push('--add-dir', targetRoot);
    }
    args.push('-');
    return args;
  }

  if (runner === 'claude') {
    const args = ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'];
    if (model) args.push('--model', model);
    if (!isUnderCwd(cwd, targetRoot)) {
      args.push('--add-dir', targetRoot);
    }
    return args;
  }

  throw new Error(`错误：不支持的运行方式: ${runner}`);
}

function formatConfigMode(runner, globalConfig) {
  if (runner === 'opencode') {
    return globalConfig ? 'global' : 'project-local';
  }
  return 'default';
}

function runAgentStep({ cwd, env, runner, model, prompt, label, targetRoot }) {
  return new Promise((resolveStep, rejectStep) => {
    const runtimeConfig = getRuntimeConfig(runner);
    const manageOutput = runnerUsesManagedOutput(runner);
    const args = buildRuntimeArgs({
      cwd,
      runner,
      model,
      prompt,
      targetRoot,
    });

    console.log(`[${label}] 开始执行 ${runtimeConfig.label}...`);
    console.log('');

    const proc = spawn(runtimeConfig.command, args, {
      cwd,
      env,
      stdio: manageOutput
        ? ['pipe', 'pipe', 'pipe']
        : (runnerUsesStdin(runner) ? ['pipe', 'inherit', 'inherit'] : 'inherit'),
      shell: true,
    });

    if (runnerUsesStdin(runner) && proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    let claudeOutput = null;
    let idleTimer = null;
    if (manageOutput) {
      claudeOutput = createClaudeOutputManager(label);

      if (proc.stdout) {
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => {
          claudeOutput.handleStdoutChunk(chunk);
        });
        proc.stdout.on('end', () => {
          claudeOutput.handleStdoutEnd();
        });
      }

      if (proc.stderr) {
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk) => {
          claudeOutput.handleStderrChunk(chunk);
        });
      }

      idleTimer = setInterval(() => {
        claudeOutput.maybeEmitIdleNotice();
      }, 15000);
    }

    proc.on('error', (error) => {
      if (idleTimer) clearInterval(idleTimer);
      claudeOutput?.finish();
      rejectStep(new Error(`[${label}] 启动 ${runtimeConfig.label} 失败: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (idleTimer) clearInterval(idleTimer);
      claudeOutput?.finish();
      if (code === 0) {
        console.log('');
        console.log(`[${label}] 已完成。`);
        console.log('');
        resolveStep();
        return;
      }
      rejectStep(new Error(`[${label}] 失败，${runtimeConfig.label} 退出码: ${code ?? 'unknown'}`));
    });
  });
}

function cleanupSymlink(symlinkPath) {
  if (!symlinkPath || !existsSync(symlinkPath)) return;

  try {
    unlinkSync(symlinkPath);
  } catch (error) {
    console.warn('移除软链接失败:', symlinkPath, error.message);
  }
}

async function main() {
  const { model, runner, target, globalConfig, printPrompt, mode, verifyMode, scope, changedFiles } = parseArgs();
  const runtimeConfig = getRuntimeConfig(runner);
  const targetRoot = resolve(process.cwd(), target);

  if (!runtimeConfig) {
    console.error('错误：--runner 仅支持 opencode、codex、claude，当前值为:', runner);
    process.exit(1);
  }

  if (!existsSync(targetRoot)) {
    console.error('错误：目标目录不存在:', targetRoot);
    process.exit(1);
  }

  if (!['full', 'incremental'].includes(mode)) {
    console.error('错误：--mode 仅支持 full 或 incremental，当前值为:', mode);
    process.exit(1);
  }

  if (mode === 'incremental' && changedFiles.length === 0 && !scope) {
    console.error('错误：增量模式下至少提供一个 --changed <file> 或 --scope <text>');
    process.exit(1);
  }

  const sourceSkillsDir = resolveSourceSkillsDir();
  if (!sourceSkillsDir) {
    console.error('错误：未找到 Skill 模板源目录。请确认项目内存在 widget-knowledge-* Skill，或通过 WIDGET_SKILLS_DIR 显式指定。');
    process.exit(1);
  }

  const cwd = process.cwd();
  const { knowledgeSkillRoot, referencesDir } = resolveKnowledgeLocations(cwd, runner);
  mkdirSync(referencesDir, { recursive: true });

  if (!printPrompt) {
    ensureSkillsInCwd(cwd, sourceSkillsDir, runner);
  }

  const verifyEnabled = shouldRunVerification(mode, verifyMode);
  const symlinkPath = printPrompt ? null : ensureSymlink(cwd, targetRoot);
  const analyzePath = printPrompt ? targetRoot : (symlinkPath || targetRoot);
  const promptVariables = buildPromptVariables({
    mode,
    analyzePath,
    changedFiles,
    scope,
    knowledgeSkillRoot,
    referencesDir,
    workspaceRoot: cwd,
    sourceSkillsDir,
    verifyEnabled,
  });
  const runtimeEnv = buildRuntimeEnv(cwd, runner, globalConfig);

  if (printPrompt) {
    console.log(buildDirectPrompt(mode, promptVariables));
    return;
  }

  console.log('分析项目:', targetRoot);
  console.log('运行方式:', runtimeConfig.label);
  console.log('执行模式:', mode);
  console.log('Skill 模板源目录:', sourceSkillsDir);
  if (symlinkPath) console.log('软链接:', symlinkPath, '->', targetRoot);
  console.log('知识库 Skill 目录:', knowledgeSkillRoot);
  console.log('输出目录:', referencesDir);
  if (mode === 'incremental' && changedFiles.length) console.log('变更文件:', changedFiles.join(', '));
  if (mode === 'incremental' && scope) console.log('范围说明:', scope);
  console.log('检查补全:', formatVerificationStatus(mode, verifyMode, verifyEnabled));
  console.log('配置模式:', formatConfigMode(runner, globalConfig));
  if (model) console.log('模型:', model);
  console.log('');

  try {
    await runAgentStep({
      cwd,
      env: runtimeEnv,
      runner,
      model,
      prompt: buildPrimaryPrompt({ mode, promptVariables, runner }),
      label: mode === 'incremental' ? '增量同步' : '全量生成',
      targetRoot,
    });

    if (verifyEnabled) {
      await runAgentStep({
        cwd,
        env: runtimeEnv,
        runner,
        model,
        prompt: buildVerificationPrompt(mode, promptVariables, runner),
        label: '检查补全',
        targetRoot,
      });
    }
  } finally {
    cleanupSymlink(symlinkPath);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
