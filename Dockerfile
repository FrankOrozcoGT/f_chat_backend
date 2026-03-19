# ========================================
# Stage 1: Builder
# ========================================
FROM node:24-alpine AS builder

# Instalar dependencias del sistema necesarias para build y ffmpeg
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    openssl

RUN npm install -g npm@11.12.0

WORKDIR /app

# Copiar package files
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci

# Generar Prisma Client
RUN npx prisma generate

# Copiar código fuente
COPY . .

# Build de NestJS
RUN npm run build

# ========================================
# Stage 2: Production Runtime
# ========================================
FROM node:24-alpine AS production

# Instalar ffmpeg y dependencias runtime
RUN apk add --no-cache \
    ffmpeg \
    openssl \
    dumb-init

RUN npm install -g npm@11.12.0

WORKDIR /app

# Copiar package files, prisma config y .env
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY .env ./

# Instalar solo dependencias de producción
RUN npm ci --only=production

# Generar Prisma Client
RUN npx prisma generate

# Copiar build desde stage anterior
COPY --from=builder /app/dist ./dist

# Crear directorio para storage
RUN mkdir -p /app/storage/conversations && \
    chown -R node:node /app/storage

# Usar usuario no-root
USER node

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Usar dumb-init para manejar señales correctamente
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Comando de inicio
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
