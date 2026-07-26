import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookEventName, HookGroup, HooksConfig, SettingsFile } from "./types";

// ============================================================================
// Dynamic Launcher-Aware Config File Resolution (omp vs pi)
// Prioritizes settings corresponding to the launching agent host
// ============================================================================

export type LauncherHost = "omp" | "pi";

export function detectLauncherHost(): LauncherHost {
  // 1. OMP-specific environment variables
  if (
    process.env.OMP_SETTINGS_FILE ||
    process.env.OMP_AGENT_DIR ||
    process.env.OMP_CODING_AGENT_DIR ||
    process.env.OMP_CONFIG_DIR ||
    process.env.OMP_DIR
  ) {
    return "omp";
  }

  // 2. PI-specific environment variables
  if (
    process.env.PI_SETTINGS_FILE ||
    process.env.PI_AGENT_DIR ||
    process.env.PI_CODING_AGENT_DIR ||
    process.env.PI_CONFIG_DIR ||
    process.env.PI_DIR
  ) {
    const dirVal = (process.env.PI_CODING_AGENT_DIR || process.env.PI_CONFIG_DIR || "").toLowerCase();
    if (dirVal.includes("omp")) return "omp";
    return "pi";
  }

  // 3. Process execution inspection (argv, process.title, process.execPath, process.env._)
  const procInfo = [
    ...(process.argv || []),
    process.argv0 || "",
    process.title || "",
    process.execPath || "",
    process.env._ || "",
    process.env.APP_NAME || "",
    process.env.AGENT_NAME || "",
  ]
    .join(" ")
    .toLowerCase();

  if (procInfo.includes("omp") || procInfo.includes("oh-my-pi")) {
    return "omp";
  }

  // 4. Default fallback: check if ~/.omp/agent/settings.json exists
  const homeDir = os.homedir();
  if (existsSync(path.join(homeDir, ".omp", "agent", "settings.json"))) {
    return "omp";
  }

  return "pi";
}

export function getGlobalSettingsPath(): string {
  const host = detectLauncherHost();

  // Direct file path overrides
  if (process.env.PI_SETTINGS_FILE?.trim()) {
    return path.resolve(process.env.PI_SETTINGS_FILE.trim());
  }
  if (process.env.OMP_SETTINGS_FILE?.trim()) {
    return path.resolve(process.env.OMP_SETTINGS_FILE.trim());
  }

  // Direct agent directory overrides
  const agentDirOverride =
    process.env.PI_CODING_AGENT_DIR?.trim() ||
    process.env.OMP_CODING_AGENT_DIR?.trim() ||
    process.env.PI_AGENT_DIR?.trim() ||
    process.env.OMP_AGENT_DIR?.trim();

  if (agentDirOverride) {
    const customSettings = path.join(path.resolve(agentDirOverride), "settings.json");
    if (existsSync(customSettings)) return customSettings;
    return customSettings;
  }

  // Root config directory name/path override
  const configDirName =
    process.env.PI_CONFIG_DIR?.trim() ||
    process.env.OMP_CONFIG_DIR?.trim() ||
    process.env.PI_DIR?.trim() ||
    process.env.OMP_DIR?.trim();

  const homeDir = os.homedir();

  if (configDirName) {
    const configRoot = path.isAbsolute(configDirName)
      ? configDirName
      : path.join(homeDir, configDirName);
    const agentSettings = path.join(configRoot, "agent", "settings.json");
    if (existsSync(agentSettings)) return agentSettings;
    const rootSettings = path.join(configRoot, "settings.json");
    if (existsSync(rootSettings)) return rootSettings;
  }

  // XDG standard fallbacks
  if (process.env.XDG_CONFIG_HOME?.trim() || process.env.XDG_DATA_HOME?.trim()) {
    const xdgBase = (process.env.XDG_CONFIG_HOME || process.env.XDG_DATA_HOME || "").trim();
    const primaryFolder = host === "omp" ? "omp" : "pi";
    const secondaryFolder = host === "omp" ? "pi" : "omp";

    const xdgCandidates = [
      path.join(xdgBase, primaryFolder, "agent", "settings.json"),
      path.join(xdgBase, primaryFolder, "settings.json"),
      path.join(xdgBase, secondaryFolder, "agent", "settings.json"),
      path.join(xdgBase, secondaryFolder, "settings.json"),
    ];
    for (const cand of xdgCandidates) {
      if (existsSync(cand)) return cand;
    }
  }

  // Default home directory candidates prioritized by launching host!
  const defaultCandidates = host === "omp"
    ? [
        path.join(homeDir, ".omp", "agent", "settings.json"),
        path.join(homeDir, ".omp", "settings.json"),
        path.join(homeDir, ".pi", "agent", "settings.json"),
        path.join(homeDir, ".pi", "settings.json"),
      ]
    : [
        path.join(homeDir, ".pi", "agent", "settings.json"),
        path.join(homeDir, ".pi", "settings.json"),
        path.join(homeDir, ".omp", "agent", "settings.json"),
        path.join(homeDir, ".omp", "settings.json"),
      ];

  for (const cand of defaultCandidates) {
    if (existsSync(cand)) return cand;
  }

  return defaultCandidates[0];
}

export function getProjectSettingsPath(cwd: string): string {
  const host = detectLauncherHost();

  // Direct project file overrides
  if (process.env.PI_PROJECT_SETTINGS_FILE?.trim()) {
    return path.resolve(process.env.PI_PROJECT_SETTINGS_FILE.trim());
  }
  if (process.env.OMP_PROJECT_SETTINGS_FILE?.trim()) {
    return path.resolve(process.env.OMP_PROJECT_SETTINGS_FILE.trim());
  }

  // Direct project directory overrides
  const projectDir = process.env.PI_PROJECT_DIR?.trim() || process.env.OMP_PROJECT_DIR?.trim();
  if (projectDir) {
    const primaryFolder = host === "omp" ? ".omp" : ".pi";
    const secondaryFolder = host === "omp" ? ".pi" : ".omp";

    const p1 = path.join(projectDir, primaryFolder, "settings.json");
    if (existsSync(p1)) return p1;
    const p2 = path.join(projectDir, secondaryFolder, "settings.json");
    if (existsSync(p2)) return p2;
    return path.join(projectDir, "settings.json");
  }

  // Walk-up search from cwd to root, prioritizing launching host folder!
  let current = path.resolve(cwd);
  const root = path.parse(current).root;

  const primaryFolder = host === "omp" ? ".omp" : ".pi";
  const secondaryFolder = host === "omp" ? ".pi" : ".omp";

  while (current) {
    const p1 = path.join(current, primaryFolder, "settings.json");
    if (existsSync(p1)) return p1;

    const p2 = path.join(current, secondaryFolder, "settings.json");
    if (existsSync(p2)) return p2;

    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.join(cwd, primaryFolder, "settings.json");
}

export const GLOBAL_SETTINGS_PATH = getGlobalSettingsPath();

const HOOK_KEYS: Array<keyof HooksConfig> = [
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "Stop",
  "session_start",
  "session_end",
  "pre_compact",
  "post_compact",
  "pre_tool_use",
  "post_tool_use",
  "post_tool_use_failure",
  "user_prompt_submit",
  "stop",
];

export function readSettingsFile(settingsPath: string): SettingsFile | undefined {
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    return parsed as SettingsFile;
  } catch {
    return undefined;
  }
}

function mergeHooks(
  globalHooks: HooksConfig | undefined,
  projectHooks: HooksConfig | undefined,
): HooksConfig | undefined {
  const merged: HooksConfig = {};
  let hasAnyHook = false;

  for (const key of HOOK_KEYS) {
    const groups = [
      ...(globalHooks?.[key] ?? []),
      ...(projectHooks?.[key] ?? []),
    ];

    if (groups.length > 0) {
      merged[key] = groups;
      hasAnyHook = true;
    }
  }

  return hasAnyHook ? merged : undefined;
}

export function loadSettings(cwd: string): {
  settings: SettingsFile | undefined;
  sourcePaths: string[];
} {
  const globalSettingsPath = getGlobalSettingsPath();
  const projectSettingsPath = getProjectSettingsPath(cwd);

  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = readSettingsFile(projectSettingsPath);

  const sourcePaths = [globalSettingsPath, projectSettingsPath].filter((p) =>
    existsSync(p),
  );

  const hooks = mergeHooks(globalSettings?.hooks, projectSettings?.hooks);

  if (!hooks) {
    return { settings: undefined, sourcePaths };
  }

  return {
    settings: { hooks },
    sourcePaths,
  };
}

export function getHookGroups(
  settings: SettingsFile | undefined,
  eventName: HookEventName,
): HookGroup[] {
  const hooks = settings?.hooks;
  if (!hooks) return [];

  switch (eventName) {
    case "SessionStart":
      return [...(hooks.SessionStart ?? []), ...(hooks.session_start ?? [])];
    case "SessionEnd":
      return [...(hooks.SessionEnd ?? []), ...(hooks.session_end ?? [])];
    case "PreCompact":
      return [...(hooks.PreCompact ?? []), ...(hooks.pre_compact ?? [])];
    case "PostCompact":
      return [...(hooks.PostCompact ?? []), ...(hooks.post_compact ?? [])];
    case "PreToolUse":
      return [...(hooks.PreToolUse ?? []), ...(hooks.pre_tool_use ?? [])];
    case "PostToolUse":
      return [...(hooks.PostToolUse ?? []), ...(hooks.post_tool_use ?? [])];
    case "PostToolUseFailure":
      return [
        ...(hooks.PostToolUseFailure ?? []),
        ...(hooks.post_tool_use_failure ?? []),
      ];
    case "UserPromptSubmit":
      return [
        ...(hooks.UserPromptSubmit ?? []),
        ...(hooks.user_prompt_submit ?? []),
      ];
    case "Stop":
      return [...(hooks.Stop ?? []), ...(hooks.stop ?? [])];
    default:
      return [];
  }
}

/**
 * 检查 matcher 是否匹配给定的值。
 *
 * 与 Claude Code 保持一致：matcher 是单个正则字符串。
 * `undefined`、`""`、`"*"` 都表示匹配全部。
 */
export function matcherMatches(
  matcher: string | undefined,
  value: string,
): boolean {
  if (!matcher || matcher === "" || matcher === "*") return true;

  try {
    const regex = new RegExp(matcher);
    return regex.test(value);
  } catch {
    return matcher === value;
  }
}
