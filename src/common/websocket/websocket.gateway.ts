import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookie from 'cookie';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
})
@Injectable()
export class AppWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppWebSocketGateway.name);
  private connections: Map<string, string> = new Map(); // socketId -> userId

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`[WebSocket] Connection attempt from ${client.id}`);

    try {
      // Extraer JWT de cookie
      const cookieHeader = client.handshake.headers.cookie;
      this.logger.debug(`[WebSocket] Cookie header: ${cookieHeader ? 'present' : 'missing'}`);

      if (!cookieHeader) {
        this.logger.warn(`[WebSocket] Connection rejected: No cookie header`);
        client.disconnect();
        return;
      }

      const cookies = cookie.parse(cookieHeader);
      const token = cookies.auth_token;
      this.logger.debug(`[WebSocket] JWT token: ${token ? 'present' : 'missing'}`);

      if (!token) {
        this.logger.warn(`[WebSocket] Connection rejected: No JWT token in cookie`);
        client.disconnect();
        return;
      }

      // Validar JWT
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (!payload || !payload.userId) {
        this.logger.warn(`[WebSocket] Connection rejected: Invalid JWT payload`);
        client.disconnect();
        return;
      }

      // Guardar userId en socket y en Map
      const userId = payload.userId;
      client.data.userId = userId;
      this.connections.set(client.id, userId);

      this.logger.log(`[WebSocket] Client connected: ${client.id} (userId: ${userId})`);
    } catch (error) {
      this.logger.error(`[WebSocket] Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.connections.get(client.id);
    this.connections.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (userId: ${userId})`);
  }

  /**
   * Emite un evento a todos los clientes conectados o a un usuario específico
   * @param event - Nombre del evento
   * @param data - Datos a enviar
   * @param targetUserId - ID del usuario objetivo (opcional, si no se provee es broadcast)
   */
  emitApiDown(apiName: string, error: string, userId?: string) {
    this.emit('api:down', { apiName, error, timestamp: new Date().toISOString() }, userId);
  }

  emit(event: string, data: any, targetUserId?: string) {
    if (targetUserId) {
      // Emitir solo a los sockets del usuario específico
      const targetSockets = Array.from(this.connections.entries())
        .filter(([_, userId]) => userId === targetUserId)
        .map(([socketId]) => socketId);

      targetSockets.forEach((socketId) => {
        this.server.to(socketId).emit(event, data);
      });

      this.logger.debug(`Event ${event} emitted to user ${targetUserId} (${targetSockets.length} sockets)`);
    } else {
      // Broadcast a todos
      this.server.emit(event, data);
      this.logger.debug(`Event ${event} broadcasted to all clients`);
    }
  }
}
