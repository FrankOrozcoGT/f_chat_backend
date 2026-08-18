import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendWithFileDto } from './dto/send-with-file.dto';

@Controller('api/messages')
export class MessagesController {
  private readonly logger = new Logger(MessagesController.name);

  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Query('conversationId') conversationId: string, @Req() req) {
    return this.messagesService.findAll(conversationId, req.user.tenantId);
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  async send(@Body() dto: CreateMessageDto, @Req() req) {
    return this.messagesService.send(dto, req.user.tenantId);
  }

  @Post('send-with-file')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 16 * 1024 * 1024, // 16MB max
      },
      fileFilter: (req, file, cb) => {
        const logger = new Logger('FileFilter');
        logger.log(`[FILE UPLOAD] mimetype: ${file.mimetype}, originalname: ${file.originalname}`);

        const allowedMimes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/mpeg',
          'audio/mpeg',
          'audio/ogg',
          'audio/wav',
          'audio/webm',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];

        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          logger.error(`[FILE REJECTED] mimetype: ${file.mimetype} not in allowed list`);
          cb(new BadRequestException('File type not allowed'), false);
        }
      },
    }),
  )
  async sendWithFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendWithFileDto,
    @Req() req,
  ) {
    return this.messagesService.sendWithFile(file, dto, req.user.tenantId);
  }
}
