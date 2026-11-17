import { Injectable, Logger } from '@nestjs/common';
import { LlmClient } from '@common/external-integrations/llm.client';
import { LimitsService } from '@common/services/limits.service';
import { NodeFunction } from '../node-function.decorator';
import { NodeContext } from '../node-function.context';
import { getStringArg } from '../args-validator';
import {
  IMAGE_ANALYSIS_KINDS,
  IMAGE_ANALYSIS_PROMPTS,
  isImageAnalysisKind,
} from './image-analysis-prompts';

@Injectable()
export class AnalyzeImageFn {
  private readonly logger = new Logger(AnalyzeImageFn.name);

  constructor(
    private readonly llmClient: LlmClient,
    private readonly limitsService: LimitsService,
  ) {}

  @NodeFunction({
    code: 'analyzeImage',
    name: 'Analizar imagen recibida',
    description:
      'Analiza la imagen del mensaje actual del cliente y devuelve datos estructurados (DPI o comprobante de transferencia).',
    toolDefinition: {
      type: 'function',
      function: {
        name: 'analyzeImage',
        description:
          'Analiza la imagen que el cliente acaba de enviar y devuelve datos estructurados. Úsala SIEMPRE antes de opinar sobre un DPI o un comprobante: no puedes juzgar la imagen sin llamarla. Analiza solo la imagen del mensaje actual.',
        parameters: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: [...IMAGE_ANALYSIS_KINDS],
              description:
                'Qué tipo de documento debería ser la imagen: dpi (frente o reverso del DPI) o comprobante (transferencia bancaria).',
            },
          },
          required: ['kind'],
        },
      },
    },
  })
  async execute(ctx: NodeContext): Promise<string> {
    const kind = getStringArg('analyzeImage', ctx.args, 'kind', {
      required: true,
    });
    if (!isImageAnalysisKind(kind)) {
      throw new Error(
        `analyzeImage: "kind" debe ser uno de ${IMAGE_ANALYSIS_KINDS.join(', ')} — recibido: ${JSON.stringify(kind)}`,
      );
    }

    if (!ctx.imageUrl) {
      return 'El mensaje actual no trae ninguna imagen.';
    }

    const result = await this.llmClient.rawChat(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_ANALYSIS_PROMPTS[kind] },
            { type: 'image_url', image_url: { url: ctx.imageUrl } },
          ],
        },
      ],
      300,
    );

    await this.limitsService.chargeLlmUsage(
      ctx.tenantId,
      result.tokensInput,
      result.tokensOutput,
    );

    if (ctx.isTest) {
      ctx.sideEffects.push({
        action: 'analyzeImage',
        args: { kind, result: result.response },
      });
    }

    this.logger.log(
      `analyzeImage kind=${kind}: ${result.response.substring(0, 160)}`,
    );
    return result.response;
  }
}
