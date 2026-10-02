import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export type SecurityScanKind = 'mend' | 'fortify';

export const FORTIFY_SCAN_TYPE = 'Static Code Analysis';
export const MEND_SCAN_TYPE = 'Source Composition Analysis';
export const DEFAULT_JIRA_PROJECT = 'ITPAYCAP';
export const DEFAULT_JIRA_BASE_URL = 'https://itjira.vodafone.local';

export interface JiraVulnerabilityFinding {
  key: string;
  summary: string;
  description: string;
  priority: string;
  status: string;
  scanType: string;
  codeRepoName: string;
  vulnerabilityPath: string;
  moreInfoUrl: string;
  epss: string;
  vulnerabilityId: string;
  issueUrl: string;
  rawFields: Record<string, unknown>;
}

export interface FetchSecurityFindingsInput {
  jiraBaseUrl: string;
  jiraToken: string;
  repoName: string;
  includeMend: boolean;
  includeFortify: boolean;
  projectKey?: string;
  maxResultsPerScan?: number;
}

export interface SecurityFindingsResult {
  repoName: string;
  mend: JiraVulnerabilityFinding[];
  fortify: JiraVulnerabilityFinding[];
  mendJql: string | null;
  fortifyJql: string | null;
  mendText: string;
  fortifyText: string;
}

interface JiraFieldMeta {
  id: string;
  name: string;
}

interface JiraSearchIssue {
  key: string;
  self?: string;
  fields?: Record<string, unknown>;
}

const FIELD_ALIASES: Record<string, string[]> = {
  codeRepoName: ['Code Repo Name', 'Project Code Repo Name', 'Repo Name'],
  scanType: ['Scan Type'],
  vulnerabilityPath: ['Vulnerability Path'],
  moreInfoUrl: ['More Info URL', 'More Info Url'],
  epss: ['EPSS'],
  vulnerabilityId: ['Vulnerability ID', 'Vulnerability Id'],
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return stripHtml(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.displayName === 'string') return obj.displayName;
    if (typeof obj.content === 'string') return stripHtml(obj.content);
  }
  return stripHtml(JSON.stringify(value));
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildSecurityJql(
  scanType: string,
  repoName: string,
  projectKey = DEFAULT_JIRA_PROJECT
): string {
  const project = escapeJqlString(projectKey);
  const scan = escapeJqlString(scanType);
  const repo = escapeJqlString(repoName);
  return (
    `type = Vulnerability and project = ${project} AND ` +
    `"Scan Type" = "${scan}" and status != DONE AND ` +
    `"Code Repo Name" ~ "${repo}"`
  );
}

function formatNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code =
      typeof (cause as NodeJS.ErrnoException).code === 'string'
        ? (cause as NodeJS.ErrnoException).code
        : undefined;
    return code ? `${err.message}: ${cause.message} (${code})` : `${err.message}: ${cause.message}`;
  }
  return err.message;
}

/**
 * Corporate Jira hosts (e.g. *.vodafone.local) often use an internal CA that
 * Node's built-in trust store does not include — browsers do, so the same URL
 * works in Chrome but native fetch() fails with "fetch failed".
 */
function shouldRelaxTls(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.endsWith('.local') || host === 'localhost' || host.endsWith('.internal');
}

async function jiraFetch(
  baseUrl: string,
  token: string,
  apiPath: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<Response> {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${apiPath}`);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const method = (init?.method || 'GET').toUpperCase();
  const body = init?.body;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token.trim()}`,
    ...(init?.headers || {}),
  };
  if (body != null) {
    headers['Content-Length'] = Buffer.byteLength(body).toString();
  }

  try {
    return await new Promise<Response>((resolve, reject) => {
      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          // Internal Jira CA is trusted by Windows/browser, not by Node.
          rejectUnauthorized: !(isHttps && shouldRelaxTls(url.hostname)),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value == null) continue;
              if (Array.isArray(value)) {
                for (const item of value) responseHeaders.append(key, item);
              } else {
                responseHeaders.set(key, value);
              }
            }
            resolve(
              new Response(buf, {
                status: res.statusCode || 0,
                statusText: res.statusMessage || '',
                headers: responseHeaders,
              })
            );
          });
        }
      );
      req.on('error', reject);
      if (body != null) req.write(body);
      req.end();
    });
  } catch (err) {
    throw new Error(`Jira bağlantısı başarısız (${url.origin}): ${formatNetworkError(err)}`);
  }
}

async function loadFieldMap(
  baseUrl: string,
  token: string
): Promise<Map<string, string>> {
  const response = await jiraFetch(baseUrl, token, '/rest/api/2/field');
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Jira field listesi alınamadı (${response.status}): ${body.slice(0, 300)}`
    );
  }

  const fields = (await response.json()) as JiraFieldMeta[];
  const map = new Map<string, string>();
  for (const field of fields) {
    if (field?.id && field?.name) {
      map.set(field.name.toLowerCase(), field.id);
    }
  }
  return map;
}

function resolveFieldId(fieldMap: Map<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const id = fieldMap.get(alias.toLowerCase());
    if (id) return id;
  }
  return null;
}

function readCustomField(
  fields: Record<string, unknown>,
  fieldMap: Map<string, string>,
  aliases: string[]
): string {
  const fieldId = resolveFieldId(fieldMap, aliases);
  if (!fieldId) return '';
  return asText(fields[fieldId]);
}

function mapIssue(
  issue: JiraSearchIssue,
  baseUrl: string,
  fieldMap: Map<string, string>,
  fallbackScanType: string
): JiraVulnerabilityFinding {
  const fields = issue.fields || {};
  const key = issue.key;
  return {
    key,
    summary: asText(fields.summary),
    description: asText(fields.description),
    priority: asText(fields.priority) || 'Unknown',
    status: asText(fields.status) || 'Unknown',
    scanType:
      readCustomField(fields, fieldMap, FIELD_ALIASES.scanType) || fallbackScanType,
    codeRepoName: readCustomField(fields, fieldMap, FIELD_ALIASES.codeRepoName),
    vulnerabilityPath: readCustomField(fields, fieldMap, FIELD_ALIASES.vulnerabilityPath),
    moreInfoUrl: readCustomField(fields, fieldMap, FIELD_ALIASES.moreInfoUrl),
    epss: readCustomField(fields, fieldMap, FIELD_ALIASES.epss),
    vulnerabilityId: readCustomField(fields, fieldMap, FIELD_ALIASES.vulnerabilityId),
    issueUrl: `${normalizeBaseUrl(baseUrl)}/browse/${key}`,
    rawFields: fields,
  };
}

async function searchIssues(
  baseUrl: string,
  token: string,
  jql: string,
  fieldMap: Map<string, string>,
  fallbackScanType: string,
  maxResults: number
): Promise<JiraVulnerabilityFinding[]> {
  const customFieldIds = Object.values(FIELD_ALIASES)
    .map((aliases) => resolveFieldId(fieldMap, aliases))
    .filter((id): id is string => Boolean(id));

  const fields = [
    'summary',
    'description',
    'priority',
    'status',
    ...customFieldIds,
  ];

  const response = await jiraFetch(baseUrl, token, '/rest/api/2/search', {
    method: 'POST',
    body: JSON.stringify({
      jql,
      startAt: 0,
      maxResults,
      fields,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Jira araması başarısız (${response.status}): ${body.slice(0, 400)}\nJQL: ${jql}`
    );
  }

  const payload = (await response.json()) as {
    issues?: JiraSearchIssue[];
    total?: number;
  };

  return (payload.issues || []).map((issue) =>
    mapIssue(issue, baseUrl, fieldMap, fallbackScanType)
  );
}

export function formatFindingsForDisplay(
  title: string,
  findings: JiraVulnerabilityFinding[],
  jql: string | null
): string {
  if (!jql) {
    return `${title}\n\nBu tarayıcı seçili değil — sorgu çalıştırılmadı.`;
  }

  if (findings.length === 0) {
    return [
      `# ${title}`,
      '',
      `JQL: ${jql}`,
      '',
      'Açık bulgu bulunamadı.',
    ].join('\n');
  }

  const blocks = findings.map((finding, index) => {
    const lines = [
      `## ${index + 1}. ${finding.key} — ${finding.summary}`,
      '',
      `- Priority: ${finding.priority}`,
      `- Status: ${finding.status}`,
      `- Scan Type: ${finding.scanType}`,
      `- Code Repo Name: ${finding.codeRepoName || '-'}`,
      `- Vulnerability Path: ${finding.vulnerabilityPath || '-'}`,
      `- Vulnerability ID: ${finding.vulnerabilityId || '-'}`,
      `- EPSS: ${finding.epss || '-'}`,
      `- More Info: ${finding.moreInfoUrl || '-'}`,
      `- Jira: ${finding.issueUrl}`,
      '',
      '### Description',
      finding.description || '(açıklama yok)',
    ];
    return lines.join('\n');
  });

  return [
    `# ${title}`,
    '',
    `Toplam: ${findings.length}`,
    '',
    `JQL: ${jql}`,
    '',
    ...blocks,
  ].join('\n');
}

export async function fetchSecurityFindings(
  input: FetchSecurityFindingsInput
): Promise<SecurityFindingsResult> {
  const baseUrl = normalizeBaseUrl(input.jiraBaseUrl || DEFAULT_JIRA_BASE_URL);
  const token = input.jiraToken?.trim();
  const repoName = input.repoName.trim();
  const projectKey = (input.projectKey || DEFAULT_JIRA_PROJECT).trim();
  const maxResults = input.maxResultsPerScan ?? 100;

  if (!token) {
    throw new Error('Jira personal token gerekli.');
  }
  if (!repoName) {
    throw new Error('Repo adı çözümlenemedi.');
  }
  if (!input.includeMend && !input.includeFortify) {
    return {
      repoName,
      mend: [],
      fortify: [],
      mendJql: null,
      fortifyJql: null,
      mendText: formatFindingsForDisplay('Mend Findings', [], null),
      fortifyText: formatFindingsForDisplay('Fortify Findings', [], null),
    };
  }

  const fieldMap = await loadFieldMap(baseUrl, token);

  let mend: JiraVulnerabilityFinding[] = [];
  let fortify: JiraVulnerabilityFinding[] = [];
  let mendJql: string | null = null;
  let fortifyJql: string | null = null;

  if (input.includeMend) {
    mendJql = buildSecurityJql(MEND_SCAN_TYPE, repoName, projectKey);
    mend = await searchIssues(baseUrl, token, mendJql, fieldMap, MEND_SCAN_TYPE, maxResults);
  }

  if (input.includeFortify) {
    fortifyJql = buildSecurityJql(FORTIFY_SCAN_TYPE, repoName, projectKey);
    fortify = await searchIssues(
      baseUrl,
      token,
      fortifyJql,
      fieldMap,
      FORTIFY_SCAN_TYPE,
      maxResults
    );
  }

  return {
    repoName,
    mend,
    fortify,
    mendJql,
    fortifyJql,
    mendText: formatFindingsForDisplay('Mend Findings', mend, mendJql),
    fortifyText: formatFindingsForDisplay('Fortify Findings', fortify, fortifyJql),
  };
}
