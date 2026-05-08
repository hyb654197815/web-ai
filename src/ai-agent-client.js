/**
 * Legacy compatibility client.
 * 新项目请优先使用 AIAgent.init({ apiKey, backendUrl }) 作为统一入口。
 */

class AIAgentClient {
  /**
   * 初始化客户端
   * @param {string} apiKey - API Key
   * @param {string} baseURL - API 基础 URL
   */
  constructor(apiKey, baseURL = 'http://localhost:4096') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this.refreshTimer = null;
    this.authDisabled = false;

    // 从 localStorage 恢复 Token
    this.loadTokensFromStorage();
  }

  /**
   * 从 localStorage 加载 Token
   */
  loadTokensFromStorage() {
    try {
      const stored = localStorage.getItem('ai_agent_tokens');
      if (stored) {
        const data = JSON.parse(stored);
        this.accessToken = data.accessToken;
        this.refreshToken = data.refreshToken;
        this.tokenExpiresAt = data.expiresAt;

        // 如果 Token 还有效，设置自动刷新
        if (this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
          this.scheduleTokenRefresh();
        } else {
          // Token 已过期，清除
          this.clearTokens();
        }
      }
    } catch (error) {
      console.error('Failed to load tokens from storage:', error);
    }
  }

  /**
   * 保存 Token 到 localStorage
   */
  saveTokensToStorage() {
    try {
      localStorage.setItem('ai_agent_tokens', JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt: this.tokenExpiresAt
      }));
    } catch (error) {
      console.error('Failed to save tokens to storage:', error);
    }
  }

  /**
   * 清除 Token
   */
  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    try {
      localStorage.removeItem('ai_agent_tokens');
    } catch (error) {
      // Ignore
    }
  }

  /**
   * 获取新的 Token
   */
  async getToken() {
    if (this.authDisabled) {
      return {
        access_token: '',
        refresh_token: '',
        expires_in: 0,
      };
    }
    const response = await fetch(`${this.baseURL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to get token');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    // 保存到 localStorage
    this.saveTokensToStorage();

    // 设置自动刷新（在过期前 5 分钟刷新）
    this.scheduleTokenRefresh();

    return data;
  }

  /**
   * 刷新 Token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      return await this.getToken();
    }

    try {
      const response = await fetch(`${this.baseURL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken })
      });

      if (!response.ok) {
        // Refresh token 也过期了，重新获取
        return await this.getToken();
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (60 * 60 * 1000); // 默认 60 分钟

      // 保存到 localStorage
      this.saveTokensToStorage();

      // 继续设置自动刷新
      this.scheduleTokenRefresh();

      return data;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // 刷新失败，重新获取
      return await this.getToken();
    }
  }

  /**
   * 设置自动刷新定时器
   */
  scheduleTokenRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.tokenExpiresAt) return;

    // 在过期前 5 分钟刷新
    const refreshTime = this.tokenExpiresAt - Date.now() - (5 * 60 * 1000);

    if (refreshTime > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshAccessToken().catch(console.error);
      }, refreshTime);
    }
  }

  /**
   * 确保有有效的 Token
   */
  async ensureToken() {
    if (this.authDisabled) return;
    // 如果没有 Token 或即将过期（5分钟内），刷新
    if (!this.accessToken || !this.tokenExpiresAt ||
        Date.now() > this.tokenExpiresAt - (5 * 60 * 1000)) {
      await this.refreshAccessToken();
    }
  }

  async detectAuthMode() {
    try {
      const response = await fetch(`${this.baseURL}/api/page-agent/config`);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      this.authDisabled = data?.authDisabled === true;
      if (this.authDisabled) {
        this.clearTokens();
      }
    } catch (error) {
      console.warn('Failed to detect auth mode:', error);
    }
  }

  /**
   * 发送 API 请求
   */
  async request(endpoint, options = {}) {
    await this.detectAuthMode();
    await this.ensureToken();

    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (!this.authDisabled && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(url, { ...options, headers });

      // Token 过期，刷新后重试
      if (!this.authDisabled && response.status === 401) {
        await this.refreshAccessToken();
        headers.Authorization = `Bearer ${this.accessToken}`;
        return await fetch(url, { ...options, headers });
      }

      // 速率限制，等待后重试
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 60;
        console.warn(`Rate limited, retrying after ${retryAfter}s`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return await this.request(endpoint, options);
      }

      return response;
    } catch (error) {
      console.error('Request failed:', error);
      throw error;
    }
  }

  /**
   * 发送聊天消息
   * @param {string} message - 消息内容
   * @param {object} context - 上下文（如 pathname）
   * @param {string} sessionId - 会话 ID（可选）
   */
  async sendMessage(message, context = {}, sessionId = null) {
    const response = await this.request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        context,
        sessionId
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.error || 'Request failed');
    }

    return await response.json();
  }

  /**
   * 发送流式聊天消息
   * @param {string} message - 消息内容
   * @param {object} context - 上下文
   * @param {function} onEvent - 事件回调
   * @param {string} sessionId - 会话 ID（可选）
   */
  async sendMessageStream(message, context = {}, onEvent, sessionId = null) {
    const response = await this.request('/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({
        message,
        context,
        sessionId
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.error || 'Request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          const eventMatch = line.match(/^event: (.+)$/m);
          const dataMatch = line.match(/^data: (.+)$/m);

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);
            onEvent(eventType, data);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 创建会话
   */
  async createSession() {
    const response = await this.request('/api/session', {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    return await response.json();
  }

  /**
   * 发送会话消息
   * @param {string} sessionId - 会话 ID
   * @param {string} message - 消息内容
   * @param {object} context - 上下文
   */
  async sendSessionMessage(sessionId, message, context = {}) {
    const response = await this.request(`/api/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        context
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || error.error || 'Request failed');
    }

    return await response.json();
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIAgentClient;
}

// 使用示例
/*
// 1. 初始化客户端
const client = new AIAgentClient('sk-your-api-key-here');

// 2. 发送消息（自动处理 Token）
try {
  const response = await client.sendMessage('你好', { pathname: '/' });
  console.log('回复:', response);
} catch (error) {
  console.error('错误:', error.message);
}

// 3. 流式消息
await client.sendMessageStream(
  '讲个笑话',
  { pathname: '/' },
  (eventType, data) => {
    if (eventType === 'thinking') {
      console.log('思考中:', data.summary);
    } else if (eventType === 'final') {
      console.log('最终回复:', data.payload);
    }
  }
);

// 4. 会话管理
const session = await client.createSession();
const response = await client.sendSessionMessage(
  session.sessionId,
  '继续聊天',
  { pathname: '/' }
);
*/
