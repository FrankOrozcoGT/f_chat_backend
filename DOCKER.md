# Docker Setup - F-Chat Backend

## 🐳 Quick Start

### 1. Prerequisites
- Docker Engine 24+ installed
- Docker Compose V2 installed
- `.env` file configured (copy from `.env.example`)

### 2. Environment Setup

```bash
# Copy and configure .env
cp .env.example .env

# Edit .env with your values
nano .env
```

**Required variables for Docker:**
```env
# Database (Docker internal)
DATABASE_URL=postgresql://fchat:your-password@postgres:5432/fchat?schema=public

# PostgreSQL credentials
POSTGRES_USER=fchat
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=fchat

# JWT
JWT_SECRET=your-jwt-secret-min-32-chars

# Evolution API (external or docker)
EVOLUTION_API_URL=http://evolution_api:8080
EVOLUTION_GLOBAL_API_KEY=your-evolution-key

# Backend URLs
BACKEND_URL=http://localhost:3000
BACKEND_URL_FOR_DOCKER=http://172.17.0.1:3000

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

### 3. Build and Run

```bash
# Build images
docker-compose build

# Start services (detached mode)
docker-compose up -d

# View logs
docker-compose logs -f backend

# Check health
curl http://localhost:3000/health
```

### 4. Stop Services

```bash
# Stop containers
docker-compose down

# Stop and remove volumes (⚠️ deletes database)
docker-compose down -v
```

## 📂 Project Structure

```
backend/
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # Services orchestration
├── .dockerignore          # Build optimization
├── .env                   # Environment variables (gitignored)
├── .env.example           # Environment template
└── storage/               # Volume-mounted media files
```

## 🔧 Docker Architecture

### Services

#### 1. **backend** (NestJS API)
- **Image**: Node.js 24 LTS Alpine
- **Port**: 3000
- **Features**:
  - Multi-stage build (optimized size)
  - ffmpeg included (audio conversion webm→ogg)
  - Prisma migrations auto-deploy
  - Health check at `/health`
  - Non-root user (node)
- **Volumes**:
  - `./storage:/app/storage` (media files persistence)
  - `./logs:/app/logs` (optional logs)

#### 2. **postgres** (PostgreSQL Database)
- **Image**: PostgreSQL 16 Alpine
- **Port**: 5432
- **Volume**: `postgres_data` (persistent)
- **Health check**: `pg_isready`

### Network
- **fchat_network**: Bridge network for inter-service communication

## 🚀 Development Workflow

### Local Development (without Docker)
```bash
npm run start:dev
```

### Production-like (with Docker)
```bash
docker-compose up --build
```

### Rebuild after code changes
```bash
# Rebuild backend only
docker-compose build backend

# Restart backend service
docker-compose restart backend
```

## 📝 Common Commands

```bash
# View running containers
docker-compose ps

# Execute command in backend container
docker-compose exec backend sh

# View backend logs (last 100 lines)
docker-compose logs --tail=100 backend

# Database migrations (inside container)
docker-compose exec backend npx prisma migrate deploy

# Generate Prisma Client (inside container)
docker-compose exec backend npx prisma generate

# Clean everything (nuclear option)
docker-compose down -v --rmi all
docker system prune -af
```

## 🔍 Troubleshooting

### Backend won't start
```bash
# Check logs
docker-compose logs backend

# Common issues:
# 1. DATABASE_URL incorrect → check postgres service
# 2. Prisma migrations failed → run manually
# 3. Port 3000 in use → change PORT in .env
```

### Database connection failed
```bash
# Verify postgres is healthy
docker-compose ps postgres

# Check DATABASE_URL format
# Must use service name: postgresql://user:pass@postgres:5432/db
```

### Storage files not persisting
```bash
# Verify volume mount
docker-compose exec backend ls -la /app/storage

# Check permissions
docker-compose exec backend id
# Should be user 'node' (uid 1000)
```

## 🎯 Production Deployment

### AWS ECS / Docker Swarm / Kubernetes
1. Push image to registry:
```bash
docker tag fchat_backend:latest your-registry/fchat-backend:v1.0.0
docker push your-registry/fchat-backend:v1.0.0
```

2. Use external managed PostgreSQL (RDS, Cloud SQL, etc.)
3. Mount S3/GCS for `storage/` instead of local volume
4. Set `NODE_ENV=production`
5. Use secrets manager for sensitive env vars

### Environment Variables Checklist
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` (managed DB)
- [ ] `JWT_SECRET` (strong random 32+ chars)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- [ ] `EVOLUTION_API_URL` (Evolution API instance)
- [ ] `BACKEND_URL` (public domain)
- [ ] `FRONTEND_URL` (public frontend domain)

## 📊 Resource Requirements

### Minimum
- **CPU**: 1 core
- **RAM**: 512MB
- **Disk**: 2GB (+ storage for media files)

### Recommended
- **CPU**: 2 cores
- **RAM**: 1GB
- **Disk**: 10GB SSD

## 🔗 Related Services

This backend works with:
- **Evolution API**: WhatsApp Business API integration (separate docker container)
- **Frontend**: React/Vue/Next.js app (CORS configured)
- **PostgreSQL**: Database (included in docker-compose)

## 📚 References

- [Node.js 24 LTS Release](https://nodejs.org/en/blog/release/v24.0.0)
- [NestJS Docker Best Practices](https://docs.nestjs.com/recipes/prisma#docker)
- [Prisma with Docker](https://www.prisma.io/docs/guides/deployment/deployment-guides/docker)
- [ffmpeg Alpine](https://pkgs.alpinelinux.org/package/edge/community/x86_64/ffmpeg)
