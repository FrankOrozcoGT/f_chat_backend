import { Annotation } from '@langchain/langgraph';

export interface AnalysisMessage {
  id: string;
  type: string;
  content: string;
  direction: string;
  senderType: string;
  transcription: string | null;
  mediaUrl: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export interface SubConversation {
  summary: string;
  firstMessageId: string;
  lastMessageId: string;
  intent: string | null;
  flowDiagram: string | null;
  flowSummary: string | null;
}

export interface AnalysisProduct {
  name: string;
  price: number;
  description?: string;
}

export interface AnalysisPromotion {
  name: string;
  description?: string;
  specialPrice: number;
  productNames: string[];
}

export interface InternalParticipant {
  senderJid: string;
  channelName: string;
  internalPurpose: string;
}

export interface AnalysisLlmOutput {
  realName: string | null;
  subConversations: SubConversation[];
  products: AnalysisProduct[];
  promotions: AnalysisPromotion[];
  isInternal: boolean;
  internalPurpose: string | null;
  channelName: string | null;
  participants: InternalParticipant[];
  intentRenames: { from: string; to: string }[];
}

export interface AnalysisWarning {
  messageId: string;
  type: string;
  message: string;
}

export const AnalysisState = Annotation.Root({
  // Input
  conversationId: Annotation<string>,
  tenantId: Annotation<string>,
  phoneId: Annotation<string>,
  clientId: Annotation<string | null>,
  isGroup: Annotation<boolean>,
  knownInternal: Annotation<boolean>,
  messages: Annotation<AnalysisMessage[]>,

  // After InputRouter (messages with transcriptions resolved)
  processedMessages: Annotation<AnalysisMessage[]>,
  warnings: Annotation<AnalysisWarning[]>,
  totalCost: Annotation<number>,

  // After AnalysisNode (LLM output)
  realName: Annotation<string | null>,
  subConversations: Annotation<SubConversation[]>,
  products: Annotation<AnalysisProduct[]>,
  promotions: Annotation<AnalysisPromotion[]>,
  existingIntents: Annotation<string[]>,
  intentRenames: Annotation<{ from: string; to: string }[]>,
  isInternal: Annotation<boolean>,
  internalPurpose: Annotation<string | null>,
  channelName: Annotation<string | null>,
  participants: Annotation<InternalParticipant[]>,
});

export type AnalysisStateType = typeof AnalysisState.State;
