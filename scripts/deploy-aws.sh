#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Fluxbase All-in-One AWS Production Deployment Script
# Target: AWS EC2 (Ubuntu 24.04 LTS, ap-south-1 Mumbai)
# Domain: https://fluxbasedb.me
# ═══════════════════════════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}  Fluxbase Production Deployment — AWS ap-south-1    ${NC}"
echo -e "${BLUE}  Domain: fluxbasedb.me                               ${NC}"
echo -e "${BLUE}======================================================${NC}"

# 1. Verify Docker installation
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[!] Docker not found. Installing Docker CE...${NC}"
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker $USER
    echo -e "${GREEN}[✓] Docker installed successfully.${NC}"
fi

# 2. Check for .env.production
if [ ! -f ".env.production" ]; then
    echo -e "${RED}[ERROR] .env.production file is missing!${NC}"
    echo -e "Please create .env.production based on .env.production.example before deploying."
    exit 1
fi

# 3. Pull latest Git updates if inside a repo
if [ -d ".git" ]; then
    echo -e "${BLUE}[*] Pulling latest updates from Git...${NC}"
    git pull origin main || echo -e "${YELLOW}[!] Continuing with local files...${NC}"
fi

# 4. Build and start services using Docker Compose
echo -e "${BLUE}[*] Building and launching Fluxbase services (App, WS, Redis, Caddy)...${NC}"
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml up -d --build

# 5. Wait for health checks
echo -e "${BLUE}[*] Verifying service health...${NC}"
sleep 10

echo -e "\n${BLUE}── Service Status ──${NC}"
docker compose -f docker-compose.prod.yml ps

# 6. Basic local connection checks
echo -e "\n${BLUE}── Checking Endpoints ──${NC}"
if curl -s -f http://localhost:3000 > /dev/null; then
    echo -e "${GREEN}[✓] Next.js App is UP and responding on port 3000.${NC}"
else
    echo -e "${YELLOW}[!] Next.js App is warming up... check 'docker compose -f docker-compose.prod.yml logs app'${NC}"
fi

if docker exec fluxbase-redis redis-cli ping | grep -q "PONG"; then
    echo -e "${GREEN}[✓] Redis Cache is UP (PONG).${NC}"
else
    echo -e "${RED}[✗] Redis is not responding.${NC}"
fi

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}  Fluxbase All-in-One Deployment Complete!           ${NC}"
echo -e "${GREEN}  Domain: https://fluxbasedb.me                       ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "To view live logs: docker compose -f docker-compose.prod.yml logs -f"
