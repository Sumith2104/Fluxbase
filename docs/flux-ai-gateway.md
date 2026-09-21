# Flux Documentation (AI Gateway)

**Flux** is Fluxbase's built-in, enterprise-grade, OpenAI-compatible AI gateway that connects your applications and autonomous AI agents directly to the Flux AI family of models across **6 modalities**:

1. **Text Reasoning & Chat Completions** (`/api/v1/chat/completions`)
2. **Image Synthesis** (`/api/v1/images/generations`)
3. **Speech-to-Text Audio Transcription** (`/api/v1/audio/transcriptions`)
4. **Text-to-Speech Voice Synthesis** (`/api/v1/audio/speech`)
5. **Video Generation & Task Polling** (`/api/v1/videos/generations`)
6. **Vector Embeddings** (`/api/v1/embeddings`)

Plus secure media asset delivery via pre-signed redirects at `/api/v1/media/:mediaId`.

---

## 1. Authentication & Base URL

All requests must supply your Fluxbase API Key in the `Authorization` header:

```http
Authorization: Bearer flx_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

- **Production Base URL**: `https://fluxbasedb.me/api/v1`
- **Local Dev Base URL**: `http://localhost:3000/api/v1`

---

## 2. Unlimited Everything Tier Policy

Accounts with the following subscription plans have **unlimited access for everything**:
- **`employee`** (and alias `emp`)
- **`org_owner`** (and alias `org`, `owner`)
- **`pay_as_you_go`** (and alias `payg`, `pay-as-you-go`)

### Benefits for Unlimited Accounts:
- **No Rate Limits**: RPM and TPM throttling are completely disabled (`allowed: true`, remaining quota = 999,999, reset = 0s).
- **No Daily Limits**: Daily request and token quotas are waived.
- **Unrestricted Model Access**: Direct access to all models across all modalities (including video generation, studio-grade TTS, and frontier reasoning models) with zero tier lock screens.

---

## 3. Model Catalog & Modality Reference

| Modality | Canonical Model | OpenAI Alias | Upstream / Provider | Capabilities |
|---|---|---|---|---|
| **Text** | `flux` *(Default)* | `gpt-3.5-turbo`, `flux-fast` | GLM-4 Flash / Groq | High-accuracy general reasoning & SQL synthesis, 128k context |
| **Text** | `flux-flash` | `glm-4-flash` | GLM-4 Flash | Low latency, realtime autocompletion |
| **Text** | `flux-pro` | `glm-4-air` | GLM-4 Air | Architecture, JSON mode, complex schemas |
| **Text** | `flux-ultra` | `gpt-4o`, `claude-3-5-sonnet` | GLM-4 Plus | Deep reasoning, system audits |
| **Text** | `flux-5.2` | `glm-4-plus` | GLM-4 Plus | Frontier agentic multi-step reasoning |
| **Text** | `flux-turbo` | `llama-3.3-70b-versatile` | Groq LLaMA 3.3 | 300+ tokens/second inference |
| **Text** | `flux-omni` | `gemini-2.0-flash` | Gemini 2.0 Flash | Vision, documents, 1M context |
| **Text** | `flux-max` | `gpt-4o-mini` | OpenAI GPT-4o-mini | Benchmark flagship, strict OpenAI API parity |
| **Image** | `flux-image` | `dall-e-3`, `dall-e` | CogView-4 | Photorealistic text-to-image with S3 persistence |
| **Image** | `flux-image-fast` | `dall-e-2` | CogView-3 Flash | Fast image generation for web assets |
| **Image** | `flux-image-hd` | `imagen-3.0` | Google Imagen 3 | 4K image generation & typography |
| **Voice STT** | `flux-listen` | `whisper-1`, `whisper` | Whisper Large v3 Turbo | Multilingual audio transcription + timestamps |
| **Voice STT** | `flux-listen-pro` | `whisper-large-v3` | Whisper Large v3 | High-precision transcription for noisy audio |
| **Voice TTS** | `flux-speak` | `tts-1` | OpenAI TTS-1 | Expressive speech (alloy, echo, fable, onyx, nova, shimmer) |
| **Voice TTS** | `flux-speak-hd` | `tts-1-hd` | OpenAI TTS-1 HD | Studio-grade HD voice synthesis |
| **Video** | `flux-video` | `cogvideox-flash` | CogVideoX Flash | Dynamic motion video synthesis (async polling) |
| **Video** | `flux-video-pro` | `cogvideox` | CogVideoX | 1080p cinematic video synthesis |
| **Embeddings** | `flux-embed` | `text-embedding-3-small` | Gemini text-embedding-004 | 768-dimensional vectors for semantic search & RAG |

---

## 4. Endpoints Reference

### 4.1 Models Discovery
```http
GET /api/v1/models
```
Returns an OpenAI-compliant JSON list of all available models, their modalities, owned_by: `"fluxbase"`, context windows, and capabilities.

### 4.2 Chat Completions
```http
POST /api/v1/chat/completions
Content-Type: application/json
```
```json
{
  "model": "flux-fast",
  "messages": [
    { "role": "system", "content": "You are a database tuning expert." },
    { "role": "user", "content": "Explain partial indexes in PostgreSQL." }
  ],
  "stream": true,
  "temperature": 0.3
}
```

### 4.3 Image Generation
```http
POST /api/v1/images/generations
Content-Type: application/json
```
```json
{
  "model": "flux-image",
  "prompt": "Futuristic neon cloud database server rack, hyper-realistic, 8k resolution",
  "n": 1,
  "size": "1024x1024",
  "response_format": "url"
}
```

### 4.4 Speech-to-Text (Transcription)
```http
POST /api/v1/audio/transcriptions
Content-Type: multipart/form-data
```
Form parameters:
- `file`: Audio file binary (`mp3`, `wav`, `m4a`, `ogg`, `webm`, `mp4`)
- `model`: `flux-listen` (or `whisper-1`)
- `response_format`: `json` or `text`

### 4.5 Text-to-Speech (Speech Synthesis)
```http
POST /api/v1/audio/speech
Content-Type: application/json
```
```json
{
  "model": "flux-speak",
  "input": "Your query completed in 4 milliseconds.",
  "voice": "alloy",
  "response_format": "mp3"
}
```

### 4.6 Video Generation (Async 202 Polling)
```http
POST /api/v1/videos/generations
Content-Type: application/json
```
```json
{
  "model": "flux-video",
  "prompt": "Camera sweeping through an infinite data vault with glowing cyan circuits"
}
```
Response (`202 Accepted`):
```json
{
  "task_id": "task_abc123",
  "status": "PROCESSING",
  "poll_url": "/api/v1/videos/generations/task_abc123"
}
```
Poll `GET /api/v1/videos/generations/:taskId` until `status === "SUCCESS"` to retrieve `video_url`.

### 4.7 Text Embeddings
```http
POST /api/v1/embeddings
Content-Type: application/json
```
```json
{
  "model": "flux-embed",
  "input": ["Vector databases and semantic indexing", "Serverless PostgreSQL"]
}
```

---

## 5. Client SDK Integrations

### Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://fluxbasedb.me/api/v1",
    api_key="flx_live_your_key"
)

# Text Completion
completion = client.chat.completions.create(
    model="flux-fast",
    messages=[{"role": "user", "content": "How do I optimize a SQL query?"}]
)

# Image Generation
image = client.images.generate(
    model="flux-image",
    prompt="Cyberpunk database server room",
    n=1
)
print(image.data[0].url)
```

### Node.js / TypeScript (OpenAI SDK)
```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://fluxbasedb.me/api/v1',
  apiKey: process.env.FLUXBASE_API_KEY,
});

async function main() {
  const stream = await client.chat.completions.create({
    model: 'flux-ultra',
    messages: [{ role: 'user', content: 'Generate a distributed database migration script.' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main();
```
