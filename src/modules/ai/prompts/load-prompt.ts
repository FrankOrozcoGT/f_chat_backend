import { readFileSync } from 'fs';
import { join } from 'path';

export function loadPrompt(fileName: string): string {
  return readFileSync(join(__dirname, fileName), 'utf-8');
}
