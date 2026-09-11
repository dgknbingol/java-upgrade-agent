import fs from 'fs';
import path from 'path';
import { runCommand, runCommandStreaming } from './commandRunner';

export interface PomAnalysis {
  javaVersion: string;
  javaSource: string;
  mavenCompilerVersion: string;
  springBootVersion: string;
  buildTool: string;
}

export async function runMavenBuild(
  cwd: string,
  onLog?: (line: string) => void,
  options: { skipTests?: boolean } = {}
): Promise<{ success: boolean; output: string }> {
  const args = ['clean', 'install'];
  if (options.skipTests) {
    args.push('-DskipTests');
  }

  const result = await runCommand('mvn', args, {
    cwd,
    onStdout: (t) => logLines(t, onLog),
    onStderr: (t) => logLines(t, onLog, '[stderr] '),
  });

  return {
    success: result.exitCode === 0,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

/** Copilot fix sonrası java -jar için modül jar'ını yeniden üretir. */
export async function runMavenPackage(
  cwd: string,
  onLog?: (line: string) => void,
  options: { skipTests?: boolean; modulePath?: string } = {}
): Promise<{ success: boolean; output: string }> {
  const args: string[] = [];
  const modulePath = options.modulePath?.trim();
  if (modulePath && modulePath !== '.') {
    args.push('-pl', modulePath, '-am');
  }
  args.push('package');
  if (options.skipTests !== false) {
    args.push('-DskipTests');
  }

  const result = await runCommand('mvn', args, {
    cwd,
    onStdout: (t) => logLines(t, onLog),
    onStderr: (t) => logLines(t, onLog, '[stderr] '),
  });

  return {
    success: result.exitCode === 0,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

export async function getMavenVersion(onLog?: (line: string) => void): Promise<string> {
  const result = await runCommand('mvn', ['-version'], {
    onStdout: (t) => logLines(t, onLog),
    onStderr: (t) => logLines(t, onLog),
  });
  const line = `${result.stdout}${result.stderr}`.split(/\r?\n/).find((l) => /Apache Maven/i.test(l));
  return line?.trim() ?? 'unknown';
}

export function analyzePom(workspacePath: string): PomAnalysis {
  const pomPath = path.join(workspacePath, 'pom.xml');
  if (!fs.existsSync(pomPath)) {
    return {
      javaVersion: 'unknown',
      javaSource: 'pom.xml not found',
      mavenCompilerVersion: 'unknown',
      springBootVersion: 'unknown',
      buildTool: 'unknown',
    };
  }

  const xml = fs.readFileSync(pomPath, 'utf-8');

  const javaVersion =
    extractTag(xml, 'java.version') ??
    extractCompilerRelease(xml) ??
    extractCompilerTag(xml, 'release') ??
    extractCompilerTag(xml, 'source') ??
    extractCompilerTag(xml, 'target') ??
    'unknown';

  const javaSource = detectJavaSource(xml, javaVersion);
  const mavenCompilerVersion = extractPluginVersion(xml, 'maven-compiler-plugin') ?? 'unknown';
  const springBootVersion = extractParentVersion(xml, 'spring-boot-starter-parent') ?? 'unknown';

  return {
    javaVersion: normalizeJavaVersion(javaVersion),
    javaSource,
    mavenCompilerVersion,
    springBootVersion,
    buildTool: 'Maven',
  };
}

function detectJavaSource(xml: string, version: string): string {
  if (extractTag(xml, 'java.version')) return 'pom.xml (java.version)';
  if (extractCompilerRelease(xml)) return 'pom.xml (maven.compiler.release)';
  if (extractCompilerTag(xml, 'source')) return 'pom.xml (maven.compiler.source)';
  if (extractCompilerTag(xml, 'target')) return 'pom.xml (maven.compiler.target)';
  if (version !== 'unknown') return 'pom.xml';
  return 'not detected';
}

function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+)\\s*</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function extractCompilerRelease(xml: string): string | null {
  return extractTag(xml, 'maven.compiler.release');
}

function extractCompilerTag(xml: string, tag: string): string | null {
  const plugin = xml.match(
    /<plugin>[\s\S]*?<artifactId>maven-compiler-plugin<\/artifactId>[\s\S]*?<\/plugin>/i
  );
  if (!plugin) return null;
  const m = plugin[0].match(new RegExp(`<${tag}>\\s*([^<]+)\\s*</${tag}>`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function extractPluginVersion(xml: string, artifactId: string): string | null {
  const plugin = xml.match(
    new RegExp(`<plugin>[\\s\\S]*?<artifactId>${artifactId}<\\/artifactId>[\\s\\S]*?<\\/plugin>`, 'i')
  );
  if (!plugin) return null;
  const m = plugin[0].match(/<version>\s*([^<]+)\s*<\/version>/i);
  return m?.[1]?.trim() ?? null;
}

function extractParentVersion(xml: string, artifactId: string): string | null {
  const parent = xml.match(/<parent>[\s\S]*?<\/parent>/i);
  if (!parent) return null;
  if (!new RegExp(`<artifactId>${artifactId}<\\/artifactId>`, 'i').test(parent[0])) return null;
  const m = parent[0].match(/<version>\s*([^<]+)\s*<\/version>/i);
  return m?.[1]?.trim() ?? null;
}

function normalizeJavaVersion(value: string): string {
  const m = value.match(/\d{1,2}/);
  return m ? m[0] : value;
}

function logLines(text: string, onLog?: (line: string) => void, prefix = ''): void {
  if (!onLog) return;
  text.split(/\r?\n/).forEach((line) => {
    if (line.length > 0) onLog(`${prefix}${line}`);
  });
}
