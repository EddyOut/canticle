/**
 * Developer Certificate of Origin check (CONTRIBUTING.md). CI runs it on pull
 * requests from forks, which is where contributions from outside Mandorum
 * arrive. Every non-merge commit must carry a `Signed-off-by` trailer whose
 * email matches the commit author's.
 */

export interface Commit {
  sha: string;
  parentCount: number;
  authorName: string;
  authorEmail: string;
  message: string;
}

/** The `git log` format this parser reads; fields split by US, records by RS. */
export const GIT_LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%B%x1e';

export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of raw.split('\x1e')) {
    if (record.trim() === '') continue;
    const fields = record.replace(/^\n/, '').split('\x1f');
    if (fields.length !== 5) {
      throw new Error(`Unexpected git log record with ${fields.length} fields.`);
    }
    const [sha, parents, authorName, authorEmail, message] = fields as [
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      sha,
      parentCount: parents.trim() === '' ? 0 : parents.trim().split(/\s+/).length,
      authorName,
      authorEmail,
      message,
    });
  }
  return commits;
}

const SIGN_OFF = /^Signed-off-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/gm;

export interface SignOffViolation {
  sha: string;
  reason: string;
}

export function checkSignOffs(commits: readonly Commit[]): SignOffViolation[] {
  const violations: SignOffViolation[] = [];
  for (const commit of commits) {
    if (commit.parentCount > 1) continue;
    const emails = [...commit.message.matchAll(SIGN_OFF)].map((m) => (m[2] ?? '').toLowerCase());
    if (emails.length === 0) {
      violations.push({ sha: commit.sha, reason: 'no Signed-off-by line' });
    } else if (!emails.includes(commit.authorEmail.toLowerCase())) {
      violations.push({
        sha: commit.sha,
        reason: `no Signed-off-by line for the author's email (${commit.authorEmail})`,
      });
    }
  }
  return violations;
}
