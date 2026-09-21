type TaskDependencies = { id: string; dependsOn: readonly string[] };

export type DependencyIssue =
  | { kind: 'duplicate_id'; taskIndex: number }
  | { kind: 'missing_dependency' | 'cycle'; taskIndex: number; dependencyIndex: number };

/** Zodに依存せず、ID重複・未定義の依存先・循環をそれぞれの位置とともに返す。 */
export function validateTaskDependencies(tasks: readonly TaskDependencies[]): DependencyIssue[] {
  const issues: DependencyIssue[] = [];
  const indices = new Map<string, number>();
  for (const [taskIndex, task] of tasks.entries()) {
    if (indices.has(task.id)) issues.push({ kind: 'duplicate_id', taskIndex });
    else indices.set(task.id, taskIndex);
  }
  for (const [taskIndex, task] of tasks.entries()) {
    for (const [dependencyIndex, dependency] of task.dependsOn.entries()) {
      if (!indices.has(dependency)) issues.push({ kind: 'missing_dependency', taskIndex, dependencyIndex });
    }
  }

  // IDが重複していると依存先を一意に決められないため、循環の判定は行わない。
  if (issues.some((issue) => issue.kind === 'duplicate_id')) return issues;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskIndex: number): void => {
    const task = tasks[taskIndex]!;
    visiting.add(task.id);
    for (const [dependencyIndex, dependency] of task.dependsOn.entries()) {
      const dependencyTaskIndex = indices.get(dependency);
      // 未定義の依存先は上で報告済み。他の有効な辺の循環検査は続ける。
      if (dependencyTaskIndex === undefined) continue;
      if (visiting.has(dependency)) issues.push({ kind: 'cycle', taskIndex, dependencyIndex });
      else if (!visited.has(dependency)) visit(dependencyTaskIndex);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const [taskIndex, task] of tasks.entries()) {
    if (!visited.has(task.id)) visit(taskIndex);
  }
  return issues;
}
