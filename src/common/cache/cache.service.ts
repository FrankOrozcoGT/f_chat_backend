import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

interface CacheEntry {
  value: any;
  expiresAt: number; // timestamp in milliseconds
}

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private cache = new Map<string, CacheEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60000; // 1 minuto

  onModuleInit() {
    // Iniciar cleanup automático cada minuto
    this.startCleanupInterval();
    this.logger.log('CacheService initialized with automatic cleanup every 60s');
  }

  onModuleDestroy() {
    // Detener cleanup al destruir módulo
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    this.logger.log('CacheService destroyed');
  }

  /**
   * Guarda un valor en cache con TTL
   * @param key - Clave única
   * @param value - Valor a guardar (any)
   * @param ttlSeconds - Tiempo de vida en segundos
   */
  set(key: string, value: any, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
    this.logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
  }

  /**
   * Obtiene un valor del cache
   * @param key - Clave a buscar
   * @returns Valor o null si no existe o expiró
   */
  get(key: string): any | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Verificar si expiró
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.logger.debug(`Cache EXPIRED: ${key}`);
      return null;
    }

    return entry.value;
  }

  /**
   * Verifica si existe una key en cache (y no ha expirado)
   * @param key - Clave a verificar
   * @returns true si existe y no expiró
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Verificar si expiró
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.logger.debug(`Cache EXPIRED: ${key}`);
      return false;
    }

    return true;
  }

  /**
   * Elimina una key del cache
   * @param key - Clave a eliminar
   * @returns true si existía y fue eliminada
   */
  delete(key: string): boolean {
    const existed = this.cache.has(key);
    if (existed) {
      this.cache.delete(key);
      this.logger.debug(`Cache DELETE: ${key}`);
    }
    return existed;
  }

  /**
   * Limpia todo el cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log(`Cache CLEARED: ${size} entries removed`);
  }

  /**
   * Inicia el intervalo de cleanup automático
   * Elimina entries expiradas cada minuto
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Limpia entries expiradas del cache
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`Cache cleanup: ${removed} expired entries removed`);
    }
  }

  /**
   * Obtiene estadísticas del cache
   * @returns { size: number, keys: string[] }
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
