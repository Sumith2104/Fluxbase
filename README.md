<h1 align="center">
  <img src="src/app/favicon.ico" alt="Fluxbase Logo" width="120" align="absmiddle" />
  Fluxbase ⚡
</h1>

<p align="center">
  <strong>The Serverless SQL Platform Built for Speed, Scale, and Developers.</strong>
</p>

<p align="center">
  <strong>The Serverless SQL Platform Built for Speed, Scale, and Developers.</strong>
</p>
<p align="center">
  <a href="https://github.com/Sumith2104/Fluxbase/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
  <a href="https://nextjs.org/">
    <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js 15" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  </a>
  <a href="https://www.postgresql.org/">
    <img src="https://img.shields.io/badge/PostgreSQL-supported-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  </a>
  <a href="https://www.mysql.com/">
    <img src="https://img.shields.io/badge/MySQL-supported-4479A1?logo=mysql&logoColor=white" alt="MySQL" />
  </a>
</p>

---

## Table of Contents

- [What is Fluxbase?](#what-is-fluxbase)
- [Key Features](#key-features)
- [API Reference](#api-reference)
- [Ingestion Worker](#ingestion-worker)
- [Real-Time Subscriptions](#real-time-subscriptions)
- [Performance](#performance)
- [Client Integration Examples](#client-integration-examples)
- [Monitoring & Observability](#monitoring--observability)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## What is Fluxbase?

Fluxbase is a **serverless SQL platform** that wraps your relational databases in a developer-friendly REST API — complete with a high-performance async ingestion pipeline and real-time subscription capabilities.

It enables multi-dialect database execution (**PostgreSQL** and **MySQL**) with strict tenant isolation and a zero-trust security model, so you can focus on building features instead of managing infrastructure.

---

## Key Features

| Feature | Description |
|---|---|
| 🗄️ **Native SQL Execution** | Execute raw SQL on bare-metal PostgreSQL or MySQL drivers — no heavy ORM abstractions. |
| 🚀 **High-Throughput Ingestion** | Dedicated ingestion pipeline capable of writing **80,000+ rows/second** asynchronously. |
| 📡 **Real-Time Data Streaming** | Stream row-level events (`INSERT`, `UPDATE`, `DELETE`) to clients over resilient Server-Sent Events (SSE). |
| 🔒 **Security-First Architecture** | Built-in AST-based SQL validation, JWT-claim RLS mapping, and scoped API key authorization. |
| 🌐 **Multi-Dialect Support** | First-class support for both PostgreSQL and MySQL with dialect-aware query generation. |
| 🤖 **Flux AI Multimodal Gateway** | OpenAI-compatible drop-in gateway for Text Reasoning, Image Generation, Voice (STT & TTS), Video, and 768-dim Embeddings with unlimited quotas for Enterprise, Employee, and PAYG accounts. |
| 📊 **Observability** | Prometheus metrics endpoint + preconfigured Grafana dashboard out of the box. |

---

## API Reference

All requests require a **project-scoped API key** passed via the `Authorization` header:

```http
Authorization: Bearer <your-api-key>
```

> **Base URL:** `https://fluxbasedb.me`

---

### `POST /api/execute-sql`

Executes an arbitrary SQL query under the project's namespace.

**Request Body:**

```json
{
  "query": "SELECT * FROM users WHERE active = true LIMIT 5"
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "rows": [
      { "id": "018f4a2b-...", "name": "Alice" }
    ],
    "columns": ["id", "name"]
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": {
    "code": "QUERY_FORBIDDEN",
    "message": "DROP statements are not permitted."
  }
}
```

---

### `POST /api/ingest`

Queues one or more rows for high-speed asynchronous ingestion. The table is created automatically if it does not exist.

**Request Body:**

```json
{
  "table": "events",
  "rows": [
    { "event_name": "page_view", "path": "/home" },
    { "event_name": "click", "path": "/pricing" }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "queued": 2,
  "batchId": "batch_12345"
}
```

---

### `GET /api/realtime`

Establishes a **Server-Sent Events (SSE)** connection to subscribe to live database events for a project.

```http
GET /api/realtime?projectId=<project-id>
Accept: text/event-stream
Authorization: Bearer <your-api-key>
```

**Event Payload Example:**

```json
{
  "event": "INSERT",
  "table": "orders",
  "row": { "id": "abc123", "status": "pending" }
}
```

> **Note:** Clients should implement exponential backoff reconnection logic. The Fluxbase JS client SDK handles this automatically.

---

## Flux (OpenAI-Compatible AI Gateway)

Fluxbase provides a built-in, drop-in replacement for OpenAI endpoints named **Flux** with dynamic model whitelabeling, S3 media persistence, and multi-provider failover.

Base URL: `https://fluxbasedb.me/api/v1`

### Supported Modalities & Models

| Modality | Canonical Model | OpenAI Alias | Upstream / Capability |
|---|---|---|---|
| **Text Reasoning** | `flux` (Default) | `gpt-3.5-turbo`, `flux-fast` | Ultra-fast reasoning & SQL synthesis (128k context) |
| **Deep Reasoning** | `flux-ultra`, `flux-pro`, `flux-5.2` | `gpt-4o`, `claude-3-5-sonnet` | Complex multi-table reasoning & migration logic |
| **Image Synthesis** | `flux-image`, `flux-image-fast` | `dall-e-3`, `dall-e-2` | Photorealistic image generation with durable S3 URLs |
| **Speech-to-Text** | `flux-listen`, `flux-listen-pro` | `whisper-1`, `whisper` | Multilingual transcription with timestamps |
| **Text-to-Speech** | `flux-speak`, `flux-speak-hd` | `tts-1`, `tts-1-hd` | Natural voices: alloy, echo, fable, onyx, nova, shimmer |
| **Video Generation** | `flux-video`, `flux-video-pro` | `cogvideox` | Text-to-video with async task polling (`HTTP 202`) |
| **Embeddings** | `flux-embed` | `text-embedding-3-small` | 768-dimensional vectors for semantic search & RAG |

### Unlimited Quota Policy
Accounts on **`employee`**, **`org_owner`**, and **`pay_as_you_go` (PAYG)** receive **unlimited quotas across all modalities** (no RPM/TPM restrictions, no daily limits, and access to all models).

### Python OpenAI SDK Example

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://fluxbasedb.me/api/v1",
    api_key="flx_live_your_fluxbase_key"
)

# Text Reasoning
chat = client.chat.completions.create(
    model="flux-fast",
    messages=[{"role": "user", "content": "Write an index optimization plan."}]
)

# Image Generation
img = client.images.generate(
    model="flux-image",
    prompt="A futuristic neon server farm, 8k octane render",
    n=1
)
print(f"Generated Image: {img.data[0].url}")
```

---

## Ingestion Worker

The ingestion worker is a **standalone Python service** (`ingestion-worker/`) that dequeues rows from a Redis buffer and streams them into the database.

- **Fast COPY Protocol** — Batches are streamed using `asyncpg`'s `COPY` protocol instead of parameterized `INSERT` statements, maximizing throughput and eliminating per-row overhead.
- **Dynamic Union Schema Merging** — Before importing a batch, the worker calculates the union of all keys across rows to automatically add missing columns, keeping schemas flexible.
- **Strict Identifier Sanitization** — Any table or column name not matching `^[a-zA-Z_][a-zA-Z0-9_]*$` is rejected and quarantined to a Dead Letter Queue (DLQ), blocking SQL injection at the ingestion boundary.
- **Auto-Scaler** — The `scaler.py` module monitors queue depth and adjusts worker concurrency automatically.

### Running the worker locally

```bash
cd ingestion-worker
pip install -r requirements.txt
python main.py
```

---

## Real-Time Subscriptions

Fluxbase implements low-latency SSE subscriptions with built-in connection resilience:

- **Throttled Cache Invalidation** — Invalidation events are throttled to prevent UI blocking under high-frequency database writes.
- **Connection Resilience** — Exponential backoff with jitter and automatic heartbeats ensure clients reconnect gracefully after network drops.
- **Shared Event Source** — A single SSE connection is reused per project across all UI components to prevent connection exhaustion on the server.

---

## Performance

| Technique | Details |
|---|---|
| **COPY vs INSERT** | Bulk inserts are translated into PostgreSQL binary stream copies, eliminating SQL parsing and planning overhead. |
| **Monotonic UUID v7** | Recommended for primary keys to prevent B-tree page fragmentation and index splits under heavy insert loads. |
| **Async WAL Writing** | Transaction-local `SET synchronous_commit = off` allows fast ingestion replies without waiting for WAL disk flushes. |
| **Redis Queue Buffer** | Incoming rows are buffered in Redis, decoupling the API from the database and absorbing traffic spikes. |

---

## Client Integration Examples

### JavaScript / TypeScript

```typescript
async function executeQuery<T>(sql: string): Promise<T[]> {
  const response = await fetch("https://fluxbasedb.me/api/v1/sql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer <API_KEY>"
    },
    body: JSON.stringify({ projectId: "<PROJECT_ID>", query: sql })
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error.message);
  return data.rows;
}
```

### Python

```python
import requests

BASE_URL = "https://fluxbasedb.me"
HEADERS  = {"Authorization": "Bearer <API_KEY>", "Content-Type": "application/json"}

def execute_query(project_id: str, sql: str) -> list[dict]:
    response = requests.post(
        f"{BASE_URL}/api/v1/sql",
        headers=HEADERS,
        json={"projectId": project_id, "query": sql}
    )
    data = response.json()
    if not data["success"]:
        raise RuntimeError(data["error"]["message"])
    return data["rows"]

def ingest_rows(table: str, rows: list[dict]) -> dict:
    response = requests.post(
        f"{BASE_URL}/api/ingest",
        headers=HEADERS,
        json={"table": table, "rows": rows}
    )
    return response.json()
```

### Real-Time (JavaScript EventSource)

```javascript
const source = new EventSource(
  `https://fluxbasedb.me/api/realtime/subscribe?projectId=${PROJECT_ID}&table=orders`
);

source.onmessage = (event) => {
  const { table, eventType, record } = JSON.parse(event.data);
  console.log(`[${eventType}] on ${table}:`, record);
};

source.onerror = () => {
  // The Fluxbase SDK handles reconnection automatically.
};
```

---

## Monitoring & Observability

The ingestion worker exposes a `/metrics` **Prometheus** endpoint tracking:

| Metric | Type | Description |
|---|---|---|
| `rows_ingested_total` | Counter | Total rows successfully written to the database |
| `rows_failed_total` | Counter | Total rows that failed processing |
| `rows_dlq_total` | Counter | Total rows quarantined to the Dead Letter Queue |
| `insert_latency_ms` | Histogram | End-to-end latency from queue dequeue to DB write |

A preconfigured **Grafana dashboard** is available at [`ingestion-worker/grafana_dashboard.json`](ingestion-worker/grafana_dashboard.json) for monitoring ingest throughput, error rates, and queue latency in real time.

Alert rules are defined in [`ingestion-worker/alert_rules.yml`](ingestion-worker/alert_rules.yml).

---

## Project Structure

```
Fluxbase/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (app)/                  # Authenticated dashboard views
│   │   ├── api/                    # API routes (execute-sql, ingest, realtime)
│   │   ├── pricing/                # Public pricing page
│   │   ├── docs/                   # Public documentation page
│   │   ├── layout.tsx              # Root layout
│   │   └── manifest.ts             # PWA manifest
│   ├── components/                 # Reusable UI components
│   ├── lib/                        # DB pools, auth helpers, utilities
│   ├── hooks/                      # Custom React hooks
│   ├── contexts/                   # React context providers
│   ├── actions/                    # Next.js server actions
│   └── server/                     # WebSocket & server-side modules
├── ingestion-worker/               # Async Python ingestion service
│   ├── main.py                     # Worker entrypoint
│   ├── worker.py                   # Schema merger & COPY implementation
│   ├── scaler.py                   # Auto-scaling logic
│   ├── metrics.py                  # Prometheus metrics definitions
│   ├── health.py                   # Health check endpoint
│   ├── throttle.py                 # Rate-limiting / throttle logic
│   ├── grafana_dashboard.json      # Preconfigured Grafana dashboard
│   ├── alert_rules.yml             # Prometheus alert rules
│   ├── Dockerfile                  # Container image for the worker
│   └── requirements.txt
├── fluxbase-client/                # Official JavaScript/TypeScript SDK
│   └── src/
├── src-tauri/                      # Tauri desktop app wrapper
│   └── tauri.conf.json
├── public/                         # Static assets & PWA icons
├── next.config.ts
├── tailwind.config.ts
├── package.json
└── README.md
```

---

## Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository.
2. **Create** a feature branch:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Commit** your changes using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: add my feature"
   ```
4. **Push** to your fork:
   ```bash
   git push origin feat/my-feature
   ```
5. **Open a Pull Request** against the `main` branch and describe your changes.

> Please ensure your code passes linting (`npm run lint`) and type-checking (`npm run typecheck`) before submitting.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ by the <a href="https://github.com/Sumith2104">Fluxbase Team</a>
</p>