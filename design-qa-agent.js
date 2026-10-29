#!/usr/bin/env node
/**
 * Design QA Agent — workshop stub
 *
 * Runs on every pull request. Fetches the diff, checks it against the
 * design system's component manifest, and posts a pass/fail result back
 * to the PR.
 *
 * ALREADY WIRED: fetching the diff, reading the manifest, calling
 * Claude, handling API errors, parsing the response, posting the
 * result, exiting with the right status code.
 *
 * YOUR JOB: fill in buildPrompt() — write the prompt that decides
 * whether the diff follows the design system.
 *
 * File paths below are placeholders. Update them to match your repo.
 */

import fs from "node:fs";

// --- Placeholders — update these to match your repo structure ---
const PLACEHOLDER_MANIFEST_PATH = "./manifest.json"; // now pointed at the real manifest
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // swap for 'claude-sonnet-5' if you want stronger reasoning

// ============================================================
// ALREADY WIRED — fetch the PR diff
// ============================================================
async function fetchDiff() {
  const repo = process.env.GITHUB_REPOSITORY; // e.g. "your-username/your-repo"
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3.diff",
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch diff: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ============================================================
// ALREADY WIRED — read the component manifest
// ============================================================
function readManifest() {
  return fs.readFileSync(PLACEHOLDER_MANIFEST_PATH, "utf-8");
}

function buildPrompt(diff, manifest) {
  return `You are a design system QA reviewer. Your only source of truth is the
component manifest below. The manifest is the complete definition of what is
"on-system" — do not apply any outside style opinions, personal preferences,
or best practices that are not written in the manifest.

An issue is ONLY a line in the diff that breaks something stated in the
manifest. If the manifest does not mention it, it is not an issue — even if it
looks wrong. This means the manifest can be extended later (new rule, new
deprecated variant, new approved value) and you will start enforcing it with no
change to these instructions.

Check the diff against EVERYTHING in the manifest, including:
  - "components": only use approved "approvedVariants" and "approvedSizes";
    flag any "deprecatedVariants" (use its message to say what to switch to);
    only use the listed "subcomponents"; import from the listed "import" path.
  - "rules": every rule in this array.
  - "accessibilityRules": every rule in this array.
  - "responsiveRules": every rule in this array.
  - "spacingScale": the only approved spacing values; flag off-scale values.
  - Any other key present in the manifest — treat it as a constraint to enforce.

Scope:
  - Only review ADDED or MODIFIED lines in the diff (lines starting with "+").
    Do not flag pre-existing/context lines or removed lines.
  - Report the file path and the line as shown in the diff.

For each violation, write:
  - "issue": a short statement of which manifest item is broken.
  - "reasoning": the clear, specific action to fix it — the exact change to
    make (e.g. replace variant="ghost" with variant="outline"), quoting the
    manifest rule or deprecation message that requires it.

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "pass": true | false,
  "findings": [
    { "file": "...", "line": "...", "issue": "...", "reasoning": "..." }
  ]
}
If there are no violations, "pass" must be true and "findings" must be [].
If there is at least one violation, "pass" must be false.

Manifest:
${manifest}

Diff:
${diff}`;
}

// ============================================================
// ALREADY WIRED — calls Claude, checks for API errors, and parses
// the JSON response. You shouldn't need to touch this function.
// ============================================================
async function checkDesignCompliance(diff, manifest) {
  const prompt = buildPrompt(diff, manifest);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`Anthropic API error (status ${response.status}):`, JSON.stringify(data, null, 2));
    return {
      pass: false,
      findings: [{
        file: "-",
        line: "-",
        issue: "API call failed",
        reasoning: data?.error?.message || `HTTP ${response.status}`,
      }],
    };
  }

  const text = data.content?.[0]?.text ?? "";

  try {
    const cleaned = text.replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(cleaned);
    return {
      pass: result.pass === true,
      findings: Array.isArray(result.findings) ? result.findings : [],
    };
  } catch (err) {
    console.error("Failed to parse Claude's response as JSON:", text);
    return {
      pass: false,
      findings: [{ file: "-", line: "-", issue: "Agent response could not be parsed", reasoning: text.slice(0, 300) }],
    };
  }
}


// ============================================================
// ALREADY WIRED — post the result back to the PR
// ============================================================
async function postResult(result) {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  const body = result.pass
    ? `Design QA agent: no issues found.`
    : `Design QA agent found issues:\n\n${result.findings
        .map((f) => `- **${f.file}:${f.line}** — ${f.issue}\n  ${f.reasoning}`)
        .join("\n")}`;

  const commentRes = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!commentRes.ok) {
    const errText = await commentRes.text();
    console.error(`Failed to post comment (status ${commentRes.status}):`, errText);
  } else {
    console.log("Comment posted successfully.");
  }

  // Non-zero exit makes the GitHub Action report a failed check.
  process.exit(result.pass ? 0 : 1);
}

// ============================================================
// ALREADY WIRED — run it
// ============================================================
(async function main() {
  try {
    const diff = await fetchDiff();
    const manifest = readManifest();
    const result = await checkDesignCompliance(diff, manifest);
    await postResult(result);
  } catch (err) {
    console.error("Design QA agent failed to run:", err);
    process.exit(1);
  }
})();