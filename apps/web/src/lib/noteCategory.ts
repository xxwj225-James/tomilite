import { t, type I18NKey } from '@/lib/i18n';

// ═══ Note categories, labelled ═══
//
// One table, because two screens were labelling the same column two ways. The map card had
// this record; the notes list had an inline `category === 'chat' ? … : category` and
// therefore printed the raw value — in English, untranslated — for everything the editor's
// picker does not offer. That was already visible for `chat` before the harvest feature
// existed; `task` / `report` / `meeting` would have made it obvious, since the same note
// would read Chinese on the map and `task` in the list.
//
// Membership here is not a whitelist. A category outside this table is shown exactly as
// stored, because the agent writes free-form ones and inventing a label for a value this
// app did not choose would be worse than showing the user what is in the column.

/** The categories this app names. Anything else falls through to its own value. */
export const CATEGORY_KEYS: Record<string, I18NKey> = {
  general: 'notes.general',
  architecture: 'notes.architecture',
  api_docs: 'notes.apiDocs',
  runbook: 'notes.runbook',
  chat: 'notes.categoryChat',
  // The harvest's three. `task_distill` and its siblings are *sources*, not categories —
  // they live in `KnowledgePage.source` — so the category column stays these three values.
  task: 'notes.categoryTask',
  report: 'notes.categoryReport',
  meeting: 'notes.categoryMeeting',
};

/** The label for a category, translated when this app named it and verbatim when it did not. */
export function categoryLabel(category: string, lang: string): string {
  const key = CATEGORY_KEYS[category];
  if (key) return t(key, lang);
  return category || t('notes.general', lang);
}

/**
 * The provenance badge for a note, or null for no badge.
 *
 * Only imports get one. The list used to badge *any* non-empty `source`, which was already
 * wrong for `chat_distill` — a chat summary is written here, from the user's own
 * conversation, and calling it "imported" says it came from somewhere else and is therefore
 * not theirs. The harvest's three sources would have made the same claim about a finished
 * task of the user's own. Their origin is not hidden: it is the category column, which says
 * "task" / "report" / "meeting" in the reader's language.
 */
export function sourceBadgeKey(source: string | null | undefined): I18NKey | null {
  return source?.startsWith('import:') ? 'notes.imported' : null;
}
