# F-Chat Backend API

Backend API for F-Chat - WhatsApp Business messaging platform built with NestJS, Prisma, and Evolution API.

## Related repos

This is the backend of a two-repo project. To run the full app, also clone the frontend:

```bash
git clone https://github.com/FrankOrozcoGT/f_chat.git
```

See [f_chat](https://github.com/FrankOrozcoGT/f_chat) for the React frontend.

## 🚀 Features

- **Authentication**: Google OAuth 2.0 with JWT
- **Multi-tenant**: tenant/team management, roles, invitations
- **WhatsApp Integration**: Evolution API for Business messaging
- **AI conversation flows**: node-based flow engine (LangChain/LangGraph) with tenant memory and conversation analysis
- **Catalog**: products, promotions, shipping locations
- **Real-time**: WebSocket (Socket.io) for live updates
- **Queues**: Redis + BullMQ for async/background processing
- **File Upload**: Multipart file upload with automatic conversion (webm→ogg)
- **Media Storage**: Local file storage with Docker volume support
- **Anti-Duplication**: In-memory cache with TTL for sent messages
- **Database**: PostgreSQL with Prisma ORM
- **Webhooks**: Real-time message status updates from Evolution API
- **Health Check**: `/health` endpoint plus admin-only external API monitoring

## 📦 Tech Stack

- **Framework**: NestJS 11
- **Runtime**: Node.js 24 LTS
- **Database**: PostgreSQL 16 + Prisma ORM
- **Queues/Cache**: Redis + BullMQ
- **AI**: LangChain / LangGraph
- **WebSocket**: Socket.io
- **File Conversion**: ffmpeg (audio webm→ogg)
- **Validation**: class-validator + class-transformer
- **Authentication**: Passport.js (Google OAuth + JWT)

## 🏗️ Architecture

```
src/
├── main.ts                    # Application entry point
├── app.module.ts              # Root module
├── common/                    # Shared services
│   ├── prisma/               # Database service
│   ├── evolution/            # Evolution API integration
│   ├── cache/                # In-memory TTL cache
│   ├── file-storage/         # File I/O and conversion
│   └── websocket/            # Socket.io gateway
└── modules/                   # Feature modules
    ├── auth/                    # Google OAuth + JWT
    ├── users/                   # User management
    ├── tenants/                 # Tenant/team management
    ├── tenant-settings/         # Tenant-level settings
    ├── tenant-memory/           # AI flow memory per tenant
    ├── phones/                  # WhatsApp phone instances
    ├── conversations/           # Conversation management
    ├── conversation-analysis/   # AI-driven conversation analysis
    ├── messages/                # Message CRUD + sending
    ├── nodes/                   # AI conversation flow engine
    ├── catalog/                 # Products, promotions, shipping
    ├── contacts/                # Contact management
    ├── hitl/                    # Human-in-the-loop handoff
    ├── queue-system/            # BullMQ queue processing
    ├── dashboard/                # Aggregated stats
    ├── admin/                    # Super-admin endpoints (costs, health)
    ├── webhooks/                 # Evolution API webhooks
    └── health/                   # Health check endpoint
```

## 🐳 Quick Start (Docker - Recommended)

### 1. Clone and Setup
```bash
git clone <repository-url>
cd backend

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### 2. Run with Docker Compose
```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Check health
curl http://localhost:3000/health
```

**Docker includes:**
- ✅ Backend API (Node.js 24 + ffmpeg)
- ✅ PostgreSQL 16
- ✅ Automatic migrations
- ✅ Volume persistence for media files

📖 **Detailed Docker guide**: See [DOCKER.md](./DOCKER.md)

## 💻 Local Development (without Docker)

### Prerequisites
- Node.js 24 LTS
- PostgreSQL 16
- ffmpeg (for audio conversion)

### Installation
```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate
```

### Run
```bash
# Development (watch mode)
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## 🔧 Environment Variables

Required variables (see `.env.example`):

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/fchat

# JWT
JWT_SECRET=your-secret-min-32-chars
JWT_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Admin
ADMIN_EMAILS=admin@example.com

# Frontend
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

# Backend URLs
BACKEND_URL=http://localhost:3000
BACKEND_URL_FOR_DOCKER=http://172.17.0.1:3000

# Evolution API
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_GLOBAL_API_KEY=your-evolution-key
```

## 📡 API Endpoints

### Authentication
- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/profile` - Get current user

### Messages
- `GET /api/messages` - List messages (with pagination)
- `POST /api/messages/send` - Send text message
- `POST /api/messages/send-with-file` - Send media message (multipart/form-data)

### Conversations
- `GET /api/conversations` - List conversations
- `GET /api/conversations/:id` - Get conversation details

### Phones
- `GET /api/phones` - List WhatsApp instances
- `POST /api/phones/create` - Create new instance
- `DELETE /api/phones/:id` - Delete instance

### Webhooks
- `POST /whatsapp/webhook` - Evolution API webhook receiver

### Health
- `GET /health` - Health check endpoint

## 🔌 WebSocket Events

**Client → Server:**
- `join_rooms` - Join user-specific rooms

**Server → Client:**
- `message:new` - New incoming message
- `message:status_updated` - Message status changed (sent/delivered/read)
- `phone:qr_updated` - QR code updated (for pairing)
- `phone:status_changed` - Phone instance status changed

## 🎯 Message Flow

### Sending Messages (API → WhatsApp)
1. Frontend: `POST /api/messages/send-with-file`
2. Backend: Validate + save file
3. Backend: Convert webm→ogg (if audio)
4. Backend: Send to Evolution API
5. Backend: Save to database with `pending` status
6. Backend: Cache keyId (anti-duplication)
7. Webhook: Receive status update from Evolution
8. Backend: Update message status → Emit WebSocket event
9. Frontend: Display updated status

### Receiving Messages (WhatsApp → API)
1. Evolution API: Webhook `POST /whatsapp/webhook`
2. Backend: Check if sent via API (cache lookup)
3. Backend: Download media (if exists)
4. Backend: Save message to database
5. Backend: Emit WebSocket event `message:new`
6. Frontend: Display new message

## 🛠️ Development Scripts

```bash
# Development
npm run start:dev          # Watch mode

# Build
npm run build             # Compile TypeScript

# Production
npm run start:prod        # Run compiled code

# Database
npx prisma migrate dev    # Create migration
npx prisma migrate deploy # Apply migrations
npx prisma generate       # Generate Prisma Client
npx prisma studio         # GUI for database

# Linting
npm run lint              # Run ESLint
npm run format            # Format with Prettier
```

## 🐛 Troubleshooting

### Audio files not sending
- ✅ Check ffmpeg is installed: `ffmpeg -version`
- ✅ Check `audio/webm` is in allowed MIME types
- ✅ Verify conversion logs in console

### Evolution API 400 errors
- ✅ Check `EVOLUTION_API_URL` is correct
- ✅ Verify `EVOLUTION_GLOBAL_API_KEY` is valid
- ✅ Check Evolution API logs: `docker logs evolution_api`

### Database connection failed
- ✅ Verify PostgreSQL is running
- ✅ Check `DATABASE_URL` format
- ✅ Run migrations: `npx prisma migrate deploy`

### WebSocket not connecting
- ✅ Check CORS settings (`CORS_ORIGIN`)
- ✅ Verify frontend URL matches
- ✅ Check firewall/network rules

## 📚 Related Documentation

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Evolution API Documentation](https://doc.evolution-api.com)
- [Docker Setup Guide](./DOCKER.md)

## 📌 Project Status

This project doesn't receive active development from me anymore, but it's available as a reference and starting point for anyone who wants to continue it. If you use it and want to keep improving it, or just want to tell me what you thought, feel free to open an issue or a PR — forks welcome.

## 📄 License

[MIT License](LICENSE)

## 🤝 Contributing

Contributions welcome! Please open an issue first to discuss changes. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

---

**Sources:**
- [Node.js 24 LTS](https://nodejs.org/en/about/previous-releases)
- Built with ❤️ using NestJS
