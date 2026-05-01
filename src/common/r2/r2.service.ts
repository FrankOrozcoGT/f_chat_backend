import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { R2Repository } from './r2.repository';

@Injectable()
export class R2Service {
  private readonly publicUrl: string;

  constructor(
    private readonly r2Repository: R2Repository,
    private readonly configService: ConfigService,
  ) {
    this.publicUrl = this.configService.get<string>('R2_PUBLIC_URL')!;
  }

  async uploadImage(folder: string, id: string, buffer: Buffer, mimeType: string): Promise<string> {
    const optimized = await sharp(buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const key = `${folder}/${id}.webp`;
    await this.r2Repository.upload(key, optimized, 'image/webp');
    return key;
  }

  async deleteImage(key: string): Promise<void> {
    await this.r2Repository.delete(key);
  }

  buildUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }
}
