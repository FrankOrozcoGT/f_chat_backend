import { readFileSync } from 'fs';
import { join } from 'path';

export function loadPrompt(dir: string, fileName: string): string {
  return readFileSync(join(dir, fileName), 'utf-8');
}
