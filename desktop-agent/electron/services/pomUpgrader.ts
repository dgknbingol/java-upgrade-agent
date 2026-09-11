import fs from 'fs';
import path from 'path';

function upsertProperty(xml: string, name: string, value: string): string {
  const tag = `<${name}>${value}</${name}>`;
  const propertyPattern = new RegExp(`<${name}>[^<]*</${name}>`, 'i');

  if (propertyPattern.test(xml)) {
    return xml.replace(propertyPattern, tag);
  }

  if (/<properties>/i.test(xml)) {
    return xml.replace(/<properties>/i, `<properties>\n    ${tag}`);
  }

  return xml.replace(
    /<\/parent>\s*/i,
    (match) => `${match}\n\n  <properties>\n    ${tag}\n  </properties>\n\n`
  );
}

function upsertCompilerPluginValue(xml: string, tag: string, value: string): string {
  const pluginPattern =
    /(<plugin>[\s\S]*?<artifactId>maven-compiler-plugin<\/artifactId>[\s\S]*?<configuration>)([\s\S]*?)(<\/configuration>[\s\S]*?<\/plugin>)/i;
  const match = xml.match(pluginPattern);
  if (!match) return xml;

  const configBody = match[2];
  const tagPattern = new RegExp(`<${tag}>[^<]*</${tag}>`, 'i');
  const newTag = `      <${tag}>${value}</${tag}>`;
  const updatedConfig = tagPattern.test(configBody)
    ? configBody.replace(tagPattern, newTag)
    : `${configBody}\n${newTag}\n`;

  return xml.replace(pluginPattern, `${match[1]}${updatedConfig}${match[3]}`);
}

export function applyPomJavaUpgrade(
  workspacePath: string,
  targetJavaVersion: string
): boolean {
  const pomPath = path.join(workspacePath, 'pom.xml');
  if (!fs.existsSync(pomPath)) return false;

  const original = fs.readFileSync(pomPath, 'utf-8');
  let updated = original;

  updated = upsertProperty(updated, 'java.version', targetJavaVersion);
  updated = upsertProperty(updated, 'maven.compiler.release', targetJavaVersion);
  updated = upsertProperty(updated, 'maven.compiler.source', targetJavaVersion);
  updated = upsertProperty(updated, 'maven.compiler.target', targetJavaVersion);
  updated = upsertCompilerPluginValue(updated, 'release', targetJavaVersion);
  updated = upsertCompilerPluginValue(updated, 'source', targetJavaVersion);
  updated = upsertCompilerPluginValue(updated, 'target', targetJavaVersion);

  if (updated === original) return false;

  fs.writeFileSync(pomPath, updated, 'utf-8');
  return true;
}
