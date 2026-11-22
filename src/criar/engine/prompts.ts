// Prompts, schemas and model settings of the photo -> parts harness, read straight from ai/foto-para-pecas/harness/
// (Vite ?raw), so every fix made there ships with the app without a copy getting out of date.
import SISTEMA from '../../../ai/foto-para-pecas/harness/prompts/sistema.md?raw';
import P1 from '../../../ai/foto-para-pecas/harness/prompts/1-compreender.md?raw';
import P2 from '../../../ai/foto-para-pecas/harness/prompts/2-vistas.md?raw';
import P3 from '../../../ai/foto-para-pecas/harness/prompts/3-especificar.md?raw';
import P4 from '../../../ai/foto-para-pecas/harness/prompts/4-cena.md?raw';
import P5 from '../../../ai/foto-para-pecas/harness/prompts/5-conferir.md?raw';
import BIBLIOTECA from '../../../ai/foto-para-pecas/harness/prompts/biblioteca-ids.txt?raw';
import E_ANALISE from '../../../ai/foto-para-pecas/harness/esquemas/analise.schema.json?raw';
import E_VISTAS from '../../../ai/foto-para-pecas/harness/esquemas/vistas.schema.json?raw';
import E_MONTAGEM from '../../../ai/foto-para-pecas/harness/esquemas/kz-montagem-1.schema.json?raw';
import E_CENA from '../../../ai/foto-para-pecas/harness/esquemas/cena.schema.json?raw';
import E_DIFERENCAS from '../../../ai/foto-para-pecas/harness/esquemas/diferencas.schema.json?raw';
import MODELOS_RAW from '../../../ai/foto-para-pecas/harness/modelos.json?raw';

export const PROMPTS = { sistema: SISTEMA, compreender: P1, vistas: P2, especificar: P3, cena: P4.replace('{BIBLIOTECA}', BIBLIOTECA), conferir: P5 };
export const ESQUEMAS = { analise: E_ANALISE, vistas: E_VISTAS, montagem: E_MONTAGEM, cena: E_CENA, diferencas: E_DIFERENCAS };

interface Modelos {
  voltas_maximas?: number;
  nota_minima_peca?: number;
  candidatos_web?: number;
  max_tokens?: Record<string, number>;
}
export const MODELOS: Modelos = JSON.parse(MODELOS_RAW);
export const VOLTAS = MODELOS.voltas_maximas ?? 3;
export const NOTA_MINIMA = MODELOS.nota_minima_peca ?? 7;
export const MAX_WEB = MODELOS.candidatos_web ?? 4;
/** max_tokens of a stage (modelos.json): the scene is the largest answer and was cut off at 32000 on the piggy bank */
export const maxTokens = (etapa: string) => MODELOS.max_tokens?.[etapa] ?? MODELOS.max_tokens?.padrao ?? 32000;
