export function parseProperties(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let key = '';
  let value = '';

  const commit = () => {
    if (key) {
      result[key.trim()] = unescapePropertyValue(value);
      key = '';
      value = '';
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!key) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }
    }

    if (key) {
      if (line.endsWith('\\')) {
        value += `${line.slice(0, -1)}\n`;
      } else {
        value += line;
        commit();
      }
      continue;
    }

    const separator = findSeparator(line);
    if (separator < 0) {
      continue;
    }

    key = line.slice(0, separator).trim();
    const rest = line.slice(separator + 1).trimStart();

    if (rest.endsWith('\\')) {
      value = `${rest.slice(0, -1)}\n`;
    } else {
      value = rest;
      commit();
    }
  }

  if (key) {
    commit();
  }

  return result;
}

function findSeparator(line: string): number {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '=' || ch === ':') {
      const prev = line[i - 1];
      if (prev === '\\') {
        continue;
      }
      return i;
    }
  }
  return -1;
}

function unescapePropertyValue(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}
