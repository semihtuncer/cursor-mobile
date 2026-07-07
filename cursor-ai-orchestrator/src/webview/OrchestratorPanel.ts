import * as vscode from "vscode";
import * as fs from "fs";
import { TaskRouter } from "../orchestrator/TaskRouter";
import { TaskStore } from "../orchestrator/TaskStore";
import { WorkerManager } from "../orchestrator/WorkerManager";

type WebviewMessage =
  | { type: "ready" }
  | { type: "submitPrompt"; text: string }
  | { type: "clearCompleted" }
  | { type: "cancelTask"; taskId: string }
  | { type: "pauseTask"; taskId: string }
  | { type: "resumeTask"; taskId: string }
  | { type: "reassignPrompt"; promptId: string; fromTaskId: string; toTaskId: string };

export class OrchestratorPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "aiOrchestrator.panel";

  private view?: vscode.WebviewView;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: TaskStore,
    private readonly router: TaskRouter,
    private readonly workerManager: WorkerManager
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "src", "webview", "ui")]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.handleMessage(message);
    });
    this.refresh();
  }

  public refresh(): void {
    void this.view?.webview.postMessage({
      type: "state",
      snapshot: this.store.getSnapshot()
    });
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.refresh();
        return;
      case "submitPrompt": {
        if (!message.text.trim()) {
          return;
        }
        await this.router.submitPrompt(message.text);
        await this.workerManager.startEligibleTasks();
        this.refresh();
        return;
      }
      case "clearCompleted":
        await this.store.clearCompleted();
        this.refresh();
        return;
      case "cancelTask":
        await this.workerManager.cancelTask(message.taskId);
        this.refresh();
        return;
      case "pauseTask":
        await this.workerManager.pauseTask(message.taskId);
        this.refresh();
        return;
      case "resumeTask":
        await this.workerManager.resumeTask(message.taskId);
        this.refresh();
        return;
      case "reassignPrompt":
        await this.store.reassignQueuedPrompt(message.promptId, message.fromTaskId, message.toTaskId);
        this.refresh();
        return;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const htmlUri = vscode.Uri.joinPath(this.extensionUri, "src", "webview", "ui", "index.html");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "src", "webview", "ui", "main.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "src", "webview", "ui", "styles.css"));
    const nonce = getNonce();
    const html = fs.readFileSync(htmlUri.fsPath, "utf8");

    return html
      .replaceAll("${cspSource}", webview.cspSource)
      .replaceAll("${scriptUri}", scriptUri.toString())
      .replaceAll("${styleUri}", styleUri.toString())
      .replaceAll("${nonce}", nonce);
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
