import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Risk rules configuration schema (Zod, validated at runtime).
 */
export const RiskRulesConfigSchema = z.object({
  maxLeverage: z.number().min(1).max(125),
  maxOrderSizeUSDT: z.number().min(1),
  maxPriceDeviationPct: z.number().min(0.1).max(50),
  allowedSymbols: z.array(z.string().regex(/^[A-Z]{2,10}USDT$/)).min(1),
  symbolSpecificDeviations: z.record(z.string(), z.number().min(0.1).max(50)).optional(),
});

export type RiskRulesConfig = z.infer<typeof RiskRulesConfigSchema>;

/**
 * Load and validate risk rules configuration from a JSON file.
 *
 * @param configPath Absolute or relative path to risk-rules.json
 * @returns Validated configuration object
 * @throws If file cannot be read or validation fails
 */
export async function loadRiskRulesConfig(configPath: string): Promise<RiskRulesConfig> {
  const absolutePath = resolve(configPath);
  const fileContent = await readFile(absolutePath, 'utf-8');
  const json = JSON.parse(fileContent);

  // Validate against schema
  const result = RiskRulesConfigSchema.safeParse(json);

  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid risk rules configuration in ${configPath}: ${errors}`);
  }

  return result.data;
}

/**
 * Default config path (relative to project root).
 */
export const DEFAULT_CONFIG_PATH = './config/risk-rules.json';
