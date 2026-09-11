import fs from 'fs';
import path from 'path';
import { parseProperties } from './propertiesParser';

const BACKEND_ROOT = path.join(__dirname, '..', '..');

export interface ConfigLoadResult {
  properties: Record<string, string>;
  sources: string[];
}

interface ConfigServerResponse {
  propertySources?: Array<{ name?: string; source?: Record<string, string> }>;
}

export function resolveConfigFilePaths(): string[] {
  const paths: string[] = [];
  const explicit = process.env.APP_CONFIG_FILE?.trim();

  if (explicit) {
    paths.push(path.resolve(explicit));
    return paths;
  }

  paths.push(path.join(BACKEND_ROOT, 'config', 'application.properties'));

  const localPath = path.join(BACKEND_ROOT, 'config', 'application-local.properties');
  if (fs.existsSync(localPath)) {
    paths.push(localPath);
  }

  return paths;
}

export function loadPropertiesFromFiles(filePaths: string[]): ConfigLoadResult {
  const properties: Record<string, string> = {};
  const sources: string[] = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    Object.assign(properties, parseProperties(content));
    sources.push(filePath);
  }

  return { properties, sources };
}

export async function loadConfigServerProperties(
  baseProperties: Record<string, string>
): Promise<ConfigLoadResult> {
  const uri =
    process.env.SPRING_CLOUD_CONFIG_URI?.trim() ||
    process.env.CONFIG_SERVER_URI?.trim() ||
    baseProperties['spring.cloud.config.uri']?.trim();

  if (!uri) {
    return { properties: {}, sources: [] };
  }

  const application =
    process.env.SPRING_APPLICATION_NAME?.trim() ||
    baseProperties['spring.application.name']?.trim() ||
    'java-upgrade-agent';

  const profile =
    process.env.SPRING_PROFILES_ACTIVE?.trim() ||
    baseProperties['spring.profiles.active']?.trim() ||
    'default';

  const baseUrl = uri.replace(/\/$/, '');
  const url = `${baseUrl}/${encodeURIComponent(application)}/${encodeURIComponent(profile)}`;

  const headers: Record<string, string> = { Accept: 'application/json' };

  const username =
    process.env.SPRING_CLOUD_CONFIG_USERNAME?.trim() ||
    baseProperties['spring.cloud.config.username']?.trim();
  const password =
    process.env.SPRING_CLOUD_CONFIG_PASSWORD?.trim() ||
    baseProperties['spring.cloud.config.password']?.trim();

  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Config server yanıt vermedi (${response.status}): ${url}`
    );
  }

  const data = (await response.json()) as ConfigServerResponse;
  const merged: Record<string, string> = {};
  const sources: string[] = [];

  const propertySources = data.propertySources ?? [];
  for (let i = propertySources.length - 1; i >= 0; i--) {
    const source = propertySources[i]?.source ?? {};
    Object.assign(merged, source);
    if (propertySources[i]?.name) {
      sources.push(propertySources[i].name!);
    }
  }

  return { properties: merged, sources };
}

function applyPlatformOverrides(properties: Record<string, string>): void {
  const port = process.env.PORT?.trim();
  if (port) {
    properties['server.port'] = port;
  }

  const corsOrigin = process.env.SERVER_CORS_ORIGIN?.trim();
  if (corsOrigin) {
    properties['server.cors.origin'] = corsOrigin;
  }
}

export async function loadAllProperties(): Promise<ConfigLoadResult> {
  const fileResult = loadPropertiesFromFiles(resolveConfigFilePaths());
  let properties = { ...fileResult.properties };
  const sources = [...fileResult.sources];

  try {
    const remoteResult = await loadConfigServerProperties(properties);
    properties = { ...properties, ...remoteResult.properties };
    sources.push(...remoteResult.sources.map((name) => `config-server:${name}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[config] Config server yüklenemedi, yerel ayarlar kullanılıyor: ${message}`);
  }

  applyPlatformOverrides(properties);

  return { properties, sources };
}

export function resolveBackendPath(relativePath: string): string {
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.join(BACKEND_ROOT, relativePath);
}

export function readPromptTemplate(
  properties: Record<string, string>,
  inlineKey: string,
  fileKey: string
): string {
  const inline = properties[inlineKey]?.trim();
  if (inline) {
    return inline;
  }

  const filePath = properties[fileKey]?.trim();
  if (filePath) {
    const resolved = resolveBackendPath(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Prompt dosyası bulunamadı: ${resolved}`);
    }
    return fs.readFileSync(resolved, 'utf-8');
  }

  throw new Error(
    `Zorunlu yapılandırma eksik: ${inlineKey} (application.properties veya Config Server)`
  );
}
