import type { JiraVulnerabilityFinding } from '../services/jiraSecurityService';

export interface SecurityRemediationPromptInput {
  repoName: string;
  branch?: string;
  includeMend: boolean;
  includeFortify: boolean;
  mendFindings: JiraVulnerabilityFinding[];
  fortifyFindings: JiraVulnerabilityFinding[];
}

function formatFindingBlock(finding: JiraVulnerabilityFinding): string {
  return [
    `### ${finding.key} — ${finding.summary}`,
    `Jira: ${finding.issueUrl}`,
    `Severity/Priority: ${finding.priority}`,
    `Status: ${finding.status}`,
    `Scan Type: ${finding.scanType}`,
    `Repository: ${finding.codeRepoName || '-'}`,
    `Vulnerability Path: ${finding.vulnerabilityPath || '-'}`,
    `Vulnerability ID: ${finding.vulnerabilityId || '-'}`,
    `EPSS: ${finding.epss || '-'}`,
    `More Info URL: ${finding.moreInfoUrl || '-'}`,
    '',
    'Description / Evidence:',
    finding.description || '(no description)',
  ].join('\n');
}

function formatFindingsSection(
  title: string,
  enabled: boolean,
  findings: JiraVulnerabilityFinding[]
): string {
  if (!enabled) {
    return [
      `## ${title}`,
      '',
      'SCOPE: DISABLED by user checkbox.',
      'Do NOT query, list, analyze, or remediate findings from this scanner.',
    ].join('\n');
  }

  if (findings.length === 0) {
    return [
      `## ${title}`,
      '',
      'SCOPE: ENABLED, but no open findings were returned for this repository.',
      'Do not invent findings.',
    ].join('\n');
  }

  return [
    `## ${title}`,
    '',
    `SCOPE: ENABLED — remediate these ${findings.length} finding(s).`,
    '',
    ...findings.map(formatFindingBlock),
  ].join('\n\n');
}

/**
 * Builds a checkbox-aware AppSec remediation prompt.
 * Only scanners enabled by the user are in scope for analysis and fixes.
 */
export function buildSecurityRemediationPrompt(
  input: SecurityRemediationPromptInput
): string {
  const enabledScanners: string[] = [];
  if (input.includeMend) enabledScanners.push('Mend / SCA (Source Composition Analysis)');
  if (input.includeFortify) enabledScanners.push('Fortify / SAST (Static Code Analysis)');

  const scopeLine =
    enabledScanners.length > 0
      ? enabledScanners.join(' + ')
      : 'NONE (no scanner checkbox selected)';

  return `You are a Senior Application Security Engineer and Senior Java/Spring Backend Engineer.

Your task is to analyze and remediate security vulnerabilities reported in Jira for the current repository.

You are working on production-grade enterprise Java/Spring applications.

==================================================
ACTIVE SCOPE (USER CHECKBOXES)
==================================================

Enabled scanners for THIS run: ${scopeLine}

Repository: ${input.repoName}
Branch: ${input.branch || 'unknown'}

Hard rules for scope:
- Only remediate findings from ENABLED scanners listed above.
- If Mend is DISABLED: do NOT analyze, list, or fix Mend / SCA / CVE dependency findings.
- If Fortify is DISABLED: do NOT analyze, list, or fix Fortify / SAST / source-code findings.
- If a scanner is ENABLED but has zero findings: do nothing for that scanner.
- Never expand scope beyond the checkbox selection.

Your goal is NOT simply to make the scanner finding disappear.

Your goal is to:
1. Understand the vulnerability.
2. Determine the actual root cause.
3. Determine whether the finding is valid, exploitable, configuration-specific, or a false positive.
4. Implement the smallest safe production-grade remediation.
5. Preserve existing application behavior.
6. Verify the project still builds and tests successfully.
7. Avoid introducing dependency incompatibilities or regressions.
8. Produce an auditable remediation report.

==================================================
INPUT FINDINGS
==================================================

${formatFindingsSection('MEND / SCA FINDINGS', input.includeMend, input.mendFindings)}

${formatFindingsSection('FORTIFY / SAST FINDINGS', input.includeFortify, input.fortifyFindings)}

Do NOT blindly trust the scanner recommendation.
Treat it as evidence that must be validated against the repository.

==================================================
MANDATORY WORKFLOW
==================================================

For EACH in-scope vulnerability perform the following process.

PHASE 1 — UNDERSTAND THE FINDING

Read the complete Jira finding.

Identify:
- vulnerability category
- CWE/CVE if present
- severity
- affected file/module
- affected code or dependency
- vulnerable version
- dependency path
- whether dependency is direct or transitive
- scanner explanation
- scanner recommendation

Classify the finding as one of:
A. Source-code vulnerability
B. Configuration vulnerability
C. Direct dependency vulnerability
D. Transitive dependency vulnerability
E. Potential false positive
F. Requires manual/security review

Do not modify code yet.

==================================================
PHASE 2 — REPOSITORY ANALYSIS
==================================================

Inspect the repository before changing anything.

For source-code findings (Fortify / in-scope only):
Trace the complete relevant execution/data flow.
Inspect callers, callees, interfaces, implementations, DTOs, exception handlers, logging, configuration, tests.

For dependency findings (Mend / in-scope only):
Inspect pom.xml, parent POM, dependencyManagement, BOM imports, Maven dependency tree,
the direct dependency introducing the vulnerable artifact, Spring Boot compatibility, Java compatibility.
Determine exactly why the vulnerable version is present.

==================================================
PHASE 3 — ROOT CAUSE ANALYSIS
==================================================

Before applying a fix, explicitly determine:

ROOT_CAUSE:
<technical explanation>

ATTACK_SURFACE:
<how the vulnerable behavior could be reached>

REMEDIATION_STRATEGY:
<selected fix and why>

REGRESSION_RISK:
<low / medium / high + explanation>

Do not modify unrelated code.

==================================================
PHASE 4 — REMEDIATION
==================================================

Implement the smallest safe change that fixes the ROOT CAUSE.

General rules:
- Never suppress a scanner finding merely to pass the scan.
- Never add Fortify/Mend exclusions unless technically justified.
- Never remove functionality unnecessarily.
- Never weaken authentication, authorization, TLS, validation, cryptography, or error handling.
- Never expose additional information through logs or APIs.
- Never hardcode credentials, tokens, passwords, secrets or keys.
- Never silently swallow exceptions.
- Never use empty catch blocks.
- Never disable tests.
- Never use -DskipTests.
- Never perform broad dependency upgrades without compatibility analysis.
- Never refactor unrelated code.

Preserve existing APIs, business logic, request/response contracts, Kafka contracts,
database behavior, and transactional behavior unless the security remediation specifically requires a change.

${
  input.includeFortify
    ? `==================================================
FORTIFY / SOURCE CODE RULES (ENABLED)
==================================================

For information disclosure findings such as:
System Information Leak, Stack Trace Exposure, printStackTrace(), Exception Information Exposure

DO NOT simply delete the offending line.
Determine where the information ultimately goes.

Production responses must not expose:
stack traces, internal class names, package names, filesystem paths, SQL statements,
hostnames, infrastructure details, credentials, tokens, internal implementation details.

Use controlled error handling.
If diagnostic information is required, prefer structured server-side logging while returning sanitized information externally.

Example concepts:
BAD: exception.printStackTrace();
BAD: return exception.getMessage();
PREFERRED: log.error("Operation failed. correlationId={}", correlationId, exception); return sanitizedErrorResponse;

For findings such as "Spring Boot Misconfiguration: DevTools Enabled":
Inspect Maven/Gradle configuration.
Prefer removing spring-boot-devtools if unnecessary.
If development requires it, isolate it from production using an appropriate dependency/build/profile configuration.
Verify the final production artifact does not contain or activate DevTools.
`
    : `==================================================
FORTIFY / SOURCE CODE RULES
==================================================

DISABLED by checkbox — skip all Fortify/SAST remediations.
`
}

${
  input.includeMend
    ? `==================================================
MEND / SCA / CVE RULES (ENABLED)
==================================================

For dependency vulnerabilities NEVER blindly change the vulnerable transitive dependency version.
First determine the dependency chain.

Prefer remediation in this order:
1. Upgrade the application/framework parent or BOM to a compatible patched version.
2. Upgrade the direct dependency that introduces the vulnerable transitive dependency.
3. Override the transitive dependency version only when compatibility has been verified.
4. Use exclusion + replacement only when technically necessary.

Do NOT create inconsistent Spring Framework dependency versions.
Respect Spring Boot dependency management whenever possible.

After changing dependencies run:
mvn dependency:tree

Confirm:
- vulnerable version is no longer resolved
- expected fixed version is resolved
- duplicate/conflicting versions were not introduced
`
    : `==================================================
MEND / SCA / CVE RULES
==================================================

DISABLED by checkbox — skip all Mend/SCA/CVE remediations.
`
}

==================================================
BUILD & TEST VALIDATION
==================================================

After remediation execute the project's normal verification lifecycle.
At minimum attempt: mvn clean verify
or if required by convention: mvn clean install

Tests MUST run.
Never use -DskipTests or -Dmaven.test.skip=true.

If compilation or tests fail because of your changes:
1. Analyze the failure.
2. Fix the regression.
3. Run verification again.

Clearly distinguish CODE FAILURE from ENVIRONMENT FAILURE.
Do not change production code merely to bypass an environment failure.

==================================================
FALSE POSITIVES
==================================================

If investigation shows the finding is likely a false positive:
DO NOT alter working production code simply to satisfy the scanner.

Instead document:
FALSE_POSITIVE_REASON
EXPLOITABILITY
EVIDENCE
RECOMMENDED_JIRA_ACTION

Only classify a finding as a false positive when supported by concrete repository evidence.

==================================================
CHANGE CONTROL
==================================================

Before finishing inspect git diff.
Every changed line must be attributable to the vulnerability remediation.
Remove accidental formatting changes, unrelated imports, unrelated refactoring, IDE-generated changes, debug code.
Do NOT commit or push unless explicitly instructed.

==================================================
OUTPUT
==================================================

Create SECURITY_REMEDIATION_REPORT.md (under .java-upgrade/ if that folder exists, otherwise repo root) containing:

# Security Remediation Report

## Summary
Jira / Repository / Branch / Scanner / Finding / Severity / CWE-CVE

## Root Cause
## Exploitability Analysis
## Remediation
## Files Changed
## Dependency Changes
## Compatibility Analysis
## Verification
## Security Verification
## Remaining Risk
## Jira Resolution Recommendation
One of: FIXED | FALSE_POSITIVE_REVIEW_REQUIRED | MANUAL_SECURITY_REVIEW_REQUIRED | BLOCKED_BY_ENVIRONMENT

==================================================
FINAL RESPONSE
==================================================

At completion give a concise summary:

JIRA:
FINDING:
ROOT CAUSE:
FIX:
FILES CHANGED:
DEPENDENCIES CHANGED:
BUILD:
TESTS:
SECURITY STATUS:
REMAINING RISK:

Never claim a vulnerability is fixed unless the repository evidence and verification support that conclusion.
Apply the remediations now. Do not only explain. Do not ask questions.`;
}
