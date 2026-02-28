import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('INTERNAL_API_KEY', '');
    if (!this.apiKey) {
      throw new Error('INTERNAL_API_KEY is not configured');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const token = request.headers['x-internal-key'];
    if (!token || token !== this.apiKey) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    const ip = request.ip || request.connection?.remoteAddress;
    const allowedIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowedIps.includes(ip)) {
      throw new UnauthorizedException(`Internal endpoints only accept localhost requests (got ${ip})`);
    }

    return true;
  }
}
