export interface SkillRecord {
  name: string;
  description: string;
  content: string;
  dirPath: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface SkillDiagnostic {
  type: "warning";
  code: "read_failed" | "parse_failed" | "invalid_metadata" | "duplicate";
  message: string;
  path: string;
}

export interface LoadSkillsResult {
  skills: SkillRecord[];
  diagnostics: SkillDiagnostic[];
}
