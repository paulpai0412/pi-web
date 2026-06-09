import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";

interface SkillInfo {
  name: string;
  description: string;
  source: "pi" | "agents";
  commands: Array<{ command: string; description: string }>;
}

const MAX_SKILLS = 300;

function extractFrontmatterValue(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return null;
  return match[1]?.trim().replace(/^['\"]|['\"]$/g, "") ?? null;
}

function parseSkillCommands(content: string): Array<{ command: string; description: string }> {
  const byCommand = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const matches = [...line.matchAll(/`(\/[a-zA-Z0-9._-]+)`/g)];
    if (matches.length === 0) continue;

    const lineDesc = line
      .replace(/`\/[a-zA-Z0-9._-]+`/g, "")
      .replace(/`[^`]+`/g, "")
      .replace(/\|/g, " ")
      .replace(/^\s*[-*+]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    for (const m of matches) {
      const normalized = (m[1] ?? "").replace(/^\/+/, "");
      if (!normalized || byCommand.has(normalized)) continue;
      byCommand.set(normalized, lineDesc || `/${normalized}`);
    }
  }

  return Array.from(byCommand.entries()).map(([command, description]) => ({ command, description })).slice(0, 120);
}

function parseSkillFile(path: string): { name: string; description: string; commands: Array<{ command: string; description: string }> } | null {
  try {
    const content = readFileSync(path, "utf8");
    let name: string | null = null;
    let description: string | null = null;

    if (content.startsWith("---\n")) {
      const fmEnd = content.indexOf("\n---\n", 4);
      if (fmEnd > 0) {
        const fm = content.slice(4, fmEnd);
        name = extractFrontmatterValue(fm, "name");
        description = extractFrontmatterValue(fm, "description");
      }
    }

    if (!name) {
      const heading = content.match(/^#\s+(.+)$/m);
      if (heading?.[1]) name = heading[1].trim().toLowerCase().replace(/\s+/g, "-");
    }

    if (!description) {
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line !== "---");
      description = lines[0] ?? "";
    }

    if (!name) return null;
    return { name, description: description ?? "", commands: parseSkillCommands(content) };
  } catch {
    return null;
  }
}

function findSkillMdFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0 && files.length < MAX_SKILLS) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile() && entry === "SKILL.md") {
        files.push(full);
        if (files.length >= MAX_SKILLS) break;
      }
    }
  }

  return files;
}

export async function GET() {
  const home = homedir();
  const roots: Array<{ path: string; source: SkillInfo["source"] }> = [
    { path: join(home, ".pi", "agent", "skills"), source: "pi" },
    { path: join(home, ".agents", "skills"), source: "agents" },
  ];

  const byName = new Map<string, SkillInfo>();

  for (const root of roots) {
    for (const skillPath of findSkillMdFiles(root.path)) {
      const parsed = parseSkillFile(skillPath);
      if (!parsed) continue;
      if (!byName.has(parsed.name)) {
        byName.set(parsed.name, {
          name: parsed.name,
          description: parsed.description,
          source: root.source,
          commands: parsed.commands,
        });
      }
    }
  }

  const skills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ skills });
}
