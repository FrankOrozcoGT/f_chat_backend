import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

const MAX_SIZE_BYTES = 30 * 1024; // 30KB

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  async compressForLlm(buffer: Buffer, originalMimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const originalSizeKb = Math.round(buffer.length / 1024);

    if (buffer.length <= MAX_SIZE_BYTES) {
      this.logger.log(`ImageService: ${originalSizeKb}KB ≤ 30KB, no compression needed`);
      return { buffer, mimeType: originalMimeType };
    }

    // Calculate quality directly based on size ratio
    const quality = Math.max(5, Math.round(30 * 100 / originalSizeKb));
    const compressed = await sharp(buffer).jpeg({ quality }).toBuffer();
    const compressedKb = Math.round(compressed.length / 1024);
    this.logger.log(`ImageService: ${originalSizeKb}KB → ${compressedKb}KB (quality=${quality})`);

    return { buffer: compressed, mimeType: 'image/jpeg' };
  }
}
