import * as vscode from "vscode";
import { createClassifierService } from "./orchestrator/ClassifierService";
import { FileLockManager } from "./orchestrator/FileLockManager";
import { TaskRouter } from "./orchestrator/TaskRouter";
import { TaskStore } from "./orchestrator/TaskStore";
import { WorkerManager } from "./orchestrator/WorkerManager";
import { MockWorker } from "./workers/MockWorker";
import { OrchestratorPanel } from "./webview/OrchestratorPanel";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("AI Orchestrator");
  const store = new TaskStore(context.workspaceState);
  store.load();

  const lockManager = new FileLockManager();
  lockManager.hydrate(store.getLocks());

  const classifier = createClassifierService();
  const worker = new MockWorker();
  const router = new TaskRouter(store, lockManager, classifier, output);
  const workerManager = new WorkerManager(store, lockManager, worker, output);
  const panel = new OrchestratorPanel(context.extensionUri, store, router, workerManager);

  context.subscriptions.push(
    output,
    store.onDidChange((snapshot) => {
      lockManager.hydrate(snapshot.locks);
      panel.refresh();
    }),
    vscode.window.registerWebviewViewProvider(OrchestratorPanel.viewType, panel),
    vscode.commands.registerCommand("aiOrchestrator.openPanel", async () => {
      await vscode.commands.executeCommand(`${OrchestratorPanel.viewType}.focus`);
    }),
    vscode.commands.registerCommand("aiOrchestrator.submitPrompt", async () => {
      const text = await vscode.window.showInputBox({
        title: "AI Orchestrator: Submit Prompt",
        prompt: "Enter a coding prompt to route into an orchestration task."
      });
      if (!text?.trim()) {
        return;
      }

      await router.submitPrompt(text);
      await workerManager.startEligibleTasks();
    }),
    vscode.commands.registerCommand("aiOrchestrator.clearCompleted", async () => {
      await store.clearCompleted();
    }),
    vscode.commands.registerCommand("aiOrchestrator.cancelTask", async () => {
      const task = await vscode.window.showQuickPick(
        store
          .getTasks()
          .filter((candidate) => !["completed", "failed"].includes(candidate.status))
          .map((candidate) => ({
            label: candidate.title,
            description: candidate.status,
            taskId: candidate.id
          })),
        { title: "Cancel AI Orchestrator Task" }
      );

      if (task) {
        await workerManager.cancelTask(task.taskId);
      }
    })
  );

  void workerManager.startEligibleTasks();
  output.appendLine("AI Orchestrator activated with mock classifier and mock worker.");
}

export function deactivate(): void {
  // Extension host shutdown handles in-memory timers. Real agent workers should
  // persist checkpoints here before process exit.
}
