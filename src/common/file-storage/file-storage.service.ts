import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvolutionService } from '@common/evolution/evolution.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Guarda un archivo subido por el usuario
   * @param file - Archivo de multer
   * @param userId - ID del usuario
   * @param conversationId - ID de la conversación
   * @returns Path relativo, nombre, tamaño y tipo
   */
  async saveUploadedFile(
    file: Express.Multer.File,
    userId: string,
    conversationId: string,
  ): Promise<{
    relativePath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> {
    try {
      // 1. Construir directorio de almacenamiento
      const storageDir = path.join(
        process.cwd(),
        'storage',
        'conversations',
        userId,
        conversationId,
      );

      // 2. Crear directorio si no existe
      await fs.mkdir(storageDir, { recursive: true });

      // 3. Generar nombre único: timestamp_originalname
      const timestamp = Date.now();
      const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');

      // Obtener extensión correcta del archivo
      const extension = this.getFileExtension(sanitizedFilename, file.mimetype);

      // Si el filename no tiene extensión o tiene extensión incorrecta, agregarla
      const hasValidExtension = sanitizedFilename.match(/\.[^.]+$/);
      const baseFilename = hasValidExtension
        ? sanitizedFilename
        : `${sanitizedFilename}${extension}`;

      let fileName = `${timestamp}_${baseFilename}`;
      let filePath = path.join(storageDir, fileName);

      // 4. Guardar archivo
      await fs.writeFile(filePath, file.buffer);

      // 5. Si es audio webm, convertir a ogg
      let finalMimeType = file.mimetype;
      let finalFileName = file.originalname;
      let finalFileSize = file.size;

      if (file.mimetype === 'audio/webm') {
        this.logger.log(`Detected audio/webm, converting to audio/ogg`);

        // Convertir a ogg
        const oggPath = await this.convertWebmToOgg(filePath);

        // Eliminar archivo webm original
        await fs.unlink(filePath);

        // Actualizar paths y metadata
        filePath = oggPath;
        fileName = path.basename(oggPath);
        finalMimeType = 'audio/ogg; codecs=opus';
        // Si originalname no tiene extensión .webm, agregar .ogg
        finalFileName = file.originalname.endsWith('.webm')
          ? file.originalname.replace(/\.webm$/, '.ogg')
          : `${file.originalname}.ogg`;

        // Obtener tamaño del archivo convertido
        const stats = await fs.stat(filePath);
        finalFileSize = stats.size;

        this.logger.log(`Conversion complete: ${fileName} (${finalFileSize} bytes)`);
      }

      // 6. Path relativo (sin dominio)
      const relativePath = `/storage/conversations/${userId}/${conversationId}/${fileName}`;

      this.logger.log(
        `File uploaded and saved: ${relativePath} (${finalFileSize} bytes)`,
      );

      return {
        relativePath,
        fileName: finalFileName,
        fileSize: finalFileSize,
        mimeType: finalMimeType,
      };
    } catch (error) {
      this.logger.error(
        `Failed to save uploaded file for conversation: ${conversationId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Descarga media desde Evolution API y guarda localmente
   * @param evolutionService - Servicio de Evolution API
   * @param instanceName - Nombre de la instancia
   * @param userId - ID del usuario
   * @param conversationId - ID de la conversación
   * @param messageId - ID del mensaje (para nombrar archivo)
   * @param messageKey - Key del mensaje de WhatsApp
   * @returns Path relativo, nombre, tamaño y tipo
   */
  async downloadAndSaveMediaFromEvolution(
    evolutionService: EvolutionService,
    instanceName: string,
    userId: string,
    conversationId: string,
    messageId: string,
    messageKey: { id: string; remoteJid: string; fromMe: boolean },
  ): Promise<{
    relativePath: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }> {
    try {
      // 1. Obtener media en base64 desde Evolution API
      const mediaData = await evolutionService.getBase64FromMediaMessage(
        instanceName,
        messageKey,
      );

      // 2. Convertir base64 a buffer
      const buffer = Buffer.from(mediaData.base64, 'base64');

      // 3. Extraer extensión del archivo
      const fileExtension = this.getFileExtension(
        mediaData.fileName,
        mediaData.mimetype,
      );

      // 4. Construir directorio de almacenamiento
      const storageDir = path.join(
        process.cwd(),
        'storage',
        'conversations',
        userId,
        conversationId,
      );

      // 5. Crear directorio si no existe
      await fs.mkdir(storageDir, { recursive: true });

      // 6. Nombre del archivo: messageId_timestamp.ext
      const fileName = `${messageId}_${Date.now()}${fileExtension}`;
      const filePath = path.join(storageDir, fileName);

      // 7. Guardar archivo
      await fs.writeFile(filePath, buffer);

      // 8. Path relativo (sin dominio)
      const relativePath = `/storage/conversations/${userId}/${conversationId}/${fileName}`;

      this.logger.log(
        `Media downloaded and saved: ${relativePath} (${buffer.length} bytes)`,
      );

      return {
        relativePath,
        fileName: mediaData.fileName,
        fileSize: mediaData.size,
        mimeType: mediaData.mimetype,
      };
    } catch (error) {
      this.logger.error(
        `Failed to download and save media for message: ${messageId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Construye URL completa desde path relativo
   * @param relativePath - Path relativo (ej: /storage/conversations/...)
   * @returns URL completa (ej: http://localhost:3001/storage/...)
   */
  buildFullUrl(relativePath: string): string {
    const backendUrl = this.configService.get<string>('BACKEND_URL');
    return `${backendUrl}${relativePath}`;
  }

  /**
   * Construye URL accesible desde Docker (Evolution API)
   * Usa BACKEND_URL_FOR_DOCKER si existe, sino usa BACKEND_URL
   * @param relativePath - Path relativo (ej: /storage/conversations/...)
   * @returns URL completa accesible desde containers
   */
  buildDockerAccessibleUrl(relativePath: string): string {
    const dockerUrl = this.configService.get<string>('BACKEND_URL_FOR_DOCKER');
    const backendUrl = this.configService.get<string>('BACKEND_URL');
    const baseUrl = dockerUrl || backendUrl;
    const fullUrl = `${baseUrl}${relativePath}`;

    this.logger.log(`Building Docker URL - BACKEND_URL_FOR_DOCKER: ${dockerUrl}, BACKEND_URL: ${backendUrl}, Final URL: ${fullUrl}`);

    return fullUrl;
  }

  /**
   * Convierte audio webm a ogg usando ffmpeg
   * @param inputPath - Path del archivo webm
   * @returns Path del archivo ogg convertido
   */
  async convertWebmToOgg(inputPath: string): Promise<string> {
    try {
      const outputPath = inputPath.replace(/\.webm$/, '.ogg');

      this.logger.log(`Converting webm to ogg: ${inputPath} -> ${outputPath}`);

      // ffmpeg -i input.webm -c:a libopus output.ogg
      const command = `ffmpeg -i "${inputPath}" -c:a libopus -y "${outputPath}"`;

      await execPromise(command);

      this.logger.log(`Conversion successful: ${outputPath}`);

      return outputPath;
    } catch (error) {
      this.logger.error(`Failed to convert webm to ogg: ${inputPath}`, error.message);
      throw error;
    }
  }

  /**
   * Extrae la extensión del archivo desde nombre o mimeType
   * @param fileName - Nombre del archivo
   * @param mimeType - Tipo MIME
   * @returns Extensión con punto (ej: .jpg)
   */
  private getFileExtension(fileName: string, mimeType: string): string {
    // Intentar desde fileName
    const match = fileName.match(/\.[^.]+$/);
    if (match) return match[0];

    // Fallback: desde mimeType
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/mpeg': '.mpeg',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        '.docx',
    };

    return mimeToExt[mimeType] || '.bin';
  }
}
