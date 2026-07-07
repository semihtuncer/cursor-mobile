import * as vscode from "vscode";
import { ClassifierContext, RoutingDecision, Task } from "./types";

export interface ClassifierService {
  classify(context: ClassifierContext): Promise<RoutingDecision>;
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a coding task router.

You receive:

1. A new user prompt
2. Active running tasks
3. Queued tasks
4. Completed task summaries
5. Known locked files
6. Recent git diff files
7. Project structure summary

Your job is to decide whether the new prompt should start a new task, be appended to an existing task, be queued behind a conflicting task, or require clarification.

A prompt is related to an existing task if it likely affects the same feature, same files, same bug, same UI flow, same data model, same backend endpoint, same Unity script, same database rule, same build system, or same implementation context.

A prompt should become a new task if it can likely be worked on independently without touching the same files or depending on the result of an active task.

A prompt should be queued behind a conflicting task if it is conceptually different but likely needs to edit files currently locked by another running task.

Ask clarification only when the prompt is too vague or when routing confidence is below 0.55.

Return strict JSON only with this schema:

{
  "action": "create_new_task | append_to_existing_task | queue_behind_conflicting_task | ask_user_clarification",
  "targetTaskId": "string or undefined",
  "confidence": 0.0,
  "reason": "short reason",
  "predictedFiles": ["array of likely files"],
  "featureAreas": ["array of areas"],
  "clarificationQuestion": "only if needed"
}`;

const ACTIONS = new Set<RoutingDecision["action"]>([
  "create_new_task",
  "append_to_existing_task",
  "queue_behind_conflicting_task",
  "ask_user_clarification"
]);

export class MockClassifierService implements ClassifierService {
  public async classify(context: ClassifierContext): Promise<RoutingDecision> {
    const promptText = context.newPrompt.text;
    const predictedFiles = this.extractLikelyFiles(promptText, context.projectStructure);
    const featureAreas = this.extractFeatureAreas(promptText, predictedFiles);
    const candidates = [...context.activeTasks, ...context.queuedTasks];
    const bestMatch = this.findBestTaskMatch(promptText, predictedFiles, featureAreas, candidates);
    const lockConflict = this.findLockConflict(predictedFiles, context);

    if (promptText.trim().split(/\s+/).length < 3) {
      return {
        action: "ask_user_clarification",
        confidence: 0.4,
        reason: "Prompt is too short to route safely.",
        predictedFiles,
        featureAreas,
        clarificationQuestion: "Which feature or files should this prompt affect?"
      };
    }

    if (bestMatch && bestMatch.score >= 0.55) {
      return {
        action: "append_to_existing_task",
        targetTaskId: bestMatch.task.id,
        confidence: Math.min(0.95, bestMatch.score),
        reason: `Related to "${bestMatch.task.title}" by feature or file overlap.`,
        predictedFiles,
        featureAreas
      };
    }

    if (lockConflict) {
      return {
        action: "queue_behind_conflicting_task",
        targetTaskId: lockConflict.taskId,
        confidence: 0.76,
        reason: `Likely touches locked file ${lockConflict.filePath}.`,
        predictedFiles,
        featureAreas
      };
    }

    return {
      action: "create_new_task",
      confidence: predictedFiles.length > 0 || featureAreas.length > 0 ? 0.78 : 0.6,
      reason: "No strong relationship or file conflict with active tasks was detected.",
      predictedFiles,
      featureAreas
    };
  }

  private extractLikelyFiles(promptText: string, projectStructure: string[]): string[] {
    const explicitPaths = promptText.match(/(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|css|html|cs|py|go|rs|java|kt|swift|md)/g) ?? [];
    const lowerPrompt = promptText.toLowerCase();
    const structureMatches = projectStructure.filter((path) => {
      const fileName = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
      const stem = fileName.replace(/\.[^.]+$/, "");
      return stem.length > 2 && lowerPrompt.includes(stem);
    });

    return [...new Set([...explicitPaths, ...structureMatches])].slice(0, 12);
  }

  private extractFeatureAreas(promptText: string, predictedFiles: string[]): string[] {
    const lowerPrompt = promptText.toLowerCase();
    const keywordAreas: Record<string, string[]> = {
      auth: ["auth", "login", "signup", "firebase", "user", "admin"],
      ui: ["ui", "button", "panel", "sidebar", "webview", "page", "screen", "popup"],
      data: ["database", "model", "schema", "json", "api", "endpoint"],
      build: ["build", "compile", "test", "lint", "package", "config"],
      unity: ["unity", "asset", "script", "scene", "prefab"]
    };

    const areas = Object.entries(keywordAreas)
      .filter(([, keywords]) => keywords.some((keyword) => lowerPrompt.includes(keyword)))
      .map(([area]) => area);

    for (const file of predictedFiles) {
      const folder = file.split("/").find((part) => part && !part.includes("."));
      if (folder) {
        areas.push(folder.toLowerCase());
      }
    }

    return [...new Set(areas)].slice(0, 8);
  }

  private findBestTaskMatch(
    promptText: string,
    predictedFiles: string[],
    featureAreas: string[],
    tasks: Task[]
  ): { task: Task; score: number } | undefined {
    const promptWords = this.significantWords(promptText);
    let best: { task: Task; score: number } | undefined;

    for (const task of tasks) {
      const taskWords = this.significantWords(`${task.title} ${task.summary} ${task.prompts.map((prompt) => prompt.text).join(" ")}`);
      const wordScore = this.jaccard(promptWords, taskWords);
      const fileScore = this.overlapScore(predictedFiles, [...task.predictedFiles, ...task.filesTouched]);
      const areaScore = this.overlapScore(featureAreas, task.featureAreas);
      const score = Math.max(wordScore, fileScore, areaScore);

      if (!best || score > best.score) {
        best = { task, score };
      }
    }

    return best;
  }

  private findLockConflict(predictedFiles: string[], context: ClassifierContext): { filePath: string; taskId: string } | undefined {
    for (const filePath of predictedFiles) {
      const lock = context.lockedFiles.find((candidate) => candidate.filePath === filePath);
      if (lock) {
        return { filePath: lock.filePath, taskId: lock.taskId };
      }
    }

    return undefined;
  }

  private significantWords(text: string): string[] {
    return [...new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].filter(
      (word) => !["the", "and", "for", "with", "this", "that", "from", "into", "task"].includes(word)
    );
  }

  private jaccard(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) {
      return 0;
    }
    return this.overlapScore(left, right);
  }

  private overlapScore(left: string[], right: string[]): number {
    if (left.length === 0 || right.length === 0) {
      return 0;
    }

    const rightSet = new Set(right.map((item) => item.toLowerCase()));
    const overlap = left.filter((item) => rightSet.has(item.toLowerCase())).length;
    return overlap / Math.max(left.length, right.length);
  }
}

export class LlmClassifierService implements ClassifierService {
  public async classify(context: ClassifierContext): Promise<RoutingDecision> {
    const config = vscode.workspace.getConfiguration("aiOrchestrator.llm");
    const endpoint = config.get<string>("endpoint")?.trim();
    const apiKey = config.get<string>("apiKey")?.trim();

    if (!endpoint) {
      throw new Error("LLM classifier endpoint is not configured.");
    }

    // A future Cursor SDK, MCP tool, or hosted model gateway can be integrated here.
    // Keep the response contract strict JSON so callers can swap providers safely.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        system: CLASSIFIER_SYSTEM_PROMPT,
        input: context
      })
    });

    if (!response.ok) {
      throw new Error(`LLM classifier request failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    return parseRoutingDecision(text);
  }
}

export function createClassifierService(): ClassifierService {
  const endpoint = vscode.workspace.getConfiguration("aiOrchestrator.llm").get<string>("endpoint")?.trim();
  return endpoint ? new LlmClassifierService() : new MockClassifierService();
}

function parseRoutingDecision(rawResponse: string): RoutingDecision {
  const parsed = JSON.parse(rawResponse) as Partial<RoutingDecision>;
  if (!parsed.action || !ACTIONS.has(parsed.action)) {
    throw new Error("Classifier returned an invalid routing action.");
  }

  return {
    action: parsed.action,
    targetTaskId: parsed.targetTaskId,
    confidence: clampConfidence(parsed.confidence),
    reason: parsed.reason ?? "Classifier did not provide a reason.",
    predictedFiles: Array.isArray(parsed.predictedFiles) ? parsed.predictedFiles : [],
    featureAreas: Array.isArray(parsed.featureAreas) ? parsed.featureAreas : [],
    clarificationQuestion: parsed.clarificationQuestion
  };
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
