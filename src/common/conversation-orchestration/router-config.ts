import { loadPrompt } from '@common/utils/load-prompt';
import * as path from 'path';

const PROMPTS_DIR = path.join(__dirname, 'prompts');

export const ROUTER_SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'router-system.md');
export const ROUTER_PRE_CODE = ['loadIntents'];
export const ROUTER_POST_CODE = ['responder', 'findFlowForIntent', 'closeSession', 'switchToHitl', 'moveToLastConversation', 'reportHacking'];
