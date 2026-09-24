// Script to generate the complete Fluxbase Integration Guide PDF (v4.2)
// Run with: node src/scripts/generate-pdf.mjs

import { jsPDF } from 'jspdf';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const publicDir = join(projectRoot, 'public');

if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
}

const doc = new jsPDF({ unit: 'pt', format: 'a4' });

try {

const W = doc.internal.pageSize.getWidth();
const H = doc.internal.pageSize.getHeight();
const MARGIN = 45;
const CONTENT_W = W - MARGIN * 2;

const PRIMARY = [255, 75, 41];       // Fluxbase Orange (#FF4B29)
const DARK = [17, 17, 17];           // Charcoal Dark (#111111)
const MUTED = [90, 90, 90];          // Muted text
const CODE_BG = [24, 24, 27];        // Zinc Dark (#18181B)
const CODE_FG = [228, 228, 231];     // Zinc Light (#E4E4E7)

let y = 0;

function newPage() {
    doc.addPage();
    y = MARGIN;
    addHeaderFooter();
}

function addHeaderFooter() {
    const pageNum = doc.internal.getCurrentPageInfo().pageNumber;
    if (pageNum === 1) return; // Skip cover

    // Running top header
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Fluxbase Integration & API Architecture Manual • v4.2', MARGIN, 25);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, 30, W - MARGIN, 30);

    // Running bottom footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('© 2026 Fluxbase Inc. — Confidential & Proprietary Developer Documentation', MARGIN, H - 20);
    doc.text(`Page ${pageNum}`, W - MARGIN - 35, H - 20);
    doc.line(MARGIN, H - 28, W - MARGIN, H - 28);
}

function checkPageBreak(needed = 40) {
    if (y + needed > H - MARGIN - 15) {
        newPage();
        return true;
    }
    return false;
}

function addTitle(text) {
    checkPageBreak(70);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...DARK);
    doc.text(text, MARGIN, y);
    y += 7;
    doc.setFillColor(...PRIMARY);
    doc.rect(MARGIN, y, CONTENT_W, 2.5, 'F');
    y += 22;
}

function addH2(text) {
    checkPageBreak(50);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...PRIMARY);
    doc.text(text, MARGIN, y);
    y += 18;
    doc.setDrawColor(...PRIMARY);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 14;
}

function addH3(text, color = DARK) {
    checkPageBreak(35);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...color);
    doc.text(text, MARGIN, y);
    y += 14;
}

function addText(text, size = 9.5) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    lines.forEach(line => {
        checkPageBreak(15);
        doc.text(line, MARGIN, y);
        y += 14;
    });
    y += 4;
}

function addBullet(text, indent = 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    const bx = MARGIN + indent;
    const bw = CONTENT_W - indent;
    const bullet = '›  ';
    const bW = doc.getTextWidth(bullet);
    const lines = doc.splitTextToSize(text, bw - bW - 4);
    lines.forEach((line, i) => {
        checkPageBreak(15);
        if (i === 0) {
            doc.setTextColor(...PRIMARY);
            doc.text(bullet, bx, y);
            doc.setTextColor(...MUTED);
        }
        doc.text(line, bx + bW + 2, y);
        y += 14;
    });
}

function addAlert(label, text, type = 'info') {
    const colors = { 
        info: [37, 99, 235], 
        warn: [217, 119, 6], 
        danger: [220, 38, 38],
        success: [16, 185, 129]
    };
    const col = colors[type] || colors.info;
    const lineH = 13;
    const lines = doc.splitTextToSize(text, CONTENT_W - 24);
    const total = lines.length * lineH + 22;
    checkPageBreak(total + 10);
    
    doc.setFillColor(col[0], col[1], col[2], 0.06);
    doc.setDrawColor(...col);
    doc.setLineWidth(0.8);
    doc.roundedRect(MARGIN, y, CONTENT_W, total, 4, 4, 'FD');
    doc.setFillColor(...col);
    doc.rect(MARGIN, y, 4, total, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...col);
    doc.text(label, MARGIN + 12, y + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(70, 70, 70);
    lines.forEach((line, i) => {
        doc.text(line, MARGIN + 12, y + 13 + (i + 1) * lineH);
    });
    y += total + 8;
}

function addCodeBlock(lines, lang = '') {
    const lineH = 12;
    const padV = 8;
    const total = lines.length * lineH + padV * 2 + (lang ? 16 : 0);
    checkPageBreak(total + 15);

    doc.setFillColor(...CODE_BG);
    doc.setDrawColor(60, 60, 65);
    doc.setLineWidth(0.5);
    doc.roundedRect(MARGIN, y, CONTENT_W, total, 4, 4, 'FD');

    if (lang) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 120, 80);
        doc.text(lang.toUpperCase(), MARGIN + 10, y + 11);
        doc.setDrawColor(60, 60, 65);
        doc.line(MARGIN, y + 16, MARGIN + CONTENT_W, y + 16);
        y += 16;
    }

    y += padV + lineH * 0.75;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CODE_FG);

    lines.forEach(line => {
        const parts = doc.splitTextToSize(line || ' ', CONTENT_W - 20);
        parts.forEach(part => {
            doc.text(part, MARGIN + 10, y);
            y += lineH;
        });
    });
    y += padV + 6;
}

function addTable(headers, rows, colWidths = null) {
    const numCols = headers.length;
    const widths = colWidths || headers.map(() => CONTENT_W / numCols);
    const rowH = 16;
    checkPageBreak(rowH * (rows.length + 2) + 15);

    // Header
    doc.setFillColor(30, 30, 35);
    doc.roundedRect(MARGIN, y, CONTENT_W, rowH + 2, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 120, 80);

    let cx = MARGIN + 8;
    headers.forEach((h, i) => {
        doc.text(h, cx, y + 11);
        cx += widths[i];
    });
    y += rowH + 3;

    // Rows
    rows.forEach((row, rIdx) => {
        checkPageBreak(rowH + 4);
        if (rIdx % 2 === 0) {
            doc.setFillColor(246, 246, 248);
            doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
        }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(60, 60, 60);

        let rx = MARGIN + 8;
        row.forEach((cell, cIdx) => {
            const truncated = doc.splitTextToSize(String(cell || ''), widths[cIdx] - 10)[0] || '';
            doc.text(truncated, rx, y + 11);
            rx += widths[cIdx];
        });
        y += rowH;
    });
    y += 8;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. COVER PAGE
// ═════════════════════════════════════════════════════════════════════════════
doc.setFillColor(15, 15, 18);
doc.rect(0, 0, W, H, 'F');

doc.setFillColor(...PRIMARY);
doc.rect(0, 0, 7, H, 'F');

// Dark banner card
doc.setFillColor(25, 25, 30);
doc.rect(0, 0, W, 210, 'F');

doc.setFont('helvetica', 'bold');
doc.setFontSize(50);
doc.setTextColor(255, 255, 255);
doc.text('Fluxbase', MARGIN, 110);

doc.setFont('helvetica', 'normal');
doc.setFontSize(22);
doc.setTextColor(...PRIMARY);
doc.text('Developer Integration & Architecture Manual', MARGIN, 150);

doc.setFontSize(11);
doc.setTextColor(170, 170, 175);
doc.text('Complete Reference for REST SQL, AI Gateway, MCP, WebSockets & Storage', MARGIN, 180);

// Badges
const badges = ['v4.2 Production', 'PostgreSQL', 'MySQL', 'Flux AI Gateway', 'Model Context Protocol (MCP)', 'REST + WS'];
let bx = MARGIN;
let by = 245;
badges.forEach(b => {
    doc.setFillColor(32, 32, 38);
    const bw = doc.getTextWidth(b) + 16;
    if (bx + bw > W - MARGIN) {
        bx = MARGIN;
        by += 26;
    }
    doc.roundedRect(bx, by, bw, 18, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PRIMARY);
    doc.text(b, bx + 8, by + 12);
    bx += bw + 8;
});

// Quick Specs Grid
y = 350;
doc.setFillColor(22, 22, 26);
doc.roundedRect(MARGIN, y, CONTENT_W, 160, 6, 6, 'F');

doc.setFont('helvetica', 'bold');
doc.setFontSize(12);
doc.setTextColor(255, 255, 255);
doc.text('Production Gateway Specifications', MARGIN + 18, y + 26);

const specs = [
    ['Core SQL Endpoint', 'POST https://www.fluxbasedb.me/api/execute-sql'],
    ['AI Gateway (Chat)', 'POST https://www.fluxbasedb.me/api/v1/chat/completions'],
    ['MCP JSON-RPC', 'POST https://www.fluxbasedb.me/api/mcp'],
    ['Real-Time WebSockets', 'wss://fluxbase-realtime.onrender.com'],
    ['Authentication', 'Authorization: Bearer <FLUXBASE_API_KEY>'],
    ['Default AI Model', 'flux (Flagship reasoning model family)'],
];

let sy = y + 50;
specs.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...PRIMARY);
    doc.text(k + ':', MARGIN + 18, sy);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(210, 210, 215);
    doc.text(v, MARGIN + 150, sy);
    sy += 18;
});

doc.setFont('helvetica', 'normal');
doc.setFontSize(9);
doc.setTextColor(110, 110, 115);
doc.text(`Official Developer Manual • Edition 4.2 • Published September 2026`, MARGIN, H - 55);
doc.text('© 2026 Fluxbase Inc. All rights reserved. Visit https://www.fluxbasedb.me/docs for interactive docs.', MARGIN, H - 40);

// ═════════════════════════════════════════════════════════════════════════════
// 2. OVERVIEW & GETTING STARTED
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('1. Getting Started & Architecture');
addText(
    'Fluxbase is a unified backend database and AI infrastructure platform providing instant serverless databases, ' +
    'an OpenAI-compatible AI gateway, Model Context Protocol (MCP) tooling for autonomous coding agents, ' +
    'sub-second real-time streaming, AWS S3-backed file storage, and enterprise Row-Level Security (RLS).'
);

addAlert('Required Integration Credentials',
    'Every Fluxbase integration requires three project parameters from your Project Settings:\n' +
    '1. Project ID: Unique 16-character identifier (e.g., 51c04beb753a42f3)\n' +
    '2. API Key: Scoped Bearer token (flx_live_...) with read, write, ai, or admin permissions\n' +
    '3. Base URL: https://www.fluxbasedb.me (for all REST & Gateway APIs)',
    'info'
);

addH2('Environment Configuration');
addText('Store your secrets in server-only environment variables. Never expose your live API key to the client browser.');
addCodeBlock([
    '# .env.local (Server Only)',
    'FLUXBASE_API_KEY=flx_live_xxxxxxxxxxxxxxxxxxxx',
    'FLUXBASE_PROJECT_ID=51c04beb753a42f3',
    'FLUXBASE_BASE_URL=https://www.fluxbasedb.me',
    'NEXT_PUBLIC_WS_URL=wss://fluxbase-realtime.onrender.com',
], 'bash');

addH2('Authentication & Scope Hierarchy');
addText('All requests must include an Authorization header with Bearer format. Requests without valid keys return 401 Unauthorized.');
addCodeBlock([
    'Authorization: Bearer flx_live_xxxxxxxxxxxxxxxxxxxx',
    'Content-Type: application/json',
], 'HTTP');

addH3('Key Scopes');
addTable(
    ['Scope', 'Allowed Operations', 'Recommended Environment'],
    [
        ['read', 'SELECT queries only', 'Public dashboards, read-only analytics'],
        ['write', 'SELECT, INSERT, UPDATE, DELETE', 'Backend services, user mutations'],
        ['ai', 'Flux AI Gateway chat completions', 'Cursor, AI Agents, LLM services'],
        ['admin', 'Full DDL (CREATE, ALTER, DROP) + DML', 'Migrations, seed scripts, CLI setup'],
    ],
    [70, 220, 215]
);

// ═════════════════════════════════════════════════════════════════════════════
// 3. FLUX AI GATEWAY (CHAT & COMPLETIONS)
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('2. Flux AI Gateway (OpenAI-Compatible)');
addText(
    'Fluxbase provides a high-throughput, drop-in OpenAI-compatible AI gateway. Connect standard OpenAI SDKs, ' +
    'LangChain, Cursor, Windsurf, or custom agent frameworks to Flux AI reasoning models without changing code.'
);

addAlert('Gateway Base URL & Compatibility',
    'Endpoint: POST https://www.fluxbasedb.me/api/v1/chat/completions\n' +
    'Set your client base_url to "https://www.fluxbasedb.me/api/v1" and supply your Fluxbase API Key.\n' +
    'Dedicated Interactive Hub: https://www.fluxbasedb.me/ai-models\n' +
    'Supports streaming (stream=true), image generation, video tasks, and speech STT/TTS.',
    'success'
);

addH2('Proprietary Model Catalog & Engine Architecture');
addTable(
    ['Model ID', 'Engine Designation', 'Architecture', 'Specs & Best Use Case'],
    [
        ['flux-pro', 'Flux Pro', 'Flux Neural Cloud', 'Flagship multimodal reasoning, vision & coding. 300k context'],
        ['flux-lite', 'Flux Lite', 'Flux Neural Cloud', 'Fast multimodal reasoning, sub-200ms latency, high volume. 300k context'],
        ['flux', 'Flux Standard', 'Flux Neural Cloud', 'High-accuracy general reasoning, precision SQL synthesis. 128k context'],
        ['flux-micro', 'Flux Micro', 'Flux Neural Cloud', 'Lowest latency text model for extreme throughput agents. 128k context'],
        ['flux-image-fast', 'Flux Image Fast', 'Flux Neural Cloud', 'Ultra-fast text-to-image synthesis in 2-8s with S3 cloud delivery'],
        ['flux-embed', 'Flux Embed', 'Flux Neural Cloud', '1024-dimensional dense vector embeddings for semantic search & RAG'],
        ['flux-video', 'Flux Video', 'Flux Neural Cloud', 'Text-to-video dynamic motion synthesis with async task polling'],
        ['flux-turbo', 'Flux Turbo', 'Flux Neural Cloud', 'Hyper-speed 300+ tok/s inference for real-time interaction. 128k context'],
        ['flux-omni', 'Flux Omni', 'Flux Neural Cloud', 'Massive context window, multimodal vision understanding. 300k context'],
        ['flux-max', 'Flux Max', 'Flux Neural Cloud', 'Flagship coding, robust reasoning, and instruction following. 300k context'],
        ['flux-vision', 'Flux Vision', 'Flux Neural Cloud', 'Visual diagram comprehension, screenshot-to-code, OCR inspection'],
        ['flux-listen', 'Flux Listen', 'Flux Neural Cloud', 'Real-time multilingual audio transcription with timestamps'],
        ['flux-speak', 'Flux Speak', 'Flux Neural Cloud', 'Natural expressive speech synthesis across multiple voices'],
        ['gpt-4o', 'Flux Drop-in', 'Flux Neural Cloud', 'Drop-in compatibility alias automatically mapped to flux-pro'],
    ],
    [85, 105, 100, 215]
);

addH2('Tier Token Allocations & Rate Limits Matrix');
addTable(
    ['Plan Tier', 'Text TPM', 'Requests / Min', 'Daily Quota', 'Image & Video Limits'],
    [
        ['Free', '10,000 TPM', '10 RPM', '500 req / day', '5 Images/day • Video locked'],
        ['Pro', '100,000 TPM', '60 RPM', '10,000 req / day', '50 Images/day • 5 Videos/day'],
        ['Max', '500,000 TPM', '300 RPM', '50,000 req / day', '200 Images/day • 20 Videos/day'],
        ['Pay-As-You-Go', 'Unlimited TPM', 'Unlimited RPM', 'Unlimited (Metered)', 'Uncapped elasticity at standard rates'],
    ],
    [75, 85, 80, 110, 155]
);

addH2('Python Integration (OpenAI SDK)');
addCodeBlock([
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    '    base_url="https://www.fluxbasedb.me/api/v1",',
    '    api_key="flx_live_your_fluxbase_key"',
    ')',
    '',
    '# 1. Frontier Reasoning with Claude Sonnet 4.5',
    'response = client.chat.completions.create(',
    '    model="flux-sonnet",',
    '    messages=[',
    '        {"role": "system", "content": "You are a senior database architect."},',
    '        {"role": "user", "content": "Design an optimal distributed sharding schema."}',
    '    ],',
    '    temperature=0.2',
    ')',
    'print(response.choices[0].message.content)',
    '',
    '# 2. SOTA Photorealistic Image Generation',
    'img = client.images.generate(',
    '    model="flux-image-ultra",',
    '    prompt="Futuristic data center server room, neon orange coolant, cinematic 8k",',
    '    size="1024x1024"',
    ')',
    'print("Image URL:", img.data[0].url)',
], 'python');

addH2('Node.js / TypeScript Integration');
addCodeBlock([
    "import OpenAI from 'openai';",
    '',
    'const client = new OpenAI({',
    "  baseURL: 'https://www.fluxbasedb.me/api/v1',",
    '  apiKey: process.env.FLUXBASE_API_KEY,',
    '});',
    '',
    'async function generateSchema() {',
    '  const stream = await client.chat.completions.create({',
    "    model: 'flux',",
    "    messages: [{ role: 'user', content: 'Generate a PostgreSQL partitioned table schema.' }],",
    '    stream: true,',
    '  });',
    '  for await (const chunk of stream) {',
    "    process.stdout.write(chunk.choices[0]?.delta?.content || '');",
    '  }',
    '}',
], 'typescript');

// ═════════════════════════════════════════════════════════════════════════════
// 4. MODEL CONTEXT PROTOCOL (MCP) AI GATEWAY
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('3. Model Context Protocol (MCP) Gateway');
addText(
    'Fluxbase implements the Model Context Protocol (MCP) over JSON-RPC 2.0. This allows AI assistants such as ' +
    'Google Antigravity, Cursor, Windsurf, and Claude Desktop to introspect live schemas, run migrations, and ' +
    'execute queries autonomously with zero manual prompting.'
);

addAlert('MCP Gateway Endpoint',
    'POST https://www.fluxbasedb.me/api/mcp\n' +
    'Protocols: JSON-RPC 2.0 over HTTP POST. Supports tools/list and tools/call methods.\n' +
    'Authenticated via Authorization: Bearer <API_KEY>',
    'info'
);

addH2('Available MCP Tools');
addTable(
    ['Tool Name', 'Category', 'Description'],
    [
        ['create_project', 'PROJECT', 'Provisions new serverless PostgreSQL or MySQL database projects'],
        ['list_projects', 'DISCOVERY', 'Lists all database projects owned by or shared with your account'],
        ['get_schema', 'SCHEMA', 'Inspects live table structures, column definitions, data types, and primary keys'],
        ['run_sql', 'EXECUTE', 'Executes raw SQL DDL and DML queries against the active project database'],
    ],
    [95, 80, 330]
);

addH2('Connecting with Google Antigravity');
addText('Antigravity supports MCP natively via mcp_config.json. Add this to .agents/mcp_config.json in your workspace root:');
addCodeBlock([
    '{',
    '  "mcpServers": {',
    '    "fluxbase": {',
    '      "serverUrl": "https://www.fluxbasedb.me/api/mcp",',
    '      "headers": {',
    '        "Authorization": "Bearer flx_live_your_fluxbase_key"',
    '      }',
    '    }',
    '  }',
    '}',
], 'json');

addH2('Connecting with Cursor, Windsurf & Claude Desktop');
addText('In Cursor or Windsurf (Settings → Features → MCP → Add Server) or Claude Desktop (claude_desktop_config.json):');
addCodeBlock([
    '{',
    '  "mcpServers": {',
    '    "fluxbase": {',
    '      "url": "https://www.fluxbasedb.me/api/mcp",',
    '      "headers": {',
    '        "Authorization": "Bearer flx_live_your_fluxbase_key"',
    '      }',
    '    }',
    '  }',
    '}',
], 'json');

addH2('CLI Discovery Test (Node.js)');
addCodeBlock([
    "node -e \"fetch('https://www.fluxbasedb.me/api/mcp', {",
    "  method: 'POST',",
    "  headers: { 'Authorization': 'Bearer YOUR_KEY', 'Content-Type': 'application/json' },",
    "  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })",
    '}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))\"',
], 'bash');

// ═════════════════════════════════════════════════════════════════════════════
// 5. CORE SQL API & ADVANCED ENGINE
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('4. Core SQL API & Execution Engine');
addText(
    'Execute any SQL statement against your project database via a single unified endpoint. ' +
    'The Fluxbase engine supports full PostgreSQL syntax, Common Table Expressions (CTEs), window functions, ' +
    'timestamp arithmetic, parameterized queries, and automatic transaction handling.'
);

addH2('Endpoint Specification');
addCodeBlock([
    'Method:  POST',
    'URL:     https://www.fluxbasedb.me/api/execute-sql',
    'Header:  Authorization: Bearer <API_KEY>',
    'Header:  Content-Type: application/json',
], 'HTTP');

addH2('Request & Response Format');
addCodeBlock([
    '// Request Body',
    '{',
    '  "projectId": "51c04beb753a42f3",',
    '  "query": "SELECT id, name, email FROM users WHERE active = $1 LIMIT 5;",',
    '  "params": [true]',
    '}',
    '',
    '// Success Response (HTTP 200)',
    '{',
    '  "success": true,',
    '  "result": {',
    '    "rows": [{ "id": 1, "name": "Alice", "email": "alice@example.com" }],',
    '    "columns": ["id", "name", "email"],',
    '    "rowCount": 1,',
    '    "message": null',
    '  },',
    '  "executionInfo": { "time": "9ms", "rowCount": 1, "operation": "SELECT" }',
    '}',
], 'JSON');

addH2('Advanced SQL: Window Functions & CTEs');
addText('Fluxbase fully executes complex analytical queries with LAG, LEAD, and epoch calculations:');
addCodeBlock([
    'WITH ordered_predictions AS (',
    '  SELECT *,',
    '         LAG(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp',
    '  FROM predictions',
    '),',
    'time_differences AS (',
    '  SELECT timestamp,',
    '         prev_timestamp,',
    '         EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) AS time_diff_seconds',
    '  FROM ordered_predictions',
    '  WHERE prev_timestamp IS NOT NULL',
    ')',
    'SELECT MAX(time_diff_seconds) AS longest_shutdown_time_seconds',
    'FROM time_differences;',
], 'sql');

addAlert('Execution Rule',
    'SQL runtime errors return HTTP 200 with { success: false, error: { message, code: "SQL_EXEC_ERROR" } }.\n' +
    'Always verify the success boolean in application code rather than relying only on HTTP status.',
    'warn'
);

// ═════════════════════════════════════════════════════════════════════════════
// 6. MULTI-LANGUAGE SDKS
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('5. Language SDKs & Code Snippets');
addText('Fluxbase is a standard RESTful service. Use native HTTP clients in any programming language.');

addH2('Node.js / TypeScript (Native fetch)');
addCodeBlock([
    "const BASE_URL = 'https://www.fluxbasedb.me';",
    "const API_KEY  = process.env.FLUXBASE_API_KEY;",
    "const PROJECT  = process.env.FLUXBASE_PROJECT_ID;",
    '',
    'async function query(sql, params = []) {',
    "  const res = await fetch(`${BASE_URL}/api/execute-sql`, {",
    "    method: 'POST',",
    "    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },",
    '    body: JSON.stringify({ projectId: PROJECT, query: sql, params })',
    '  });',
    '  const json = await res.json();',
    "  if (!json.success) throw new Error(json.error?.message ?? 'Query failed');",
    '  return json.result.rows;',
    '}',
    '',
    "const users = await query('SELECT * FROM users WHERE active = $1', [true]);",
], 'javascript');

addH2('Python (requests)');
addCodeBlock([
    'import os, requests',
    '',
    "URL = 'https://www.fluxbasedb.me/api/execute-sql'",
    "HEADERS = { 'Authorization': f'Bearer {os.getenv(\"FLUXBASE_API_KEY\")}', 'Content-Type': 'application/json' }",
    '',
    'def query(sql, params=None):',
    "    payload = {'projectId': os.getenv('FLUXBASE_PROJECT_ID'), 'query': sql}",
    "    if params: payload['params'] = params",
    '    resp = requests.post(URL, json=payload, headers=HEADERS).json()',
    "    if not resp.get('success'): raise Exception(resp.get('error', {}).get('message'))",
    "    return resp['result']['rows']",
    '',
    "rows = query('SELECT * FROM users LIMIT 10')",
], 'python');

addH2('Go (net/http)');
addCodeBlock([
    'body, _ := json.Marshal(map[string]any{',
    '    "projectId": os.Getenv("FLUXBASE_PROJECT_ID"),',
    '    "query":     "SELECT * FROM users LIMIT 10",',
    '})',
    'req, _ := http.NewRequest("POST", "https://www.fluxbasedb.me/api/execute-sql", bytes.NewBuffer(body))',
    'req.Header.Set("Authorization", "Bearer " + os.Getenv("FLUXBASE_API_KEY"))',
    'req.Header.Set("Content-Type", "application/json")',
    'resp, err := http.DefaultClient.Do(req)',
], 'go');

addH2('cURL');
addCodeBlock([
    'curl -X POST "https://www.fluxbasedb.me/api/execute-sql" \\',
    '  -H "Authorization: Bearer $FLUXBASE_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{"projectId":"YOUR_PROJECT_ID","query":"SELECT * FROM users LIMIT 5;"}\'',
], 'bash');

// ═════════════════════════════════════════════════════════════════════════════
// 7. REAL-TIME WEBSOCKETS & SSE
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('6. Real-Time WebSockets & Streaming');
addText(
    'Fluxbase broadcasts database change events in real-time. Whenever an INSERT, UPDATE, DELETE, or DDL migration ' +
    'occurs, change events stream directly to connected clients within 10–25 milliseconds.'
);

addAlert('WebSocket Gateway Architecture',
    'Production WebSocket URL: wss://fluxbase-realtime.onrender.com\n' +
    'Room Convention: "project_<PROJECT_ID>"\n' +
    'Clients subscribe to project rooms and automatically receive filtered table mutation events.',
    'info'
);

addH2('Browser / Node.js WebSocket Example');
addCodeBlock([
    "const ws = new WebSocket('wss://fluxbase-realtime.onrender.com');",
    '',
    'ws.onopen = () => {',
    '  // Subscribe to project room',
    '  ws.send(JSON.stringify({',
    "    type: 'subscribe',",
    "    roomId: 'project_YOUR_PROJECT_ID'",
    '  }));',
    '};',
    '',
    'ws.onmessage = (event) => {',
    '  const msg = JSON.parse(event.data);',
    "  if (msg.type === 'db_event') {",
    '    console.log(`[${msg.payload.operation}] on table ${msg.payload.table}:`, msg.payload.record);',
    '  }',
    '};',
], 'javascript');

addH2('Real-time Event Schema');
addTable(
    ['Message Type', 'Payload Operation', 'Trigger Event'],
    [
        ['subscribed', '—', 'Server acknowledges subscription to project channel'],
        ['db_event', 'INSERT', 'A new row was added via SQL API or Table Editor'],
        ['db_event', 'UPDATE', 'An existing row was modified'],
        ['db_event', 'DELETE', 'A row was removed from a table'],
        ['db_event', 'schema_update', 'DDL executed: CREATE, ALTER, DROP, or TRUNCATE TABLE'],
    ],
    [90, 110, 305]
);

// ═════════════════════════════════════════════════════════════════════════════
// 8. STORAGE V2
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('7. Storage v2 (AWS S3-Backed File Engine)');
addText(
    'Fluxbase Storage provides isolated S3 buckets, private-by-default access, and pre-signed temporary URLs. ' +
    'Store user avatars, PDF invoices, datasets, media files, and backups securely.'
);

addH2('File Operations');
addTable(
    ['Method', 'Endpoint', 'Description'],
    [
        ['POST', '/api/storage/buckets', 'Create a bucket { projectId, name, isPublic }'],
        ['GET', '/api/storage/buckets?projectId=...', 'List all buckets and size rollups'],
        ['POST', '/api/storage/upload', 'Upload file via multipart/form-data (file, bucketId, projectId)'],
        ['GET', '/api/storage/url?s3Key=...&projectId=...', 'Generate 15-minute secure pre-signed download URL'],
        ['DELETE', '/api/storage/files', 'Delete file from S3 and metadata database'],
    ],
    [65, 230, 210]
);

addH2('Uploading via JavaScript');
addCodeBlock([
    'const formData = new FormData();',
    "formData.append('file', fileInput.files[0]);",
    "formData.append('bucketId', 'avatars');",
    "formData.append('projectId', 'YOUR_PROJECT_ID');",
    '',
    "const res = await fetch('https://www.fluxbasedb.me/api/storage/upload', {",
    "  method: 'POST',",
    "  headers: { 'Authorization': `Bearer ${API_KEY}` },",
    '  body: formData',
    '});',
    'const { file } = await res.json();',
    '// file.s3_key is saved to your table for later URL retrieval',
], 'javascript');

addH2('Supported MIME Types & Tier Limits');
addBullet('Images: JPEG, PNG, GIF, WebP, SVG, AVIF');
addBullet('Documents: PDF, TXT, CSV, JSON, Markdown');
addBullet('Media: MP4, WebM, MP3, WAV, ZIP archives');
addBullet('Tier Limits: Free (50 MB/file), Pro (500 MB/file), Enterprise (2 GB/file)');

// ═════════════════════════════════════════════════════════════════════════════
// 9. TEAM COLLABORATION & WEBHOOKS
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('8. Team Collaboration & Webhooks');
addText('Manage project collaborators, role-based access, and outbound webhooks programmatically.');

addH2('Team Management API');
addCodeBlock([
    'GET    /api/team?projectId=YOUR_PROJECT_ID              // List active members & pending invites',
    'POST   /api/team                                        // Invite member: { projectId, email, role }',
    'DELETE /api/team?projectId=...&userId=...              // Remove user from project',
    'POST   /api/team/invites/accept                         // Accept invite: { inviteId, status: "accepted" }',
], 'HTTP');

addH3('Role-Based Access Control (RBAC)');
addTable(
    ['Role', 'Data Access', 'Administrative Privileges'],
    [
        ['admin', 'Full SELECT, INSERT, UPDATE, DELETE', 'Manage billing, API keys, team members, and settings'],
        ['developer', 'Full SELECT, INSERT, UPDATE, DELETE', 'Manage schemas, execute queries, view logs. No billing'],
        ['viewer', 'Read-only (SELECT)', 'Inspect dashboard, schema, and read data. No modifications'],
    ],
    [75, 200, 230]
);

addH2('Outbound Webhooks');
addText('Fluxbase posts JSON events directly to your serverless or backend endpoint on table mutations.');
addCodeBlock([
    'POST /api/fluxbase-webhook',
    'X-Fluxbase-Signature: sha256=d58e37... (HMAC-SHA256 signature)',
    'Content-Type: application/json',
    '',
    '{',
    '  "event_type": "row.inserted",',
    '  "project_id": "YOUR_PROJECT_ID",',
    '  "table_id": "orders",',
    '  "timestamp": "2026-09-18T20:00:00.000Z",',
    '  "data": {',
    '    "new": { "id": 101, "amount": 89.50, "status": "paid" },',
    '    "old": null',
    '  }',
    '}',
], 'JSON');

addH3('Signature Verification in Node.js');
addCodeBlock([
    "import crypto from 'crypto';",
    '',
    'export async function POST(req) {',
    '  const rawBody = await req.text();',
    "  const sig = req.headers.get('x-fluxbase-signature') ?? '';",
    '  const secret = process.env.FLUXBASE_WEBHOOK_SECRET;',
    "  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');",
    '  if (sig !== expected) return new Response("Unauthorized", { status: 401 });',
    '  // Process webhook payload safely...',
    '  return new Response("OK", { status: 200 });',
    '}',
], 'javascript');

// ═════════════════════════════════════════════════════════════════════════════
// 10. ERROR CODES & ROW LEVEL SECURITY
// ═════════════════════════════════════════════════════════════════════════════
newPage();
addTitle('9. Error Codes & Row-Level Security');

addH2('Standardized Error Codes');
addTable(
    ['Status', 'Error Code', 'Remediation Guide'],
    [
        ['401', 'AUTH_REQUIRED', 'Missing Authorization: Bearer <key> header'],
        ['401', 'TOKEN_EXPIRED', 'JWT session or API key has expired. Re-authenticate'],
        ['403', 'SCOPE_MISMATCH', 'API key lacks required scope (e.g., ai key used for DDL)'],
        ['403', 'PROJECT_SUSPENDED', 'Project is suspended due to quota limits or billing'],
        ['404', 'PROJECT_NOT_FOUND', 'Verify project identifier in Settings → Project ID'],
        ['429', 'RATE_LIMIT', 'Exceeded 50 req/10s per project. Use exponential backoff'],
        ['200', 'SQL_EXEC_ERROR', 'Database execution syntax error. Inspect error.details'],
        ['500', 'INTERNAL_ERROR', 'Unexpected server condition. Auto-logged for monitoring'],
    ],
    [50, 130, 325]
);

addH2('Row-Level Security (RLS) & Multi-Tenant Isolation');
addText(
    'Fluxbase injects the authenticated caller ID via PostgreSQL session state before query execution: ' +
    'SET LOCAL fluxbase.auth_uid = $1. This ensures data isolation at the database engine level.'
);

addH3('Common RLS Policy Patterns');
addBullet('User Owns Their Data: USING (user_id = auth.uid())');
addBullet('Organization Multi-Tenancy: USING (org_id = auth.uid())');
addBullet('Public Read / Owner Write: Policy 1 SELECT (true), Policy 2 UPDATE (author_id = auth.uid())');
addBullet('Full Internal Lockdown: USING (false) — prevents all external API access to sensitive audit tables');

addAlert('Interactive Documentation & Support',
    'Interactive Documentation: https://www.fluxbasedb.me/docs\n' +
    'Direct PDF Download: https://www.fluxbasedb.me/api/docs/download-pdf\n' +
    'Technical Support: sumithsumith4567890@gmail.com',
    'success'
);

// ═════════════════════════════════════════════════════════════════════════════
// WRITE PDF FILE
// ═════════════════════════════════════════════════════════════════════════════
const pdfBytes = doc.output('arraybuffer');
writeFileSync(join(publicDir, 'fluxbase-integration-guide.pdf'), Buffer.from(pdfBytes));
console.log('✅  Successfully generated comprehensive PDF at public/fluxbase-integration-guide.pdf');

} catch (error) {
    console.error('FATAL ERROR DURING PDF GENERATION:', error);
    process.exit(1);
}
