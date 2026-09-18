# Fluxbase All-in-One AWS Production Deployment Guide

This guide walks you through deploying the complete Fluxbase stack onto **AWS Mumbai (`ap-south-1`)** under the domain **`fluxbasedb.me`** with zero downtime.

---

## Architecture Summary

* **Region**: AWS Mumbai (`ap-south-1`)
* **Instance**: EC2 `t4g.large` (ARM Graviton, 2 vCPU, 8GB RAM, 40GB gp3 SSD)
* **IP Address**: Dedicated AWS Elastic IP (EIP)
* **Reverse Proxy**: Caddy 2 (automatic HTTPS for `fluxbasedb.me` and `www.fluxbasedb.me`)
* **Services**:
  * Next.js Web App, REST Engine, AI Gateway (`/api/v1`), and MCP Gateway (`/api/mcp`) on port 3000
  * Realtime WebSocket server on port 4000
  * High-speed Redis 7 cache & rate-limiter on port 6379
  * Direct sub-millisecond connection to your AWS RDS PostgreSQL database

---

## Step 1: Provision the Server via AWS CloudFormation

You can launch the infrastructure with 1 click using the provided template:

1. Open the [AWS CloudFormation Console (Mumbai Region)](https://ap-south-1.console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks/create/template).
2. Choose **Upload a template file** and select `aws/fluxbase-stack.yaml` from this repository.
3. Click **Next**.
4. Configure Parameters:
   * **Stack name**: `fluxbase-production`
   * **DomainName**: `fluxbasedb.me`
   * **InstanceType**: `t4g.large` (or `t3.large`)
   * **VolumeSize**: `40` (GB)
   * **KeyName**: Select your existing EC2 Key Pair (or leave blank to use AWS Session Manager).
5. Click **Next** -> **Next**, check the box **"I acknowledge that AWS CloudFormation might create IAM resources"**, and click **Submit**.
6. CloudFormation will create the Security Group, IAM Role, EC2 Instance, and Elastic IP in ~2 minutes.

---

## Step 2: Connect to Your New EC2 Instance

You have two easy ways to connect:

### Option A: AWS Console 1-Click (Session Manager — No SSH keys needed)
1. Go to the [EC2 Instances Console](https://ap-south-1.console.aws.amazon.com/ec2/home?region=ap-south-1#Instances:).
2. Select `fluxbase-production-server`.
3. Click **Connect** at the top right, choose **Session Manager**, and click **Connect**.
4. Switch to the `ubuntu` user:
   ```bash
   sudo su - ubuntu
   ```

### Option B: Standard SSH
```bash
ssh -i your-key.pem ubuntu@<YOUR_ELASTIC_IP>
```

---

## Step 3: Clone Repository & Configure Environment

Run these commands inside your EC2 terminal:

```bash
# 1. Navigate to the app directory
cd /opt/fluxbase

# 2. Clone your Fluxbase repository
git clone https://github.com/Sumith2104/Fluxbase.git .

# 3. Create your production environment file
cp .env.production.example .env.production
nano .env.production
```

Fill in your actual production secrets in `.env.production`:
* `JWT_SECRET`: Random 64-character secret
* `AWS_RDS_POSTGRES_URL`: Your AWS RDS connection string
* `GLM_API_KEY`: Your AI Gateway key
* `AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY`: S3 storage credentials

---

## Step 4: Run the Automated Deploy Script

```bash
chmod +x scripts/deploy-aws.sh
./scripts/deploy-aws.sh
```

This script will:
1. Verify Docker and Docker Compose.
2. Build the Next.js standalone container.
3. Build the WebSocket server container.
4. Launch Redis, Next.js, WebSockets, and Caddy.
5. Verify that all services are healthy.

---

## Step 5: Configure DNS for `fluxbasedb.me`

In your domain registrar / DNS provider (Cloudflare, Route 53, GoDaddy, or Namecheap):

1. **A-Record** (Root domain):
   * **Type**: `A`
   * **Name**: `@` (or `fluxbasedb.me`)
   * **Value**: `<YOUR_AWS_ELASTIC_IP>`
   * **TTL**: Auto or 300 seconds

2. **CNAME / A-Record** (www subdomain):
   * **Type**: `CNAME`
   * **Name**: `www`
   * **Value**: `fluxbasedb.me`

> **Note on SSL**: Within 10–30 seconds after DNS propagates, Caddy automatically requests and installs a valid Let's Encrypt SSL certificate for both `fluxbasedb.me` and `www.fluxbasedb.me`. No manual certbot or renewal scripts needed!

---

## Step 6: What Happens to Your Vercel Link?

* **Your `*.vercel.app` domain continues to run independently**: Vercel still receives your Git pushes and builds previews.
* Users visiting `https://fluxbasedb.me` will now be routed directly to your ultra-fast AWS Mumbai server.
* If you want visitors to the `.vercel.app` link to automatically jump to `https://fluxbasedb.me`, simply add a redirect in Vercel settings or Next.js middleware.

---

## Useful Maintenance Commands

```bash
# View live logs across all services:
docker compose -f docker-compose.prod.yml logs -f

# Check container status:
docker compose -f docker-compose.prod.yml ps

# Restart the entire stack:
docker compose -f docker-compose.prod.yml restart

# Deploy an update after git pull:
./scripts/deploy-aws.sh
```
