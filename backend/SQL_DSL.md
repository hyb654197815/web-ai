# Database DSL

`AGENT_DATABASE_URL` is optional. When it is not set, the backend uses SQLite at `data/agent.sqlite3`.
Relative SQLite paths are resolved from the project root.

Supported examples:

```env
AGENT_DATABASE_URL=sqlite:///./data/agent.sqlite3
AGENT_DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/web_ai?charset=utf8mb4
AGENT_DATABASE_URL=postgresql+psycopg://user:password@127.0.0.1:5432/web_ai
```

For databases not listed above, use any SQLAlchemy dialect URL and install its Python driver.

## Core Tables

```sql
CREATE TABLE agent_admin_configs (
  key VARCHAR(100) PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE agent_api_keys (
  id VARCHAR(64) PRIMARY KEY,
  key VARCHAR(160) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  expires_at VARCHAR(64),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit INTEGER NOT NULL DEFAULT 100,
  total_requests INTEGER NOT NULL DEFAULT 0,
  last_used_at VARCHAR(64)
);

CREATE TABLE agent_token_usage (
  id INTEGER PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  api_key_id VARCHAR(64),
  api_key_prefix VARCHAR(32),
  model_id VARCHAR(160),
  model_name VARCHAR(200),
  provider VARCHAR(80),
  endpoint VARCHAR(240) NOT NULL,
  request_type VARCHAR(80) NOT NULL DEFAULT 'chat.completions',
  status_code INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost FLOAT NOT NULL DEFAULT 0,
  duration_ms FLOAT NOT NULL DEFAULT 0,
  ip VARCHAR(80),
  user_agent TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_agent_token_usage_created_at ON agent_token_usage (created_at);
CREATE INDEX idx_agent_token_usage_api_key ON agent_token_usage (api_key_id);
CREATE INDEX idx_agent_token_usage_model ON agent_token_usage (model_id);
```

Model pricing is stored in the `agent_admin_configs` JSON payload under each model:

```json
{
  "input_price": 1.25,
  "output_price": 10,
  "cache_write_price": 1.25,
  "cache_read_price": 0.125
}
```

Prices are USD per 1M tokens.
