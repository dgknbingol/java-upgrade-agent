import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { parseProperties } from './propertiesParser';

export interface ConfigLoadResult {
  properties: Record<string, string>;
  sources: string[];
}

export function resolveConfigFilePaths(): string[] {
  const paths: string[] = [];
  const explicit = process.env.APP_CONFIG_FILE?.trim();

  if (explicit) {
    paths.push(path.resolve(explicit));
    return paths;
  }

  if (app.isPackaged) {
    paths.push(path.join(process.resourcesPath, 'config', 'application.properties'));
    const userLocal = path.join(app.getPath('userData'), 'application-local.properties');
    if (fs.existsSync(userLocal)) {
      paths.push(userLocal);
    }
    return paths;
  }

  const agentRoot = path.join(__dirname, '..', '..');
  paths.push(path.join(agentRoot, 'config', 'application.properties'));

  const localPath = path.join(agentRoot, 'config', 'application-local.properties');
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

export function loadAllProperties(): ConfigLoadResult {
  return loadPropertiesFromFiles(resolveConfigFilePaths());
}

export function resolveUserLocalConfigPath(): string {
  return path.join(app.getPath('userData'), 'application-local.properties');
}
