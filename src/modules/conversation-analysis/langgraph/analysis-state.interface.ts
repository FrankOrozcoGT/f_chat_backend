import { Annotation } from '@langchain/langgraph';

export interface AnalysisMessage {
  id: string;
  type: string;
  content: string;
  direction: string;
  senderType: string;
  transcription: string | null;
  mediaUrl: string | null;
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

export interface AnalysisLlmOutput {
  realName: string | null;
  subConversations: SubConversation[];
  products: AnalysisProduct[];
  promotions: AnalysisPromotion[];
  isInternal: boolean;
  internalPurpose: string | null;
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
  isInternal: Annotation<boolean>,
  internalPurpose: Annotation<string | null>,
});

export type AnalysisStateType = typeof AnalysisState.State;
