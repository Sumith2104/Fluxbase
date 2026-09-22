# Fluxbase Infrastructure & Services Specification Manual
**Master Reference & Disaster Recovery Blueprint**  
*Document Version: 1.0.0 — Production Environment (`https://fluxbasedb.me`)*

---

## 1. High-Level Architecture Topology

```mermaid
graph TD
    User([Browser / Mobile Client]) -->|HTTPS :443 / WSS :4000| Route53[AWS Route 53 DNS<br/>fluxbasedb.me]
    Route53 -->|A Record : 13.206.125.88| Caddy[Caddy 2 Reverse Proxy<br/>Port 80 / 443<br/>Auto-TLS & HTTP/3]
    
    subgraph AWS EC2 Instance [AWS EC2 Graviton t4g.large — 13.206.125.88 — ap-south-1]
        Caddy -->|Reverse Proxy :3000| App[Next.js 15.5 Web App & REST API<br/>fluxbase-app]
        Caddy -->|Reverse Proxy :4000| WS[Realtime WebSocket Gateway<br/>fluxbase-websocket]
        App -->|ioredis :6379| Redis[Redis 7 Alpine Cache & Rate Limiter<br/>fluxbase-redis]
        WS -->|ioredis :6379| Redis
        Scraper[Fluxbase Headless Scraper<br/>fluxbase-scraper-engine :8080]
    end

    subgraph AWS Managed Cloud Services [AWS Cloud — Region: ap-south-1 Mumbai]
        App -->|pg Pool :5432| RDS_PG[(AWS RDS PostgreSQL 17.9<br/>fluxbase-master-db-new)]
        WS -->|LISTEN / NOTIFY :5432| RDS_PG
        Scraper -->|SQL queries :5432| RDS_PG
        App -->|mysql2 :3306| RDS_MY[(AWS RDS MySQL 8.4.8<br/>database-1-new)]
        App -->|AWS S3 SDK :443| S3[(Amazon S3 Bucket<br/>fluxbase-storage)]
        App -->|AWS SES SDK :443| SES[Amazon SES Email Service<br/>support@fluxbasedb.me]
    end

    subgraph External Financial Gateways [External Integrations]
        App -->|REST Webhooks| Razorpay[Razorpay Payment Gateway]
        App -->|REST APIs| FluxAI[FluxAI Family: GLM-4 / Gemini / Groq]
    end
```

---

## 2. Complete Inventory of Services & Versions

### A. AWS Cloud Infrastructure Services

| Service | Resource Name / ID | Type / Class | Engine / OS Version | Region / AZ | Primary Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Compute (EC2)** | `fluxbase-production-server`<br/>`i-0fc87f65267311549` | `t4g.large`<br/>(2 vCPU, 8 GB RAM) | Amazon Linux 2023 / Docker 27.x | `ap-south-1a`<br/>(Public IP: `13.206.125.88`) | Hosts all application Docker containers, Caddy proxy, and WebSocket server. |
| **Primary Database (RDS)** | `fluxbase-master-db-new` | `db.t3.micro`<br/>(20 GB gp2) | PostgreSQL 17.9 | `ap-south-1` | Primary database: users, projects, tables, schema definitions, storage metadata, analytics, audit logs. |
| **Multi-Tenant DB (RDS)** | `database-1-new` | `db.t3.micro`<br/>(20 GB gp2) | MySQL 8.4.8 | `ap-south-1` | Dedicated MySQL multi-tenant project databases for MySQL engine tenants. |
| **Object Storage (S3)** | `fluxbase-storage` | S3 Standard | AWS S3 REST API v2 | `ap-south-1` | Stores user uploaded files, buckets, documents, images, and project backups. |
| **Domain & DNS** | `fluxbasedb.me`<br/>`Z00637411I9ALMVMC5GBN` | Public Hosted Zone | AWS Route 53 | Global | Authoritative DNS resolution, apex routing, and DKIM/SPF email security records. |
| **Email Service** | `fluxbasedb.me`<br/>`support@fluxbasedb.me` | Managed SES | Amazon SES v2 | `ap-south-1` | Transactional emails: auth verification codes, reset passwords, invite links, billing alerts. |

---

### B. Docker Container Services on EC2

All containers run inside `/opt/fluxbase/app` orchestrated by `docker-compose.prod.yml` attached to the internal bridge network `fluxbase-network`.

| Container Name | Service Name | Base Image | Internal Port | Exposed Port | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`fluxbase-app`** | `app` | `node:20-alpine` (Next.js Standalone) | `3000` | Internal `3000` | Next.js 15.5 Web UI, REST API engine, auth handlers, AI gateway, and MCP protocol server. |
| **`fluxbase-websocket`** | `websocket` | `node:20-alpine` (`tsx websocket.ts`) | `4000` | Internal `4000` | Real-time WebSocket server. Listens to PostgreSQL `LISTEN flux_realtime` and broadcasts row mutations. |
| **`fluxbase-redis`** | `redis` | `redis:7-alpine` | `6379` | `127.0.0.1:6379` | In-memory cache, rate limiting, and table row query caching (512 MB LRU policy). |
| **`fluxbase-proxy`** | `caddy` | `caddy:2-alpine` | `80`, `443` | `0.0.0.0:80`, `443` (TCP/UDP) | Reverse proxy, automatic SSL/TLS certificate management, HTTP/3 QUIC protocol, and static asset caching. |
| **`fluxbase-scraper-engine`**| `scraper-engine`| `node:20-bookworm-slim` (Playwright) | `8080` | Internal `8080` | Autonomous web scraping worker. Executes scheduled scraping jobs and writes results to PostgreSQL. |
| **`fluxbase-gateway`** | `gateway` | `node:20-alpine` (Next.js 15.5) | `3001` | Internal `3001` | FluxPay UPI & Payment Gateway engine, hosted checkout pages (`payments.fluxbasedb.me`), merchant portal, and SMS webhook ingestion. |

---

## 3. Network Ports & Ingress / Egress Matrix

| Port | Protocol | Scope | Direction | Component | Security Group Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **80** | TCP | Public (Internet) | Ingress | Caddy (`fluxbase-proxy`) | Allowed (`0.0.0.0/0`) — Auto-redirects to HTTPS :443 |
| **443** | TCP / UDP | Public (Internet) | Ingress | Caddy (`fluxbase-proxy`) | Allowed (`0.0.0.0/0`) — Main Web App & WSS Proxy (HTTP/3) |
| **3000** | TCP | Docker Network | Internal | Next.js App (`fluxbase-app`) | Isolated to `fluxbase-network` (Not exposed to Internet) |
| **4000** | TCP | Docker Network | Internal | WebSocket (`fluxbase-websocket`)| Isolated to `fluxbase-network` (Proxied via Caddy `/ws*`) |
| **6379** | TCP | Docker Network / Host | Internal | Redis 7 (`fluxbase-redis`) | Bound to `127.0.0.1:6379` & `fluxbase-network` only |
| **8080** | TCP | Docker Network | Internal | Scraper (`fluxbase-scraper-engine`)| Isolated to `fluxbase-network` |
| **5432** | TCP | AWS VPC / RDS | Egress | AWS RDS PostgreSQL | Allowed outbound to RDS Security Group |
| **3306** | TCP | AWS VPC / RDS | Egress | AWS RDS MySQL | Allowed outbound to RDS Security Group |

---

## 4. Master Environment Configuration Reference (`.env.production`)

File location on EC2: `/opt/fluxbase/app/.env.production`

```env
# ═══════════════════════════════════════════════════════════════════════════════
# FLUXBASE PRODUCTION CONFIGURATION (100% AWS ARCHITECTURE)
# ═══════════════════════════════════════════════════════════════════════════════

NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
WS_PORT=4000

# ─── Domain & Networking ──────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://fluxbasedb.me
NEXT_PUBLIC_WS_URL=wss://fluxbasedb.me/ws
NEXT_PUBLIC_COOKIE_DOMAIN=.fluxbasedb.me
ALLOWED_ORIGINS=https://www.fluxbasedb.me,https://fluxbasedb.me
LOG_LEVEL=info

# ─── Authentication & Session Security ─────────────────────────────────────────
# Generate high entropy 64-char key: openssl rand -base64 48
JWT_SECRET=your_high_entropy_production_jwt_secret_64_chars

# ─── AWS Infrastructure: Primary Database (PostgreSQL 17.9) ───────────────────
AWS_RDS_POSTGRES_URL=postgresql://postgres:YOUR_PASSWORD@fluxbase-master-db-new.cfiq4kike9fg.ap-south-1.rds.amazonaws.com:5432/postgres?sslmode=require

# ─── AWS Infrastructure: MySQL Database (MySQL 8.4.8) ─────────────────────────
AWS_RDS_MYSQL_URL=mysql://admin:YOUR_PASSWORD@database-1-new.cfiq4kike9fg.ap-south-1.rds.amazonaws.com:3306/fluxbase
AWS_RDS_MYSQL_HOST=database-1-new.cfiq4kike9fg.ap-south-1.rds.amazonaws.com
AWS_RDS_MYSQL_PORT=3306
AWS_RDS_MYSQL_USER=admin
AWS_RDS_MYSQL_PASSWORD=YOUR_PASSWORD

# ─── In-Memory Cache (Native AWS / Docker Redis 7) ─────────────────────────────
# Sub-millisecond TCP connection inside Docker network:
REDIS_URL=redis://redis:6379

# ─── AWS Infrastructure: S3 Object Storage ────────────────────────────────────
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET=fluxbase-storage
AWS_S3_REGION=ap-south-1

# ─── AWS Infrastructure: SES Email Dispatch ───────────────────────────────────
USE_AWS_SES=true
AWS_SES_REGION=ap-south-1
SMTP_FROM="Fluxbase <support@fluxbasedb.me>"
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=YOUR_SES_SMTP_USER
SMTP_PASS=YOUR_SES_SMTP_PASSWORD
SMTP_SECURE=false

# ─── FluxAI Engine Family (Intelligent Multi-Provider) ─────────────────────────
# Primary: Zhipu AI GLM-4 family
GLM_API_KEY=your_zhipu_glm_api_key
GLM_MODEL=glm-4-flash

# Fallback 1: Google Gemini (Gemini 2.5 Flash / 2.0 Flash)
GEMINI_API_KEY=your_google_gemini_api_key

# Fallback 2: Groq (Llama 3.3 70B Versatile)
GROQ_API_KEY=your_groq_api_key

# ─── Payment Gateway & Webhooks ───────────────────────────────────────────────
RAZORPAY_KEY_ID=rzp_live_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

FLUXPAY_GATEWAY_URL=https://payments.fluxbasedb.me
NEXT_PUBLIC_FLUXPAY_URL=https://payments.fluxbasedb.me
```

---

## 5. Route 53 DNS Configuration (Public Hosted Zone)

Hosted Zone: `fluxbasedb.me` (`Z00637411I9ALMVMC5GBN`)

| Record Name | Record Type | TTL | Target Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `fluxbasedb.me` | `A` | 300 | `13.206.125.88` | Apex domain pointing to EC2 instance |
| `www.fluxbasedb.me` | `A` | 300 | `13.206.125.88` | WWW subdomain |
| `payments.fluxbasedb.me` | `A` | 300 | `13.206.125.88` | Payments gateway subdomain |
| `_amazonses.fluxbasedb.me` | `TXT` | 300 | `"KatgLwHGxB5O+QTeAXxyZUdnWXmu/kJg+f77YE2eWTM="` | Amazon SES domain ownership verification token |
| `fluxbasedb.me` | `TXT` | 300 | `"v=spf1 include:amazonses.com ~all"` | SPF record authorizing Amazon SES email sending |
| `gq2hb67mdqlrcbifiqeihh7z4gbexixv._domainkey.fluxbasedb.me` | `CNAME` | 300 | `gq2hb67mdqlrcbifiqeihh7z4gbexixv.dkim.amazonses.com` | Amazon SES DKIM Key 1 |
| `bmbrx5uw7jnihkpgezxdlaoc3lisfuqq._domainkey.fluxbasedb.me` | `CNAME` | 300 | `bmbrx5uw7jnihkpgezxdlaoc3lisfuqq.dkim.amazonses.com` | Amazon SES DKIM Key 2 |
| `c3ipytczhx5srmsijl24mw4qctrmar26._domainkey.fluxbasedb.me` | `CNAME` | 300 | `c3ipytczhx5srmsijl24mw4qctrmar26.dkim.amazonses.com` | Amazon SES DKIM Key 3 |

> **Namecheap Registrar Delegation**:  
> To activate Route 53 DNS, point the Custom DNS NameServers in Namecheap to:
> - `ns-1933.awsdns-49.co.uk`
> - `ns-58.awsdns-07.com`
> - `ns-1361.awsdns-42.org`
> - `ns-559.awsdns-05.net`

---

## 6. Step-by-Step Disaster Recovery: Rebuild Entire Stack From Scratch

If the server or any component is lost, follow these steps to restore production from zero:

### Step 1: Provision AWS Infrastructure
1. **EC2**: Launch an EC2 instance:
   - OS: Amazon Linux 2023 / Ubuntu 24.04 ARM64 (aarch64).
   - Instance Type: `t4g.large` (2 vCPU, 8 GB RAM).
   - Storage: 50 GB gp3 root volume.
   - Elastic IP: Allocate and associate an Elastic IP (e.g. `13.206.125.88`).
2. **Security Groups**: Open ports `80` (HTTP), `443` (HTTPS/QUIC).
3. **RDS PostgreSQL**: Create RDS PostgreSQL 17 database `fluxbase-master-db-new` with public accessibility or VPC peering.
4. **RDS MySQL**: Create RDS MySQL 8.4 database `database-1-new`.
5. **S3 Bucket**: Create bucket `fluxbase-storage` in `ap-south-1`.

### Step 2: Initialize Server Environment
SSH or connect via AWS SSM Session Manager into the EC2 instance:
```bash
sudo yum update -y
sudo yum install -y git docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Install Docker Compose Plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
```

### Step 3: Clone Codebase & Configure Environment
```bash
sudo mkdir -p /opt/fluxbase
sudo chown -R ec2-user:ec2-user /opt/fluxbase
cd /opt/fluxbase
git clone https://github.com/Sumith2104/Fluxbase.git app
cd /opt/fluxbase/app

# Populate production configuration
cp .env.production.example .env.production
nano .env.production # Fill in database URLs, AWS secrets, and JWT_SECRET
```

### Step 4: Launch All Containers
```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

### Step 5: Verify Container Health
```bash
docker ps
# Expected healthy containers:
# 1. fluxbase-proxy (caddy)
# 2. fluxbase-app (Next.js)
# 3. fluxbase-websocket (WS Gateway)
# 4. fluxbase-redis (Redis 7)
# 5. fluxbase-scraper-engine (Playwright Daemon)
```

---

## 7. Essential Operations & Maintenance Cheatsheet

```bash
# View live logs of all services
docker compose -f docker-compose.prod.yml logs -f --tail 50

# View specific container logs
docker logs fluxbase-app -f --tail 100
docker logs fluxbase-websocket -f --tail 100
docker logs fluxbase-proxy -f --tail 100

# Restart application after code updates
git pull origin main
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d --no-deps app

# Test Redis cache latency locally
docker exec fluxbase-redis redis-cli ping
docker exec fluxbase-redis redis-cli info memory

# Take manual PostgreSQL backup to S3
docker exec fluxbase-app node -e '
  const { execSync } = require("child_process");
  execSync("pg_dump $AWS_RDS_POSTGRES_URL | gzip > /tmp/backup.sql.gz");
  console.log("Database dump completed successfully.");
'
```
