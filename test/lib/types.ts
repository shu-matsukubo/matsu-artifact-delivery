export interface SkillMetadata {
  name: string;
  description: string;
  compatibility?: string;
}
export interface SkillSettings {
  interface: { display_name: string; short_description: string };
  policy: { allow_implicit_invocation: boolean };
}
export interface Skill {
  metadata: SkillMetadata;
  body: string;
  root: string;
  settings: SkillSettings;
}
export interface Agent {
  name: string;
  description: string;
  model: string;
  model_reasoning_effort: string;
  developer_instructions: string;
  sandbox_mode?: string;
  approval_policy?: string;
  agents?: { enabled: boolean };
}
export interface Contract {
  id: string;
  contains?: string[];
  matches?: string[];
  excludes?: string[];
  ordered?: string[];
}
export interface FileContract extends Contract {
  title: string;
  file: string;
}
