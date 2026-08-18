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
export class AppWebSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppWebSocketGateway.name);
  private connections: Map<string, string> = new Map(); // socketId -> tenantId

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`[WebSocket] Connection attempt from ${client.id}`);

    try {
      // Extraer JWT de cookie
      const cookieHeader = client.handshake.headers.cookie;
      this.logger.debug(
        `[WebSocket] Cookie header: ${cookieHeader ? 'present' : 'missing'}`,
      );

      if (!cookieHeader) {
        this.logger.warn(`[WebSocket] Connection rejected: No cookie header`);
        client.disconnect();
        return;
      }

      const cookies = cookie.parse(cookieHeader);
      const token = cookies.auth_token;
      this.logger.debug(
        `[WebSocket] JWT token: ${token ? 'present' : 'missing'}`,
      );

      if (!token) {
        this.logger.warn(
          `[WebSocket] Connection rejected: No JWT token in cookie`,
        );
        client.disconnect();
        return;
      }

      // Validar JWT
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (!payload || !payload.userId || !payload.tenantId) {
        this.logger.warn(
          `[WebSocket] Connection rejected: Invalid JWT payload`,
        );
        client.disconnect();
        return;
      }

      // Guardar userId y tenantId en socket; las conexiones se indexan por tenantId
      // porque todos los eventos del sistema (webhooks de WhatsApp, IA) se emiten
      // a nivel de tenant, no de usuario individual.
      const userId = payload.userId;
      const tenantId = payload.tenantId;
      client.data.userId = userId;
      client.data.tenantId = tenantId;
      this.connections.set(client.id, tenantId);

      this.logger.log(
        `[WebSocket] Client connected: ${client.id} (userId: ${userId}, tenantId: ${tenantId})`,
      );
    } catch (error) {
      this.logger.error(`[WebSocket] Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const tenantId = this.connections.get(client.id);
    this.connections.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (tenantId: ${tenantId})`);
  }

  /**
   * Emite un evento a todos los clientes conectados o a un tenant específico
   * @param event - Nombre del evento
   * @param data - Datos a enviar
   * @param targetTenantId - ID del tenant objetivo (opcional, si no se provee es broadcast)
   */
  emitApiDown(apiName: string, error: string, tenantId?: string) {
    this.emit(
      'api:down',
      { apiName, error, timestamp: new Date().toISOString() },
      tenantId,
    );
  }

  emitApiUp(apiName: string, tenantId?: string) {
    this.emit(
      'api:up',
      { apiName, timestamp: new Date().toISOString() },
      tenantId,
    );
  }

  emitCreditsExhausted(
    tenantId: string,
    conversationId: string,
    creditsUsed: number,
    creditsLimit: number,
  ) {
    this.emit(
      'credits:exhausted',
      {
        conversationId,
        creditsUsed,
        creditsLimit,
        timestamp: new Date().toISOString(),
      },
      tenantId,
    );
  }

  emit(event: string, data: any, targetTenantId?: string) {
    if (targetTenantId) {
      // Emitir solo a los sockets del tenant específico
      const targetSockets = Array.from(this.connections.entries())
        .filter(([_, tenantId]) => tenantId === targetTenantId)
        .map(([socketId]) => socketId);

      targetSockets.forEach((socketId) => {
        this.server.to(socketId).emit(event, data);
      });

      this.logger.debug(
        `Event ${event} emitted to tenant ${targetTenantId} (${targetSockets.length} sockets)`,
      );
    } else {
      // Broadcast a todos
      this.server.emit(event, data);
      this.logger.debug(`Event ${event} broadcasted to all clients`);
    }
  }
}
