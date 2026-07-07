export type TaskStatus =
  | "running"
  | "queued"
  | "paused"
  | "completed"
  | "failed"
  | "blocked";

export type RoutingAction =
  | "create_new_task"
  | "append_to_existing_task"
  | "queue_behind_conflicting_task"
  | "ask_user_clarification";

export type UserPrompt = {
  id: string;
  text: string;
  createdAt: number;
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  summary: string;
  prompts: UserPrompt[];
  queue: UserPrompt[];
  filesTouched: string[];
  predictedFiles: string[];
  featureAreas: string[];
  createdAt: number;
  updatedAt: number;
};

export type RoutingDecision = {
  action: RoutingAction;
  targetTaskId?: string;
  confidence: number;
  reason: string;
  predictedFiles: string[];
  featureAreas: string[];
  clarificationQuestion?: string;
};

export type FileLock = {
  filePath: string;
  taskId: string;
  lockedAt: number;
};

export type TaskStoreSnapshot = {
  tasks: Task[];
  locks: FileLock[];
};

export type TaskBucket = {
  running: Task[];
  queued: Task[];
  paused: Task[];
  completed: Task[];
  failed: Task[];
  blocked: Task[];
};

export type ClassifierContext = {
  newPrompt: UserPrompt;
  activeTasks: Task[];
  queuedTasks: Task[];
  completedSummaries: Array<Pick<Task, "id" | "title" | "summary" | "featureAreas" | "filesTouched">>;
  lockedFiles: FileLock[];
  recentGitDiffFiles: string[];
  projectStructure: string[];
};

export type TaskRouteResult = {
  decision: RoutingDecision;
  task?: Task;
  queuedBehindTaskId?: string;
};
