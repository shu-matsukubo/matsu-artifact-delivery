// Shapes consumed by the repository tools. Portable manifests are validated
// against the pinned official schemas in validate-manifests.ts.
export interface PluginIdentity {
  name: string;
  version: string;
  description: string;
  author: { name: string };
  license: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: Record<string, unknown>;
}
export interface PluginManifest extends PluginIdentity {
  $schema: string;
  extensions?: Record<string, unknown>;
}
export interface CodexManifest extends PluginIdentity {
  id?: string;
  skills: string;
  apps?: string;
  mcpServers?: string;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName: string;
    defaultPrompt: string[];
    [key: string]: unknown;
  };
}
export interface McpServer {
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}
export interface McpManifest {
  $schema: string;
  mcpServers: Record<string, McpServer>;
}
export interface Marketplace {
  name: string;
  interface: { displayName: string };
  plugins: {
    name: string;
    source: { source: string; path: string };
    policy: { installation: string; authentication: string };
    category: string;
  }[];
}
export interface PackageMetadata {
  name: string;
  version: string;
  scripts: Record<string, string>;
}
export interface PackageLock {
  version: string;
  packages: Record<string, { version: string }>;
}
