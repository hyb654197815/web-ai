const globalObject = typeof window !== 'undefined' ? window : globalThis;

const DEFAULT_ADMIN_STATE = Object.freeze({
  loadBalancing: { enabled: true, strategy: 'round_robin' },
  models: [],
  mcpServers: [],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeList(value, fallback) {
  return Array.isArray(value) ? value : clone(fallback);
}

function normalizeState(payload) {
  const fallback = clone(DEFAULT_ADMIN_STATE);
  if (!payload || typeof payload !== 'object') return fallback;
  return {
    loadBalancing:
      payload.loadBalancing && typeof payload.loadBalancing === 'object' ? payload.loadBalancing : fallback.loadBalancing,
    models: normalizeList(payload.models, fallback.models),
    mcpServers: normalizeList(payload.mcpServers, fallback.mcpServers),
  };
}

function statusLabel(status) {
  if (status === 'available') return '可用';
  if (status === 'unavailable') return '不可用';
  if (status === 'disabled') return '已停用';
  return '未检测';
}

function statusClass(status) {
  if (status === 'available') return 'ok';
  if (status === 'unavailable') return 'bad';
  if (status === 'disabled') return 'off';
  return 'warn';
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeMcpEditorPayload(payload) {
  if (payload?.mcpServers && typeof payload.mcpServers === 'object' && !Array.isArray(payload.mcpServers)) {
    return Object.entries(payload.mcpServers)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([name, value]) => ({ name, ...value }));
  }
  if (Array.isArray(payload?.mcpServers)) {
    return payload.mcpServers.filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  }
  return [payload];
}

const AUTO_PROBE_INTERVAL_MS = 60000;
const MODEL_PROVIDERS = Object.freeze(['OpenAI Compatible', 'Anthropic']);

export const AIAgentAdmin = {
  host: null,
  shadowRoot: null,
  state: clone(DEFAULT_ADMIN_STATE),
  activeView: 'mcp',
  backendUrl: 'http://localhost:4096/api',
  busy: false,
  mcpFormEditor: null,
  modelFormEditor: null,
  autoProbeTimer: null,
  autoProbeRunning: false,

  open(options = {}) {
    if (typeof document === 'undefined') return this;
    if (typeof options.backendUrl === 'string' && options.backendUrl.trim()) {
      this.backendUrl = options.backendUrl.trim();
    }
    this.ensure();
    this.host.hidden = false;
    this.refresh().catch(() => {
      this.render();
    });
    this.startAutoProbe();
    return this;
  },

  close() {
    if (this.host) this.host.hidden = true;
    this.stopAutoProbe();
    return this;
  },

  ensure() {
    if (this.host) return;
    this.host = document.createElement('div');
    this.host.className = 'ai-agent-admin-host';
    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${this.styles()}</style><div class="admin-root"></div>`;
    document.body.appendChild(this.host);
    this.shadowRoot.addEventListener('click', (event) => this.handleClick(event));
    this.shadowRoot.addEventListener('input', (event) => this.handleInput(event));
    this.shadowRoot.addEventListener('change', (event) => this.handleChange(event));
  },

  async request(path, options = {}) {
    const response = await fetch(`${trimSlash(this.backendUrl)}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  },

  async refresh() {
    this.setBusy(true);
    try {
      const data = await this.request('/admin/config');
      this.state = normalizeState(data);
      this.writeLocalState(this.state);
    } catch (error) {
      const cached = this.readLocalState();
      if (cached) {
        this.state = normalizeState(cached);
        this.toast(`后端配置读取失败，已使用本地缓存：${error.message}`);
      } else {
        this.state = normalizeState(null);
        this.toast(`后端配置读取失败：${error.message}`);
      }
    } finally {
      this.setBusy(false);
      this.render();
    }
  },

  startAutoProbe() {
    this.stopAutoProbe();
    this.autoProbeTimer = globalObject.setInterval(() => {
      this.probeAll({ persist: true }).catch(() => {});
    }, AUTO_PROBE_INTERVAL_MS);
    globalObject.setTimeout(() => {
      this.probeAll({ persist: true }).catch(() => {});
    }, 800);
  },

  stopAutoProbe() {
    if (this.autoProbeTimer) {
      globalObject.clearInterval(this.autoProbeTimer);
      this.autoProbeTimer = null;
    }
  },

  async probeAll(options = {}) {
    if (this.autoProbeRunning) return;
    this.autoProbeRunning = true;
    try {
      for (const model of [...this.state.models]) {
        if (model.enabled !== false) {
          await this.probeModel(model.id, { persist: false, quiet: true });
        }
      }
      for (const server of [...this.state.mcpServers]) {
        if (server.enabled !== false) {
          await this.probeMcp(server.name, { quiet: true, persist: false });
        }
      }
      if (options.persist) {
        await this.save({ silent: true });
      }
    } finally {
      this.autoProbeRunning = false;
      this.render();
    }
  },

  async save(options = {}) {
    this.setBusy(true);
    try {
      const saved = await this.request('/admin/config', {
        method: 'POST',
        body: JSON.stringify(this.state),
      });
      this.state = normalizeState(saved);
      this.writeLocalState(this.state);
      if (!options.silent) this.toast(options.probeAfterSave ? '配置已保存，正在检测可用性...' : '配置已保存');
    } catch (error) {
      this.writeLocalState(this.state);
      if (!options.silent) this.toast(`后端保存失败，已写入本地缓存：${error.message}`);
    } finally {
      this.setBusy(false);
      this.render();
    }
    if (options.probeAfterSave) {
      await this.probeAll({ persist: true });
      if (!options.silent) this.toast('可用性检测完成');
    }
  },

  async probeModel(id, options = {}) {
    const model = this.state.models.find((item) => item.id === id);
    if (!model) return;
    this.setModelStatus(id, 'unknown', '检测中...', { render: !options.quiet });
    try {
      const result = await this.request('/admin/models/probe', {
        method: 'POST',
        body: JSON.stringify({ model }),
      });
      this.setModelStatus(id, result.status || 'unknown', result.lastError || '', { render: !options.quiet });
      if (result.latencyMs != null) model.latencyMs = result.latencyMs;
      if (options.persist !== false) await this.save({ silent: options.quiet });
    } catch (error) {
      this.setModelStatus(id, 'unavailable', error.message, { render: !options.quiet });
      if (options.persist !== false) await this.save({ silent: options.quiet });
    }
  },

  async probeMcp(name, options = {}) {
    const server = this.state.mcpServers.find((item) => item.name === name);
    if (!server) return;
    server.status = 'unknown';
    server.error = '检测中...';
    if (!options.quiet) this.render();
    try {
      const result = await this.request('/admin/mcp/probe', {
        method: 'POST',
        body: JSON.stringify({ server }),
      });
      Object.assign(server, {
        status: result.status || 'unknown',
        toolsCount: result.toolsCount || 0,
        resourcesCount: result.resourcesCount || 0,
        promptsCount: result.promptsCount || 0,
        error: result.error || '',
      });
    } catch (error) {
      Object.assign(server, {
        status: 'unavailable',
        error: error.message,
        toolsCount: 0,
        resourcesCount: 0,
        promptsCount: 0,
      });
    }
    if (options.persist !== false) await this.save({ silent: options.quiet });
    if (!options.quiet) this.render();
  },

  setModelStatus(id, status, lastError = '', options = {}) {
    const model = this.state.models.find((item) => item.id === id);
    if (!model) return;
    model.status = status;
    model.lastError = lastError;
    model.lastCheckedAt = new Date().toISOString();
    if (options.render !== false) this.render();
  },

  setBusy(value) {
    this.busy = value;
    const root = this.shadowRoot?.querySelector('.admin-root');
    if (root) root.classList.toggle('is-busy', value);
  },

  readLocalState() {
    try {
      return JSON.parse(globalObject.localStorage?.getItem('ai-agent-admin-config') || 'null');
    } catch {
      return null;
    }
  },

  writeLocalState(value) {
    try {
      globalObject.localStorage?.setItem('ai-agent-admin-config', JSON.stringify(value));
    } catch {}
  },

  toast(message) {
    const root = this.shadowRoot?.querySelector('.admin-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    root.appendChild(el);
    globalObject.setTimeout(() => el.remove(), 2600);
  },

  handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const actionEl = target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    const id = actionEl.getAttribute('data-id') || '';

    if (action === 'close') this.close();
    if (action === 'view') {
      this.activeView = id;
      this.render();
    }
    if (action === 'save') this.save({ probeAfterSave: true });
    if (action === 'refresh') this.refresh();
    if (action === 'toggle-mcp') this.toggleMcp(id);
    if (action === 'add-mcp') this.addMcp();
    if (action === 'edit-mcp' || action === 'edit-mcp-json') this.editMcp(id);
    if (action === 'save-mcp' || action === 'save-mcp-json') this.saveMcp();
    if (action === 'cancel-mcp') this.closeMcp();
    if (action === 'probe-mcp') this.probeMcp(id);
    if (action === 'remove-mcp') this.removeMcp(id);
    if (action === 'toggle-model') this.toggleModel(id);
    if (action === 'add-model') this.addModel();
    if (action === 'edit-model') this.editModel(id);
    if (action === 'save-model') this.saveModel();
    if (action === 'cancel-model') this.closeModel();
    if (action === 'remove-model') this.removeModel(id);
    if (action === 'probe-model') this.probeModel(id);
    if (action === 'toggle-lb') {
      this.state.loadBalancing.enabled = !this.state.loadBalancing.enabled;
      this.render();
    }
  },

  handleInput(event) {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target) return;
    const role = target.getAttribute('data-role');
    if (role === 'mcp-json-input' && this.mcpFormEditor) {
      this.mcpFormEditor.value = target.value;
      return;
    }
    const bind = target.getAttribute('data-bind');
    if (!bind) return;
    this.updateBinding(bind, target.type === 'number' ? Number(target.value) : target.value);
  },

  handleChange(event) {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    const bind = target.getAttribute('data-bind');
    if (!bind) return;
    this.updateBinding(bind, target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target.value);
    this.render();
  },

  updateBinding(bind, value) {
    const [group, id, key] = bind.split('.');
    if (group === 'model') {
      const model = this.state.models.find((item) => item.id === id);
      if (model) model[key] = value;
    }
    if (group === 'modelForm') {
      if (this.modelFormEditor) this.modelFormEditor[id] = value;
    }
    if (group === 'mcp') {
      const server = this.state.mcpServers.find((item) => item.name === id);
      if (server) {
        if (key === 'args') server.args = String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
        else if (key === 'env') server.env = this.parseEnv(value);
        else server[key] = value;
      }
    }
    if (group === 'mcpForm') {
      if (this.mcpFormEditor) {
        if (id === 'args') this.mcpFormEditor.args = String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
        else if (id === 'env') this.mcpFormEditor.env = this.parseEnv(value);
        else this.mcpFormEditor[id] = value;
      }
    }
    if (group === 'mcpIndex') {
      const server = this.state.mcpServers[Number(id)];
      if (server) {
        if (key === 'args') server.args = String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
        else if (key === 'env') server.env = this.parseEnv(value);
        else server[key] = value;
      }
    }
    if (group === 'lb') {
      this.state.loadBalancing[id] = value;
    }
  },

  parseEnv(value) {
    return String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((env, line) => {
        const index = line.indexOf('=');
        if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
        return env;
      }, {});
  },

  toggleMcp(name) {
    const server = this.state.mcpServers.find((item) => item.name === name);
    if (!server) return;
    server.enabled = !server.enabled;
    server.status = server.enabled ? 'unknown' : 'disabled';
    this.render();
  },

  addMcp() {
    const name = `mcp-${this.state.mcpServers.length + 1}`;
    this.mcpFormEditor = {
      originalName: '',
      value: prettyJson({
        mcpServers: {
          [name]: {
            enabled: true,
            command: 'node',
            args: [],
            cwd: '${PROJECT_ROOT}',
            env: {},
            timeoutSeconds: 8,
          },
        },
      }),
    };
    this.render();
  },

  editMcp(name) {
    const server = this.state.mcpServers.find((item) => item.name === name);
    if (!server) return;
    this.mcpFormEditor = {
      originalName: server.name,
      value: prettyJson({
        mcpServers: {
          [server.name]: {
            enabled: server.enabled !== false,
            type: server.type || (server.url ? 'streamable_http' : 'stdio'),
            ...(server.url
              ? {
                  url: server.url,
                  headers: server.headers && typeof server.headers === 'object' ? { ...server.headers } : {},
                }
              : {
                  command: server.command || '',
                  args: Array.isArray(server.args) ? [...server.args] : [],
                  cwd: server.cwd || '',
                  env: server.env && typeof server.env === 'object' ? { ...server.env } : {},
                }),
            timeoutSeconds: server.timeoutSeconds || 8,
          },
        },
      }),
    };
    this.render();
  },

  parseJsonEditor(value, label) {
    try {
      const parsed = JSON.parse(String(value || ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.toast(`${label} 必须是 JSON 对象`);
        return null;
      }
      return parsed;
    } catch (error) {
      this.toast(`${label} JSON 格式错误：${error.message}`);
      return null;
    }
  },

  async saveMcp() {
    if (!this.mcpFormEditor) return;

    const parsed = this.parseJsonEditor(this.mcpFormEditor.value, 'MCP Server');
    if (!parsed) return;

    const parsedServers = normalizeMcpEditorPayload(parsed);
    const nextServers = parsedServers.map((server) => this.normalizeMcpServer(server)).filter(Boolean);
    if (!nextServers.length) {
      this.toast('MCP Server JSON 至少需要包含一个有效 server');
      return;
    }

    const originalName = this.mcpFormEditor.originalName;
    if (originalName) {
      this.state.mcpServers = this.state.mcpServers.filter((item) => item.name !== originalName);
    }
    for (const nextServer of nextServers) {
      const existingIndex = this.state.mcpServers.findIndex((item) => item.name === nextServer.name);
      if (existingIndex >= 0) {
        this.state.mcpServers.splice(existingIndex, 1, nextServer);
      } else {
        this.state.mcpServers.push(nextServer);
      }
    }
    this.mcpFormEditor = null;
    this.render();
    this.toast('MCP Server 已保存，正在检测...');
    await this.save({ silent: true });
    for (const nextServer of nextServers) {
      if (nextServer.enabled) {
        await this.probeMcp(nextServer.name, { persist: false });
      }
    }
    await this.save({ silent: true });
  },

  normalizeMcpServer(server) {
    const name = String(server.name || '').trim();
    if (!name) return null;
    const type = String(server.type || (server.url ? 'streamable_http' : 'stdio')).trim().toLowerCase() || 'stdio';
    const isHttp = ['streamable_http', 'http', 'sse'].includes(type);
    return {
      name,
      enabled: server.enabled !== false,
      type,
      ...(isHttp
        ? {
            url: String(server.url || '').trim(),
            headers: server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers) ? server.headers : {},
          }
        : {
            command: String(server.command || '').trim(),
            args: Array.isArray(server.args) ? server.args.map((item) => String(item)) : [],
            cwd: String(server.cwd || '').trim(),
            env: server.env && typeof server.env === 'object' && !Array.isArray(server.env) ? server.env : {},
          }),
      timeoutSeconds: Number(server.timeoutSeconds || server.timeout_seconds || 8),
      status: 'unknown',
      toolsCount: 0,
      resourcesCount: 0,
      promptsCount: 0,
    };
  },

  closeMcp() {
    this.mcpFormEditor = null;
    this.render();
  },

  removeMcp(name) {
    this.state.mcpServers = this.state.mcpServers.filter((item) => item.name !== name);
    this.render();
  },

  toggleModel(id) {
    const model = this.state.models.find((item) => item.id === id);
    if (!model) return;
    model.enabled = !model.enabled;
    this.render();
  },

  addModel() {
    const id = makeId('model');
    this.modelFormEditor = {
      originalId: '',
      id,
      name: 'New Model',
      model: '',
      provider: 'OpenAI Compatible',
      baseURL: '',
      apiKey: '',
      enabled: true,
      weight: 1,
    };
    this.render();
  },

  editModel(id) {
    const model = this.state.models.find((item) => item.id === id);
    if (!model) return;
    this.modelFormEditor = {
      originalId: model.id,
      id: model.id,
      name: model.name || '',
      model: model.model || '',
      provider: MODEL_PROVIDERS.includes(model.provider) ? model.provider : 'OpenAI Compatible',
      baseURL: model.baseURL || '',
      apiKey: model.apiKey || '',
      enabled: model.enabled !== false,
      weight: model.weight || 1,
    };
    this.render();
  },

  async saveModel() {
    if (!this.modelFormEditor) return;

    const modelId = String(this.modelFormEditor.model || '').trim();
    const provider = String(this.modelFormEditor.provider || 'OpenAI Compatible').trim();
    if (!modelId) {
      this.toast('模型 ID 不能为空');
      return;
    }
    if (!MODEL_PROVIDERS.includes(provider)) {
      this.toast('provider 只能是 OpenAI Compatible 或 Anthropic');
      return;
    }

    const nextModel = {
      id: String(this.modelFormEditor.id || modelId).trim() || makeId('model'),
      name: String(this.modelFormEditor.name || modelId).trim(),
      model: modelId,
      provider,
      baseURL: String(this.modelFormEditor.baseURL || '').trim(),
      apiKey: String(this.modelFormEditor.apiKey || '').trim(),
      enabled: this.modelFormEditor.enabled !== false,
      weight: Math.max(1, Number(this.modelFormEditor.weight || 1)),
      status: 'unknown',
      latencyMs: null,
      lastError: '',
    };

    const originalId = this.modelFormEditor.originalId;
    const existingIndex = this.state.models.findIndex((item) => item.id === (originalId || nextModel.id));
    if (existingIndex >= 0) {
      this.state.models.splice(existingIndex, 1, nextModel);
    } else {
      this.state.models.unshift(nextModel);
    }
    this.modelFormEditor = null;
    this.render();
    this.toast('模型已保存，正在检测...');
    await this.save({ silent: true });
    if (nextModel.enabled) {
      await this.probeModel(nextModel.id);
    }
  },

  closeModel() {
    this.modelFormEditor = null;
    this.render();
  },

  removeModel(id) {
    this.state.models = this.state.models.filter((item) => item.id !== id);
    this.render();
  },

  styles() {
    return `
      :host { all: initial; }
      .admin-root, .admin-root * {
        box-sizing: border-box;
        font-family: "SF Pro Display", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      .admin-root {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: block;
        background: rgba(0, 0, 0, 0.72);
        color: #d8d8d8;
      }
      .admin-shell {
        width: 100vw;
        height: 100vh;
        display: grid;
        grid-template-columns: 236px minmax(0, 1fr);
        overflow: hidden;
        border: 0;
        border-radius: 0;
        background: #151515;
        box-shadow: none;
      }
      .sidebar {
        padding: 34px 24px;
        border-right: 1px solid #242424;
        background: #121313;
      }
      .nav-section {
        padding: 8px 0 12px;
        border-bottom: 1px solid #252525;
      }
      .sidebar-title {
        margin: 0 0 18px;
        color: #eeeeee;
        font-size: 15px;
        font-weight: 700;
      }
      .nav-item {
        width: 100%;
        height: 28px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 8px;
        border: 0;
        border-radius: 4px;
        color: #aaa;
        background: transparent;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .nav-item:hover, .nav-item.active {
        color: #f0f0f0;
        background: #242424;
      }
      .nav-icon {
        width: 14px;
        color: #98a6bd;
        text-align: center;
      }
      .content {
        min-width: 0;
        overflow: auto;
        padding: 40px 48px 56px;
        background: #181818;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }
      h1 {
        margin: 0;
        color: #e8e8e8;
        font-size: 18px;
        line-height: 1.3;
        font-weight: 650;
      }
      .subtitle {
        margin: 6px 0 0;
        color: #888;
        font-size: 12px;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      .btn {
        height: 30px;
        padding: 0 12px;
        border: 1px solid #333;
        border-radius: 4px;
        color: #d0d0d0;
        background: #242424;
        font-size: 12px;
        cursor: pointer;
      }
      .btn:hover { background: #2b2b2b; }
      .btn.primary {
        color: #ffffff;
        border-color: #3e7f58;
        background: #2e8b57;
      }
      .settings-card {
        overflow: hidden;
        border: 1px solid #252525;
        border-radius: 8px;
        background: #1e1e1e;
      }
      .settings-card + .settings-card { margin-top: 16px; }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 56px;
        padding: 12px 16px;
        border-bottom: 1px solid #2d2d2d;
      }
      .card-header:last-child { border-bottom: 0; }
      .section-label {
        margin: 20px 0 9px;
        color: #8e8e8e;
        font-size: 12px;
        font-weight: 650;
      }
      .row-title {
        color: #d8d8d8;
        font-size: 13px;
        font-weight: 650;
      }
      .row-desc {
        margin-top: 4px;
        color: #858585;
        font-size: 12px;
        line-height: 1.4;
      }
      .toggle {
        width: 30px;
        height: 18px;
        padding: 2px;
        border: 0;
        border-radius: 999px;
        background: #5b5b5b;
        cursor: pointer;
      }
      .toggle::before {
        content: "";
        display: block;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        background: #fff;
        transition: transform 140ms ease;
      }
      .toggle.on { background: #43b877; }
      .toggle.on::before { transform: translateX(12px); }
      .mcp-row, .model-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        min-height: 60px;
        padding: 10px 12px;
        border-bottom: 1px solid #2a2a2a;
      }
      .mcp-row:last-child, .model-row:last-child { border-bottom: 0; }
      .mcp-row.add-row {
        cursor: pointer;
      }
      .mcp-row.add-row:hover {
        background: #242424;
      }
      .server-mark {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        display: grid;
        place-items: center;
        color: #b7b7b7;
        background: #2b2d2f;
        font-size: 13px;
        text-transform: uppercase;
      }
      .status-line {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 4px;
        color: #858585;
        font-size: 12px;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #848484;
      }
      .dot.ok { background: #43b877; }
      .dot.warn { background: #d4aa33; }
      .dot.bad { background: #e06464; }
      .dot.off { background: #737373; }
      .inline-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .link-btn {
        border: 0;
        color: #6ca4d9;
        background: transparent;
        font-size: 12px;
        cursor: pointer;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid #2a2a2a;
      }
      .lb-grid {
        grid-template-columns: minmax(0, 1fr);
        border-bottom: 0;
      }
      .field {
        min-width: 0;
      }
      .field.full { grid-column: 1 / -1; }
      .field label {
        display: block;
        margin-bottom: 6px;
        color: #8e8e8e;
        font-size: 11px;
      }
      .field input, .field textarea, .field select {
        width: 100%;
        min-height: 31px;
        border: 1px solid #303030;
        border-radius: 4px;
        color: #d7d7d7;
        background: #242424;
        font-size: 12px;
        outline: none;
      }
      .field input, .field select { padding: 0 9px; }
      .field textarea {
        min-height: 68px;
        padding: 8px 9px;
        resize: vertical;
      }
      .model-toolbar {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-bottom: 14px;
      }
      .model-toolbar input {
        height: 32px;
        padding: 0 12px;
        border: 1px solid #303030;
        border-radius: 4px;
        color: #cfcfcf;
        background: #242424;
        font-size: 12px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #a6a6a6;
        font-size: 12px;
      }
      .toast {
        position: fixed;
        right: 30px;
        bottom: 30px;
        max-width: 420px;
        padding: 10px 12px;
        border: 1px solid #303030;
        border-radius: 6px;
        color: #e7e7e7;
        background: #252525;
        box-shadow: 0 16px 42px rgba(0, 0, 0, 0.36);
        font-size: 12px;
      }
      .json-dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.58);
      }
      .json-dialog {
        width: min(760px, calc(100vw - 48px));
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #303030;
        border-radius: 8px;
        background: #1b1b1b;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
      }
      .json-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
        border-bottom: 1px solid #2b2b2b;
      }
      .json-dialog-title {
        color: #e8e8e8;
        font-size: 14px;
        font-weight: 650;
      }
      .form-editor {
        flex: 1;
        overflow-y: auto;
        background: #151515;
      }
      .json-editor {
        width: 100%;
        min-height: 420px;
        padding: 14px 16px;
        border: 0;
        color: #dcdcdc;
        background: #151515;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        line-height: 1.65;
        outline: none;
        resize: vertical;
      }
      .json-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid #2b2b2b;
      }
      @media (max-width: 760px) {
        .admin-shell {
          grid-template-columns: 1fr;
          height: 100vh;
          width: 100vw;
        }
        .sidebar {
          padding: 14px;
          border-right: 0;
          border-bottom: 1px solid #242424;
        }
        .content { padding: 20px 16px 30px; }
        .nav-section {
          display: flex;
          gap: 6px;
          overflow-x: auto;
        }
        .nav-item { flex: 0 0 auto; width: auto; }
        .form-grid { grid-template-columns: 1fr; }
        .json-dialog {
          width: calc(100vw - 24px);
          max-height: calc(100vh - 24px);
        }
        .json-editor {
          min-height: 320px;
        }
      }
    `;
  },

  render() {
    const root = this.shadowRoot?.querySelector('.admin-root');
    if (!root) return;
    root.innerHTML = `
      <div class="admin-shell">
        ${this.renderSidebar()}
        <main class="content">
          ${this.renderTopbar()}
          ${this.activeView === 'models' ? this.renderModels() : this.renderMcp()}
        </main>
      </div>
      ${this.renderMcpFormEditor()}
      ${this.renderModelFormEditor()}
    `;
  },

  renderSidebar() {
    const items = [
      ['models', '#', 'Models'],
      ['mcp', '&', 'Tools & MCP'],
    ];
    return `
      <aside class="sidebar">
        <div class="sidebar-title">Agent Settings</div>
        <div class="nav-section">
          ${items
            .map(
              ([id, icon, label]) => `
                <button class="nav-item ${this.activeView === id ? 'active' : ''}" data-action="view" data-id="${id}">
                  <span class="nav-icon">${escapeHTML(icon)}</span>
                  <span>${escapeHTML(label)}</span>
                </button>
              `
            )
            .join('')}
        </div>
      </aside>
    `;
  },

  renderTopbar() {
    const title = this.activeView === 'models' ? 'Models' : 'Tools';
    const subtitle =
      this.activeView === 'models'
        ? '配置多模型池，检测可用性，并在模型不可用时跳过到其他可用模型。'
        : '配置 MCP Server，查看工具、资源、Prompt 与运行状态。';
    return `
      <div class="topbar">
        <div>
          <h1>${title}</h1>
          <p class="subtitle">${subtitle}</p>
        </div>
        <div class="actions">
          <button class="btn" data-action="refresh" type="button">刷新</button>
          <button class="btn primary" data-action="save" type="button">保存</button>
        </div>
      </div>
    `;
  },

  renderMcp() {
    return `
      <div class="section-label">Installed MCP Servers</div>
      <section class="settings-card">
        ${this.state.mcpServers.map((server, index) => this.renderMcpServer(server, index)).join('')}
        <div class="mcp-row add-row" data-action="add-mcp">
          <div class="server-mark">+</div>
          <div><div class="row-title">New MCP Server</div><div class="row-desc">Add a Custom MCP Server</div></div>
          <button class="btn" type="button">添加</button>
        </div>
      </section>
    `;
  },

  renderMcpServer(server, index) {
    const initial = String(server.name || 'M').slice(0, 1);
    const errorText = server.error ? `<span title="${escapeHTML(server.error)}">${escapeHTML(server.error)}</span>` : '';
    return `
      <div class="mcp-row">
        <div class="server-mark">${escapeHTML(initial)}</div>
        <div>
          <div class="row-title">${escapeHTML(server.name)}</div>
          <div class="status-line">
            <span class="dot ${statusClass(server.status)}"></span>
            <span>${escapeHTML(server.type || (server.url ? 'streamable_http' : 'stdio'))}</span>
            <span>${server.toolsCount || 0} tools, ${server.promptsCount || 0} prompts, ${server.resourcesCount || 0} resources</span>
            <span>${statusLabel(server.status)}</span>
            ${errorText}
          </div>
        </div>
        <div class="inline-actions">
          <button class="link-btn" data-action="probe-mcp" data-id="${escapeHTML(server.name)}" type="button">检测</button>
          <button class="link-btn" data-action="edit-mcp-json" data-id="${escapeHTML(server.name)}" type="button">JSON</button>
          <button class="link-btn" data-action="remove-mcp" data-id="${escapeHTML(server.name)}" type="button">删除</button>
          <button class="toggle ${server.enabled ? 'on' : ''}" data-action="toggle-mcp" data-id="${escapeHTML(server.name)}" type="button" aria-label="toggle ${escapeHTML(server.name)}"></button>
        </div>
      </div>
    `;
  },

  renderMcpFormEditor() {
    if (!this.mcpFormEditor) return '';
    const title = this.mcpFormEditor.originalName ? `Edit MCP Server: ${this.mcpFormEditor.originalName}` : 'New MCP Server';
    return `
      <div class="json-dialog-backdrop">
        <section class="json-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
          <div class="json-dialog-header">
            <div>
              <div class="json-dialog-title">${escapeHTML(title)}</div>
              <div class="row-desc">编辑完整 MCP Server JSON，保存后会立即写入配置并检测可用性。</div>
            </div>
            <button class="btn" data-action="cancel-mcp" type="button">取消</button>
          </div>
          <textarea class="json-editor" data-role="mcp-json-input" spellcheck="false">${escapeHTML(this.mcpFormEditor.value)}</textarea>
          <div class="json-dialog-footer">
            <button class="btn" data-action="cancel-mcp" type="button">取消</button>
            <button class="btn primary" data-action="save-mcp-json" type="button">保存并检测</button>
          </div>
        </section>
      </div>
    `;
  },

  renderModels() {
    const enabled = this.state.models.filter((model) => model.enabled).length;
    const available = this.state.models.filter((model) => model.enabled && model.status === 'available').length;
    return `
      <div class="model-toolbar">
        <button class="btn primary" data-action="add-model" type="button">添加模型</button>
      </div>
      <section class="settings-card">
        ${this.state.models.length ? this.state.models.map((model) => this.renderModel(model)).join('') : '<div class="card-header"><div><div class="row-title">No Models</div><div class="row-desc">点击添加模型，使用 JSON 配置 OpenAI Compatible 或 Anthropic 模型。</div></div></div>'}
      </section>
      <div class="section-label">Load Balancing</div>
      <section class="settings-card">
        <div class="card-header">
          <div>
            <div class="row-title">Unavailable Model Fallback</div>
            <div class="row-desc">已启用 ${enabled} 个模型，其中 ${available} 个检测为可用；不可用模型会被跳过。</div>
          </div>
          <button class="toggle ${this.state.loadBalancing.enabled ? 'on' : ''}" data-action="toggle-lb" type="button" aria-label="toggle load balancing"></button>
        </div>
        <div class="form-grid lb-grid">
          <div class="field">
            <label>Strategy</label>
            <select data-bind="lb.strategy">
              <option value="round_robin" ${this.state.loadBalancing.strategy === 'round_robin' ? 'selected' : ''}>Round Robin</option>
              <option value="weighted" ${this.state.loadBalancing.strategy === 'weighted' ? 'selected' : ''}>Weighted</option>
            </select>
          </div>
        </div>
      </section>
    `;
  },

  renderModel(model) {
    const errorText = model.lastError ? `<span title="${escapeHTML(model.lastError)}">${escapeHTML(model.lastError)}</span>` : '';
    return `
      <div class="model-row">
        <span class="dot ${statusClass(model.status)}"></span>
        <div>
          <div class="row-title">${escapeHTML(model.name || model.model)}</div>
          <div class="status-line">
            <span>${escapeHTML(model.provider || 'OpenAI Compatible')}</span>
            <span>${statusLabel(model.status)}</span>
            ${model.latencyMs ? `<span>${escapeHTML(model.latencyMs)}ms</span>` : ''}
            ${errorText}
          </div>
        </div>
        <div class="inline-actions">
          <button class="link-btn" data-action="probe-model" data-id="${escapeHTML(model.id)}" type="button">检测</button>
          <button class="link-btn" data-action="edit-model" data-id="${escapeHTML(model.id)}" type="button">编辑</button>
          <button class="link-btn" data-action="remove-model" data-id="${escapeHTML(model.id)}" type="button">删除</button>
          <button class="toggle ${model.enabled ? 'on' : ''}" data-action="toggle-model" data-id="${escapeHTML(model.id)}" type="button" aria-label="toggle ${escapeHTML(model.name)}"></button>
        </div>
      </div>
    `;
  },

  renderModelFormEditor() {
    if (!this.modelFormEditor) return '';
    const title = this.modelFormEditor.originalId ? `Edit Model: ${this.modelFormEditor.originalId}` : 'New Model';
    return `
      <div class="json-dialog-backdrop">
        <section class="json-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
          <div class="json-dialog-header">
            <div>
              <div class="json-dialog-title">${escapeHTML(title)}</div>
              <div class="row-desc">配置模型的提供商、API 密钥和其他参数，保存后会立即检测可用性。</div>
            </div>
            <button class="btn" data-action="cancel-model" type="button">取消</button>
          </div>
          <div class="form-editor">
            <div class="form-grid">
              <div class="field">
                <label>Display Name *</label>
                <input type="text" data-bind="modelForm.name" value="${escapeHTML(this.modelFormEditor.name)}" placeholder="模型显示名称" />
              </div>
              <div class="field">
                <label>Model ID *</label>
                <input type="text" data-bind="modelForm.model" value="${escapeHTML(this.modelFormEditor.model)}" placeholder="gpt-4o 或 claude-3-5-sonnet-20241022" />
              </div>
              <div class="field">
                <label>Provider *</label>
                <select data-bind="modelForm.provider">
                  ${MODEL_PROVIDERS.map(p => `<option value="${escapeHTML(p)}" ${this.modelFormEditor.provider === p ? 'selected' : ''}>${escapeHTML(p)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label>Weight</label>
                <input type="number" data-bind="modelForm.weight" value="${this.modelFormEditor.weight}" min="1" max="100" />
              </div>
              <div class="field full">
                <label>Base URL ${this.modelFormEditor.provider === 'Anthropic' ? '(optional)' : '*'}</label>
                <input type="text" data-bind="modelForm.baseURL" value="${escapeHTML(this.modelFormEditor.baseURL)}" placeholder="${this.modelFormEditor.provider === 'Anthropic' ? 'https://api.anthropic.com (默认)' : 'https://api.openai.com/v1'}" />
              </div>
              <div class="field full">
                <label>API Key *</label>
                <input type="password" data-bind="modelForm.apiKey" value="${escapeHTML(this.modelFormEditor.apiKey)}" placeholder="sk-..." />
              </div>
            </div>
          </div>
          <div class="json-dialog-footer">
            <button class="btn" data-action="cancel-model" type="button">取消</button>
            <button class="btn primary" data-action="save-model" type="button">保存并检测</button>
          </div>
        </section>
      </div>
    `;
  },
};

globalObject.AIAgentAdmin = AIAgentAdmin;

function getAutoOpenConfig(script) {
  if (!script || !script.dataset) return null;
  if (script.dataset.open !== 'true' && script.dataset.autoOpen !== 'true') return null;
  const cfg = {};
  if (script.dataset.backendUrl || script.dataset.apiBase) {
    cfg.backendUrl = script.dataset.backendUrl || script.dataset.apiBase;
  }
  return cfg;
}

function tryAutoOpen() {
  if (typeof document === 'undefined') return;
  const script = document.currentScript || document.querySelector('script[src*="agent-admin"]');
  const config = getAutoOpenConfig(script);
  if (config) {
    AIAgentAdmin.open(config);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryAutoOpen, { once: true });
  } else {
    tryAutoOpen();
  }
}

export default AIAgentAdmin;
