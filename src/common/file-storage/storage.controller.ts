import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';

interface AuthUser {
  id: string;
  tenantId: string;
}

@Controller('storage/conversations')
@UseGuards(JwtAuthGuard)
export class StorageController {
  @Get(':tenantId/:conversationId/:fileName')
  getConversationFile(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    if (tenantId !== user.tenantId) {
      throw new ForbiddenException('You do not have access to this file');
    }

    if (
      [tenantId, conversationId, fileName].some(
        (segment) => segment.includes('..') || segment.includes('/') || segment.includes('\\'),
      )
    ) {
      throw new NotFoundException('File not found');
    }

    const filePath = join(process.cwd(), 'storage', 'conversations', tenantId, conversationId, fileName);

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ message: 'File not found' });
      }
    });
  }
}
