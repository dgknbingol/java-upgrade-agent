import fs from 'fs';
import path from 'path';

export interface JavaVersionDetection {
  currentJavaVersion: string;
  displayVersion: string;
  detectedFrom: string;
  buildTool: 'Maven' | 'Unknown';
}

function extractTagValue(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
  const match = xml.match(re);
  return match ? match[1].trim() : null;
}

function extractPropertyValue(xml: string, property: string): string | null {
  const inProperties = xml.match(/<properties>([\s\S]*?)<\/properties>/i);
  if (!inProperties) {
    return null;
  }
  return extractTagValue(inProperties[1], property);
}

function extractCompilerPluginValue(xml: string, tag: string): string | null {
  const pluginBlocks = xml.match(
    /<plugin>[\s\S]*?<artifactId>maven-compiler-plugin<\/artifactId>[\s\S]*?<\/plugin>/gi
  );
  if (!pluginBlocks) {
    return null;
  }

  for (const block of pluginBlocks) {
    const config = block.match(/<configuration>([\s\S]*?)<\/configuration>/i);
    if (!config) {
      continue;
    }
    const value = extractTagValue(config[1], tag);
    if (value) {
      return value;
    }
  }

  return null;
}

function extractFromDockerfile(workspacePath: string): { version: string; source: string } | null {
  const dockerfilePath = path.join(workspacePath, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    return null;
  }

  const content = fs.readFileSync(dockerfilePath, 'utf-8');
  const temurin = content.match(/eclipse-temurin:(\d+(?:\.\d+)?)/i);
  if (temurin) {
    return { version: temurin[1], source: 'Dockerfile (eclipse-temurin)' };
  }

  const openjdk = content.match(/openjdk:(\d+(?:\.\d+)?)/i);
  if (openjdk) {
    return { version: openjdk[1], source: 'Dockerfile (openjdk)' };
  }

  return null;
}

function extractFromWorkflows(workspacePath: string): { version: string; source: string } | null {
  const workflowsDir = path.join(workspacePath, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    return null;
  }

  for (const file of fs.readdirSync(workflowsDir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) {
      continue;
    }
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf-8');
    const setupJava = content.match(/java-version:\s*['"]?([^'"\n]+)['"]?/i);
    if (setupJava) {
      return {
        version: setupJava[1].trim(),
        source: `.github/workflows/${file}`,
      };
    }
  }

  return null;
}

export function formatJavaDisplay(version: string): string {
  const trimmed = version.trim();
  if (trimmed.startsWith('1.')) {
    return `Java ${trimmed}`;
  }
  return `Java ${trimmed}`;
}

function normalizeVersion(version: string): string {
  return version.trim();
}

function detectFromPom(xml: string): { version: string; source: string } | null {
  const checks: Array<{ value: string | null; source: string }> = [
    {
      value: extractPropertyValue(xml, 'maven.compiler.release'),
      source: 'pom.xml (maven.compiler.release)',
    },
    {
      value: extractPropertyValue(xml, 'java.version'),
      source: 'pom.xml (java.version)',
    },
    {
      value: extractPropertyValue(xml, 'maven.compiler.source'),
      source: 'pom.xml (maven.compiler.source)',
    },
    {
      value: extractPropertyValue(xml, 'maven.compiler.target'),
      source: 'pom.xml (maven.compiler.target)',
    },
    {
      value: extractCompilerPluginValue(xml, 'release'),
      source: 'pom.xml (maven-compiler-plugin release)',
    },
    {
      value: extractCompilerPluginValue(xml, 'source'),
      source: 'pom.xml (maven-compiler-plugin source)',
    },
    {
      value: extractCompilerPluginValue(xml, 'target'),
      source: 'pom.xml (maven-compiler-plugin target)',
    },
  ];

  for (const check of checks) {
    if (check.value) {
      return { version: normalizeVersion(check.value), source: check.source };
    }
  }

  return null;
}

export function detectJavaVersion(workspacePath: string): JavaVersionDetection {
  const pomPath = path.join(workspacePath, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const pomXml = fs.readFileSync(pomPath, 'utf-8');
    const fromPom = detectFromPom(pomXml);
    if (fromPom) {
      return {
        currentJavaVersion: fromPom.version,
        displayVersion: formatJavaDisplay(fromPom.version),
        detectedFrom: fromPom.source,
        buildTool: 'Maven',
      };
    }
  }

  const fromDocker = extractFromDockerfile(workspacePath);
  if (fromDocker) {
    return {
      currentJavaVersion: fromDocker.version,
      displayVersion: formatJavaDisplay(fromDocker.version),
      detectedFrom: fromDocker.source,
      buildTool: 'Maven',
    };
  }

  const fromWorkflow = extractFromWorkflows(workspacePath);
  if (fromWorkflow) {
    return {
      currentJavaVersion: fromWorkflow.version,
      displayVersion: formatJavaDisplay(fromWorkflow.version),
      detectedFrom: fromWorkflow.source,
      buildTool: 'Maven',
    };
  }

  throw new Error(
    'Java sürümü tespit edilemedi. pom.xml, Dockerfile veya CI dosyalarında sürüm bilgisi bulunamadı.'
  );
}
