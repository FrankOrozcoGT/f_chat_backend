import { Module } from '@nestjs/common';
import { MermaidParser } from './mermaid-parser.service';
import { GraphAnalyzer } from './graph-analyzer.service';

@Module({
  providers: [MermaidParser, GraphAnalyzer],
  exports: [MermaidParser, GraphAnalyzer],
})
export class MermaidParserModule {}
