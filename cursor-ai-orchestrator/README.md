# AI Orchestrator

A lightweight VS Code/Cursor extension MVP for routing concurrent coding prompts into independent tasks or safe queues.

## Development

```bash
npm install
npm run compile
```

Open this folder in VS Code or Cursor, press `F5`, and run the extension in the Extension Development Host. Open the Activity Bar item named **AI Orchestrator** or run **AI Orchestrator: Open Panel**.

## Commands

- `AI Orchestrator: Open Panel`
- `AI Orchestrator: Submit Prompt`
- `AI Orchestrator: Clear Completed Tasks`
- `AI Orchestrator: Cancel Task`

## Replacing the mock worker

`src/workers/AgentWorker.ts` defines the worker contract and `src/workers/MockWorker.ts` provides the MVP simulation. Replace the `new MockWorker()` construction in `src/extension.ts` with a real implementation that reads workspace files, proposes edits, applies edits through the VS Code workspace API, and optionally runs commands when enabled. Cursor SDK, MCP, or a separate agent runner can live behind the same `AgentWorker` interface.

## Replacing the mock classifier

`src/orchestrator/ClassifierService.ts` exposes the `ClassifierService` interface. If `aiOrchestrator.llm.endpoint` is configured, the extension uses `LlmClassifierService`; otherwise it uses `MockClassifierService`. Point the endpoint at any model gateway that accepts the supplied system prompt and context and returns the strict JSON `RoutingDecision` schema.
