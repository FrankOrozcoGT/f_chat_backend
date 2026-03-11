import { Node } from '@prisma/client';
import { loadPrompt } from '@common/utils/load-prompt';
import * as path from 'path';

const PROMPTS_DIR = path.join(__dirname, '../ai/prompts');

export const ROUTER_SYSTEM_PROMPT = loadPrompt(PROMPTS_DIR, 'router-system.md');
export const ROUTER_PRE_CODE = ['loadIntents'];
export const ROUTER_POST_CODE = ['responder', 'findFlowForIntent', 'closeSession', 'switchToHitl', 'moveToLastConversation'];
export const ROUTER_TOOLS: string[] = [];

export function buildVirtualRouterNode(): Node {
  return {
    id: 'virtual-router',
    name: 'Router (hardcoded)',
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    tools: JSON.stringify(ROUTER_TOOLS),
    preCode: JSON.stringify(ROUTER_PRE_CODE),
    postCode: JSON.stringify(ROUTER_POST_CODE),
    preCodeInputSchema: null,
    postCodeInputSchema: null,
    onError: 'hitl',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Node;
}
