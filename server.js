import "dotenv/config";
import express from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "node:path";
import fs from "node:fs/promises";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.GITHUB_TOKEN;
const DEFAULT_OWNER = process.env.GITHUB_OWNER || "";

if (!TOKEN) {
  console.warn("WARNING: GITHUB_TOKEN is not set in .env");
}

app.use(express.json());
app.use(express.static("public"));

function safeZipPath(name) {
  const normalized = path.posix.normalize(name.replaceAll("\\", "/"));
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    throw new Error(`Unsafe ZIP path: ${name}`);
  }
  return normalized;
}

async function github(method, endpoint, body) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-zip-pusher"
    },
    ...(body === undefined ? {} : {
      "Content-Type": "application/json",
      body: JSON.stringify(body)
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }

  if (!response.ok) {
    throw new Error(data.message || `GitHub API error (${response.status})`);
  }
  return data;
}

app.post("/api/push", upload.single("zip"), async (req, res) => {
  try {
    if (!TOKEN) throw new Error("GITHUB_TOKEN is missing from .env");
    if (!req.file) throw new Error("No ZIP file uploaded");

    const owner = (req.body.owner || DEFAULT_OWNER).trim();
    const repo = (req.body.repo || "").trim();
    const branch = (req.body.branch || "main").trim();

    if (!owner || !repo) throw new Error("Owner and repository name are required");
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new Error("Invalid GitHub owner or repository name");
    }

    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    if (!entries.length) throw new Error("The ZIP contains no files");

    // Limit decoded total size to avoid accidentally pushing huge archives.
    const MAX_TOTAL = 200 * 1024 * 1024;
    let total = 0;
    const files = [];

    for (const entry of entries) {
      const name = safeZipPath(entry.entryName);
      const data = entry.getData();
      total += data.length;
      if (total > MAX_TOTAL) throw new Error("Extracted ZIP is larger than 200 MB");
      files.push({ path: name, content: data.toString("base64") });
    }

    // Verify access and branch/ref.
    const repoInfo = await github("GET", `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    let targetBranch = branch;

    try {
      await github("GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(targetBranch)}`);
    } catch {
      targetBranch = repoInfo.default_branch || "main";
    }

    const ref = await github(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(targetBranch)}`
    );
    const baseCommitSha = ref.object.sha;

    const baseCommit = await github(
      "GET",
      `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`
    );
    const baseTreeSha = baseCommit.tree.sha;

    const tree = await github("POST", `/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: files.map(f => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: Buffer.from(f.content, "base64").toString("utf8")
      }))
    });

    const commit = await github("POST", `/repos/${owner}/${repo}/git/commits`, {
      message: `Upload ZIP files`,
      tree: tree.sha,
      parents: [baseCommitSha]
    });

    await github(
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(targetBranch)}`,
      { sha: commit.sha }
    );

    res.json({
      ok: true,
      owner,
      repo,
      branch: targetBranch,
      files: files.length,
      url: `https://github.com/${owner}/${repo}`
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`GitHub ZIP Pusher running at http://localhost:${PORT}`);
});
