/** FB6: an empty setting, or the URL of one GitHub Issue. */
export const issueUrl = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[1-9][0-9]*$/;

export const validIssueUrl = (url: string): boolean => issueUrl.test(url.trim());
