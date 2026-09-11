import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAppConfig } from '../config/appConfig';
import { runCommand } from './commandRunner';
import { resolveCopilotSpawn } from './processEnv';

export interface CopilotModelOptions {
  models: string[];
  selectedModel: string;
  cliPersistedModel: string | null;
}

const FALLBACK_MODELS = [
  'auto',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-fable-5',
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.6-fast',
  'claude-opus-4.5',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.4-mini',
  'gpt-5-mini',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
];

export function parseModelsFromConfigHelp(helpText: string): string[] {
  const modelSection = helpText.match(/`model`:[\s\S]*?(?=\n\n\s+`[a-zA-Z])/);
  if (!modelSection?.[0]) return [];

  const models: string[] = [];
  const re = /-\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(modelSection[0])) !== null) {
    models.push(match[1]);
  }
  return [...new Set(models)];
}

export function readCopilotCliPersistedModel(): string | null {
  const configPath = path.join(os.homedir(), '.copilot', 'config.json');
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { model?: unknown };
    return typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : null;
  } catch {
    return null;
  }
}

/** CLI slug: "claude sonnet 4.6" → "claude-sonnet-4.6" */
export function normalizeCopilotModelId(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'auto';
  if (trimmed.toLowerCase() === 'auto') return 'auto';
  return trimmed.toLowerCase().replace(/\s+/g, '-');
}

export function resolveCopilotModel(override?: string): string {
  const raw = override?.trim() || getAppConfig().copilotModel?.trim() || 'auto';
  return normalizeCopilotModelId(raw);
}

export function isCopilotModelUnavailableMessage(text: string): boolean {
  return /model\s+.+\s+from\s+--model\s+flag\s+is\s+not\s+avai?lable/i.test(text);
}

export async function listCopilotModelOptions(): Promise<CopilotModelOptions> {
  let models = [...FALLBACK_MODELS];

  try {
    const { executable, prefixArgs } = resolveCopilotSpawn();
    const result = await runCommand(executable, [...prefixArgs, 'help', 'config']);
    const helpText = `${result.stdout}${result.stderr}`;
    const parsed = parseModelsFromConfigHelp(helpText);
    if (parsed.length > 0) {
      models = ['auto', ...parsed.filter((m) => m !== 'auto')];
    }
  } catch {
    // fallback list
  }

  const selectedModel = resolveCopilotModel();
  const uniqueModels = [...new Set(models)];
  if (!uniqueModels.includes(selectedModel)) {
    uniqueModels.unshift(selectedModel);
  }

  return {
    models: uniqueModels,
    selectedModel,
    cliPersistedModel: readCopilotCliPersistedModel(),
  };
}
