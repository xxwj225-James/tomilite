export interface GuardPromptContext {
  unsavedNote: boolean;
  noteEditorOpen: boolean;
  taskEditorOpen: boolean;
  newTaskFormOpen: boolean;
  reportEditorOpen: boolean;
  notesPanelOpen: boolean;
  tasksPanelOpen: boolean;
}

export function buildGuardPrompt(message: string, context: GuardPromptContext): string {
  const panelContext = context.unsavedNote ? 'New note form OPEN'
    : context.noteEditorOpen ? 'Note editor OPEN'
    : context.taskEditorOpen ? 'Task editor OPEN'
    : context.newTaskFormOpen ? 'New task form OPEN'
    : context.reportEditorOpen ? 'Report editor OPEN'
    : context.notesPanelOpen ? 'Notes list OPEN'
    : context.tasksPanelOpen ? 'Tasks panel OPEN'
    : 'No panel open';

  return `This is an INTERNAL routing step. Your output will be passed to another model as a system instruction — it will NOT be shown to the user. Output a JSON object with "intent" (create_task | create_note | edit_note | task_action | general_chat), "instruction" (the exact tool the main model should call), and "webSearch" (true only if the user is asking about recent events, latest news, current information, or anything requiring up-to-date web data. For general knowledge, facts, or how-to questions, use false).

Valid create_issue types (ONLY these 3):
- task — general work items, todos, chores (DEFAULT: use when unsure)
- bug — defects, errors, crashes
- story — features, enhancements, user-facing improvements
If the user says "Feature", use type "story". NEVER invent types like "feature" or "epic".

Examples:
- "create a login bug" → {"intent":"create_task","instruction":"Call create_issue with title 'login bug' type 'bug'."}
- "write an API doc note" → {"intent":"create_note","instruction":"Call create_note with the content."}
- "translate this note to English (note editor open)" (note editor open) → {"intent":"edit_note","instruction":"Use suggest_note_edit."}
- "why X does not work" (question about behavior) → {"intent":"general_chat","instruction":"Answer the question directly. Do NOT create a task."}
- "what is the status of TL-3" → {"intent":"task_action","instruction":"Use list_issues or get_stats."}
- "what is the weather today" → {"intent":"general_chat","instruction":"Respond naturally."}

Context: ${panelContext}

User message: ${message.substring(0, 2000)}

JSON:`;
}
