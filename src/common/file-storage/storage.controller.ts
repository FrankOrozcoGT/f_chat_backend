import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';

@Controller('storage/conversations')
export class StorageController {
  @Get(':tenantId/:conversationId/:fileName')
  getConversationFile(
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    if (
      [tenantId, conversationId, fileName].some(
        (segment) =>
          segment.includes('..') ||
          segment.includes('/') ||
          segment.includes('\\'),
      )
    ) {
      throw new NotFoundException('File not found');
    }

    const filePath = join(
      process.cwd(),
      'storage',
      'conversations',
      tenantId,
      conversationId,
      fileName,
    );

    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ message: 'File not found' });
      }
    });
  }
}
