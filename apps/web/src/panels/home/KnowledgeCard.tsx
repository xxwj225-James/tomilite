import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  type KnowledgeMapResponse,
  type KnowledgeNeighbors,
  type MapLink,
  type MapNode,
  type TopicMutationResult,
} from '@/lib/api';
import { t, type I18NKey } from '@/lib/i18n';
import { categoryLabel as labelFor } from '@/lib/noteCategory';
import { useLang } from '@/stores/useLang';
import { useCelebrationStore } from '@/stores/celebrationStore';
import { formatDbDateTime } from '@/lib/dbTime';
import { LANGS_FULL } from '@/lib/constants';
import { ConfirmDialog } from '@tomilite/shared-ui/components/ConfirmDialog';
import { DistillDialog } from './DistillDialog';
import { TopicMergeDialog } from './TopicMergeDialog';

// ═══ Knowledge map ═══
//
// A tree of the user's notes on the left, one note's card on the right. Nothing here is
// written by a model: the topic names are the model's, every leaf is a real note, and the
// connections are `[[links]]` out of the notes' own text plus their nearest neighbours in
// embedding space. That is the whole reason this replaced the old card — which rendered a
// model's Markdown essay about the *titles* of recent items, with no way to reach any of
// them (`dangerouslySetInnerHTML` on generated prose, and it went away with that card).
//
// Tasks, report months and meetings reach this map too, but as *notes*: the harvest dialog
// (`DistillDialog`) folds a finished task, a month of reports and a meeting's decisions into
// the user's own library, where they get a place in the tree, links and neighbours like any
// other note. They cannot be leaves themselves — a leaf is a note id — so the answer is to
// make them notes rather than to teach the tree a second kind of leaf. The strip of task
// counts that used to sit under the tree is gone: it described a project, not any knowledge
// in it.
//
// Two rules the code below exists to keep:
//
//   **Reading is free; organizing costs money.** `load()` is the only thing that runs on
//     panel activation and it never calls a model. `organize()` is bound to a button whose
//     label says what it does. The previous version force-regenerated from a `[lang]` effect
//     and a two-hour timer, so simply opening Home spent the user's tokens.
//
//   **Every empty state says why it is empty.** "No neighbours" and "this machine has no
//     vectors" look the same on screen and need opposite responses, so the semantic section
//     reports the model's status, its last error, and offers the retry. Likewise the tree
//     distinguishes "not organized yet" from "no notes at all".
//
//   **A topic name the model got wrong can be fixed without asking the model again.** The
//     「⋯」 menu on a topic row offers rename / merge / delete, and all three are local: no
//     model, no tokens, no note written or removed. This exists because a name is sticky by
//     design — `buildPrompt` hands the existing names back and asks for them to be reused
//     verbatim so the map does not reshuffle on every run — which left a name like「知识地图
//     与目录」(a bucket the model named after the only two words its two leaves shared)
//     permanent. See `docs/knowledge-map.md` §6 「Fixing a topic」.
//
//     These rows address the server by *position*, so there are two paths in this file and
//     they are not interchangeable: `path` (`n0/1/2`) is a render key for `collapsed` and
//     counts the synthesized 「新笔记」 row, `topicPath` (`[2, 0]`) indexes `map.topics`,
//     which is all the server has ever seen. Passing one where the other belongs renames
//     the topic above the one that was clicked.

type EmbedInfo = {
  status: 'ready' | 'absent' | 'failed' | 'downloading' | 'disabled';
  pending: number;
  embedded: number;
  lastError: string | null;
};

/**
 * Walk an index path. Used to read a topic back out of the map the server just returned —
 * the only way to know what a rename actually stored, since the name that was typed is not
 * the name that was kept (`**x**` is stored as `x`).
 */
function nodeAt(nodes: MapNode[], path: number[]): MapNode | null {
  let list = nodes;
  let node: MapNode | null = null;
  for (const i of path) {
    node = list[i] ?? null;
    if (!node) return null;
    list = node.children ?? [];
  }
  return node;
}

/**
 * Refusal code → sentence. A table rather than `` t(`kmap.topic.fail.${reason}`) `` because
 * `reason` is an arbitrary string on the wire, so that template literal is not a key the type
 * checker can accept — the same reason `DistillDialog` keeps `WHY_KEYS`.
 */
const TOPIC_FAIL_KEYS: Record<string, I18NKey> = {
  'not-found': 'kmap.topic.fail.not-found',
  'tree-changed': 'kmap.topic.fail.tree-changed',
  'not-a-topic': 'kmap.topic.fail.not-a-topic',
  'empty-name': 'kmap.topic.fail.empty-name',
  'same-node': 'kmap.topic.fail.same-node',
  'into-descendant': 'kmap.topic.fail.into-descendant',
  'no-target': 'kmap.topic.fail.no-target',
  'lost-notes': 'kmap.topic.fail.lost-notes',
};

/** How wide the 「⋯」 popover is drawn — used only to keep it on screen. */
const TOPIC_MENU_W = 132;

export function KnowledgeCard({ active = true }: { active?: boolean }) {
  const lang = useLang();

  const [map, setMap] = useState<KnowledgeMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [organizing, setOrganizing] = useState(false);
  /** One line about the last organize run. Cleared by the next one. */
  const [notice, setNotice] = useState<string | null>(null);
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** The tree's own scroller, and the leaf the selection is currently on. */
  const treeRef = useRef<HTMLDivElement | null>(null);
  const leafRef = useRef<HTMLButtonElement | null>(null);
  /** Title of the ambiguous link whose candidate list is open. */
  const [ambOpen, setAmbOpen] = useState<string | null>(null);

  const [nb, setNb] = useState<KnowledgeNeighbors | null>(null);
  const [nbLoading, setNbLoading] = useState(false);
  const [nbFailed, setNbFailed] = useState(false);
  const [embed, setEmbed] = useState<EmbedInfo | null>(null);
  const [reembedding, setReembedding] = useState(false);

  /** The open 「⋯」 menu: the row's render path (to match it back to a row), its index path
   *  (what the server is addressed by), and where to draw the popover. */
  const [menu, setMenu] = useState<{ key: string; path: number[]; x: number; y: number } | null>(null);
  /** The row being renamed in place. Renaming never moves a row, so no keys are cleared. */
  const [renaming, setRenaming] = useState<{ key: string; path: number[] } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /** Set the moment a rename resolves, so the input's unmount-blur cannot submit a second
   *  time — Escape and Enter both leave the field, and blur follows both. */
  const renameResolved = useRef(false);
  /** The topic whose delete prompt is up, with the numbers that prompt has to state. */
  const [deleting, setDeleting] = useState<{ path: number[]; name: string; notes: number; toRoot: boolean } | null>(
    null,
  );
  /** The topic whose merge picker is up. */
  const [merging, setMerging] = useState<{ path: number[]; name: string } | null>(null);
  /** One topic edit at a time; also disables the dialogs' own buttons while a call is out. */
  const [topicBusy, setTopicBusy] = useState(false);

  // The popover floats over the panel, so a menu left open while the user works elsewhere
  // reads as stuck. "Outside" is the popover and the trigger — both matched with `closest`
  // because the popover is portalled to `body` and is not a descendant of the row.
  //
  // It also closes on scroll and resize. A fixed-position popover has no relationship to a
  // scrolling row, so the alternative is a menu drifting away from the topic it belongs to.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest('.kmap-tree-menu, .kmap-tree-more')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      // Leave the Escape to the search palette while it is open. It cannot stop this
      // listener for us: stopImmediatePropagation only orders listeners on one node, and
      // both live on `window`. So the palette publishes a flag and we read it.
      if ((window as any).__tl_paletteOpen) return;
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = await api.knowledge.map(lang);
      setMap(m);
      setLoadFailed(false);
      // `m.notes` is every note in the library, on every return path of `buildMap`, not just
      // the ones the tree placed — the count here and the tree's own counts are the same
      // number. Deliberately not `m.loose`, which drops to zero the moment the user presses
      // organize and would therefore make the ladder non-monotonic.
      useCelebrationStore.getState().observe('notes', Object.keys(m.notes).length);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [lang]);

  // The panel is kept alive after its first visit, so `active` — not mount — is what
  // tells this card to re-read. Without it the tree would show whenever Home was last
  // opened, which for a map of notes is the wrong kind of stale.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  // Following a link chip moves the card to another note, and the tree stayed where it was —
  // so the one thing that tells you where you just landed was off screen. This is the path
  // that matters: the note was reached from somewhere else, and the tree has to catch up.
  //
  // Not `scrollIntoView({ block: 'nearest' })`: that walks every scrollable ancestor, so it
  // scrolls the home panel too. The tree has its own scroller and only that one should move,
  // by rect delta, which does not care which ancestor happens to be positioned.
  useEffect(() => {
    const box = treeRef.current;
    const el = leafRef.current;
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.top < b.top) box.scrollTop += e.top - b.top;
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom;
  }, [selected, map]);

  // Neighbours are per-note, so they are read when a note is picked rather than with the
  // map: `map` deliberately carries no vectors, and scoring the whole corpus on every
  // panel activation would be paid for by users who never open a card.
  useEffect(() => {
    if (!selected) {
      setNb(null);
      setNbFailed(false);
      return;
    }
    let cancelled = false;
    setNbLoading(true);
    setNb(null);
    setNbFailed(false);
    api.knowledge
      .neighbors(selected)
      .then((r) => {
        if (!cancelled) setNb(r);
      })
      .catch(() => {
        // A transport failure is not "this note has no vector" — saying so would send the
        // user looking for a model problem that may not exist.
        if (!cancelled) setNbFailed(true);
      })
      .finally(() => {
        if (!cancelled) setNbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Only asked for when there is nothing to show, because its whole job is to explain that.
  useEffect(() => {
    if (!nb || nb.ok || nbFailed) return;
    let cancelled = false;
    api.system
      .embedStatus()
      .then((s) => {
        if (!cancelled) setEmbed(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [nb, nbFailed]);

  // Shared with the notes list (`lib/noteCategory.ts`), not a local copy: the two screens
  // label the same column, and a category named here but not there printed as a raw English
  // value in the list while the map said Chinese.
  const categoryLabel = (cat: string) => labelFor(cat, lang);

  const nodeLabel = (n: MapNode) => {
    if (n.kind === 'unfiled') return t('kmap.unfiled', lang);
    if (n.kind === 'new') return t('kmap.newNotes', lang);
    if (n.kind === 'category') return categoryLabel(n.name);
    return n.name || t('kmap.unfiled', lang);
  };

  const countNotes = (n: MapNode): number =>
    n.notes.length + (n.children ?? []).reduce((sum, c) => sum + countNotes(c), 0);

  // Notes added after the tree was built are synthesized into a node rather than left out.
  // They would otherwise be invisible until the user pressed a button, and invisible reads
  // as lost. This is also why the node goes first: it must not be below the fold.
  const treeNodes = useMemo<MapNode[]>(() => {
    if (!map) return [];
    const nodes = [...map.topics];
    if (map.loose.length) nodes.unshift({ name: '', kind: 'new', notes: map.loose, children: [] });
    return nodes;
  }, [map]);

  const toggle = (key: string, isCollapsed: boolean) => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }));

  const renderLeaf = (id: string, depth: number): ReactNode => {
    const n = map?.notes[id];
    if (!n) return null;
    const on = selected === id;
    return (
      <button
        key={id}
        type="button"
        ref={on ? leafRef : undefined}
        className={`kmap-tree-leaf${on ? ' kmap-tree-leaf--on' : ''}`}
        style={{ paddingLeft: 6 + depth * 10 }}
        title={n.title}
        onClick={() => setSelected(id)}
      >
        {n.title || t('notes.untitled', lang)}
      </button>
    );
  };

  const renderNode = (node: MapNode, path: string, depth: number, topicPath: number[] | null): ReactNode => {
    const kids = node.children ?? [];
    const isCollapsed = collapsed[path] ?? false;
    const open = !isCollapsed;
    // Anything with a row under it can be folded — including a node whose only rows are
    // leaves. The rule used to be `kids.length > 0`, which left a topic with a dozen notes
    // and no sub-topics permanently open: exactly the node with the most to hide.
    const foldable = kids.length > 0 || node.notes.length > 0;
    const isRenaming = renaming?.key === path;

    const rowContent = (
      <>
        {foldable && <span className={`kmap-tree-caret${open ? ' kmap-tree-caret--open' : ''}`}>▶</span>}
        {isRenaming ? (
          // In place, so the name being replaced stays where it was on screen. Not nested in
          // the row button below — an `input` inside a `button` is not valid, and it would
          // fold the row on every click. The row renders as the static variant while editing,
          // which is also why every click on the field stops there.
          <input
            className="form-input kmap-tree-rename"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(node);
              if (e.key === 'Escape') cancelRename();
            }}
            onBlur={() => commitRename(node)}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span className="kmap-tree-label">{nodeLabel(node)}</span>
        )}
        <span className="kmap-tree-count">{countNotes(node)}</span>
      </>
    );
    // A name cut off by the ellipsis has to be recoverable, and the leaves already say so
    // with `title` — the topic rows were the asymmetric half.
    const full = `${nodeLabel(node)} · ${countNotes(node)}`;
    const row =
      foldable && !isRenaming ? (
        <button
          type="button"
          className="kmap-tree-row"
          style={{ paddingLeft: 6 + depth * 8 }}
          title={full}
          onClick={() => {
            // While this row's own menu is open the click belongs to the menu, and folding
            // the row out from under it is not what was asked for.
            if (menu?.key === path) {
              setMenu(null);
              return;
            }
            toggle(path, isCollapsed);
          }}
        >
          {rowContent}
        </button>
      ) : (
        <div className="kmap-tree-row kmap-tree-row--static" style={{ paddingLeft: 6 + depth * 8 }} title={full}>
          {rowContent}
        </div>
      );

    // `category` and `unfiled` rows are not the user's to rename: those names are the values
    // of `KnowledgePage.category` (and are translated again by `noteCategory.labelFor` on the
    // way out), so renaming one would be a lie that the next fallback write erases anyway.
    // Leaves and the synthesized 「新笔记」 row have no index path at all.
    let moreButton: ReactNode = null;
    if (topicPath !== null && node.kind === 'topic' && !isRenaming) {
      const indexPath = topicPath;
      moreButton = (
        <button
          type="button"
          className={`kmap-tree-more${menu?.key === path ? ' kmap-tree-more--open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menu?.key === path}
          aria-label={t('kmap.topic.more', lang)}
          title={t('kmap.topic.more', lang)}
          onClick={(e) => openMenu(e, indexPath, path)}
        >
          ⋯
        </button>
      );
    }

    return (
      <div key={path}>
        {moreButton ? (
          // A sibling of the row rather than a child: the row is already a button.
          <div className="kmap-tree-item">
            {row}
            {moreButton}
          </div>
        ) : (
          row
        )}
        {open && node.notes.map((id) => renderLeaf(id, depth + 1))}
        {open &&
          kids.map((child, i) =>
            renderNode(child, `${path}/${i}`, depth + 1, topicPath === null ? null : [...topicPath, i]),
          )}
      </div>
    );
  };

  /** Every note carrying this title. Used to offer a choice instead of picking one. */
  const candidatesFor = (title: string) => {
    if (!map) return [];
    const key = title.trim().toLowerCase();
    return Object.values(map.notes).filter((n) => n.title.trim().toLowerCase() === key);
  };

  const openInNotesPanel = async (id: string) => {
    // The full row is fetched here rather than trusting the excerpt this card holds: the
    // panel's own handler falls back to whatever is in the event when its lookup fails, and
    // an excerpt silently standing in for a note body would be saved back over it.
    let full: { title?: string; category?: string; content?: string } | null = null;
    let failed = false;
    try {
      full = await api.wiki.byId(id);
    } catch {
      failed = true;
    }
    if (!full) {
      // A missing note and an unreachable API are different problems, and "deleted" is the
      // wrong thing to say about the second one.
      setNotice(failed ? t('kmap.loadFailed', lang) : t('links.missing', lang));
      return;
    }
    const detail = { id, title: full.title ?? '', category: full.category ?? 'general', content: full.content ?? '', editMode: false };
    // Three steps, all of them necessary: the global stash covers the case where the notes
    // panel has never been mounted (its listener does not exist yet), `tl-navigate` switches
    // the panel, and the event covers the case where it is already mounted and will not
    // re-run its pending-selection effect.
    (window as any).__tl_pendingNoteSelect = detail;
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: 'notes' }));
    window.dispatchEvent(new CustomEvent('tl-select-note', { detail }));
  };

  /** Machine code → sentence. The codes are diagnostics, not text a user can act on. */
  const describeFailure = (reason: string) => {
    if (reason === 'no-llm') return t('kmap.degraded.no-llm', lang);
    if (reason === 'too-many-notes') return t('kmap.detail.tooManyNotes', lang);
    if (reason === 'truncated') return t('kmap.detail.truncated', lang);
    if (reason === 'llm-error') return t('kmap.detail.llmError', lang);
    if (reason === 'no-notes') return t('kmap.needNotes', lang);
    // parse / shape / index-range / coercion / coverage all mean the same thing to a user:
    // the model answered, and the answer could not be trusted.
    return t('kmap.detail.malformed', lang);
  };

  const retryEmbed = async () => {
    setReembedding(true);
    setNotice(null);
    try {
      const r = await api.system.reembed();
      setNotice(t('kmap.embed.queued', lang, { n: r.queued }));
      setEmbed(await api.system.embedStatus());
    } catch {
      setNotice(t('kmap.embedFailed', lang));
    } finally {
      setReembedding(false);
    }
  };

  const organize = async () => {
    setOrganizing(true);
    setNotice(null);
    try {
      const r = await api.knowledge.organize(lang);
      setMap(r.map);
      // Collapsed state is keyed by position path (`n0/1/2`), and after a re-organize the
      // same path is a different topic — so any fold that is kept would be folding the wrong
      // node. Cleared unless the run failed *and* left the old tree in place (`kept`), where
      // the paths still name what they named before.
      if (r.ok || !r.kept) setCollapsed({});
      if (!r.ok) {
        // Reported from `reason` rather than from the returned map: a failed run that kept
        // the previous tree leaves that tree's own `degraded` value alone, so reading the
        // banner off the map would show nothing at all after a button press.
        setNotice(describeFailure(r.reason ?? ''));
      }
    } catch {
      setNotice(t('kmap.detail.llmError', lang));
    } finally {
      setOrganizing(false);
    }
  };

  // ── Handing the tree back to the user: rename / merge / delete ──────────────────

  /** Refusal code → sentence. Falls back to the transport line for a code this build has no
   *  line for, which is the only thing left to say about it. */
  const describeTopicFailure = (reason: string) => {
    const key = TOPIC_FAIL_KEYS[reason];
    return key ? t(key, lang) : t('kmap.topic.failed', lang);
  };

  /** The three edits differ only in the call they make and the sentence they end with. */
  const runTopicEdit = async (
    call: () => Promise<TopicMutationResult>,
    ok: (r: TopicMutationResult) => string,
    after?: () => void,
  ) => {
    setTopicBusy(true);
    setNotice(null);
    try {
      const r = await call();
      // The map comes back on the refusal paths too, and a refusal describes the tree the
      // *server* holds — which may not be the one on screen. So the screen is put back on the
      // server's tree either way, exactly as `organize` does.
      setMap(r.map);
      setNotice(r.ok ? ok(r) : describeTopicFailure(r.reason ?? ''));
      if (r.ok) after?.();
    } catch {
      setNotice(t('kmap.topic.failed', lang));
    } finally {
      setTopicBusy(false);
    }
  };

  const openMenu = (e: React.MouseEvent, path: number[], key: string) => {
    e.stopPropagation();
    if (menu?.key === key) {
      setMenu(null);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      key,
      path,
      // Anchored to the trigger's right edge and clamped to the window, so a topic at the
      // bottom of the tree does not open its menu off the panel.
      x: Math.max(4, Math.min(r.right - TOPIC_MENU_W, window.innerWidth - TOPIC_MENU_W - 4)),
      y: r.bottom + 2,
    });
  };

  /** The menu's row, resolved from the menu's own path rather than from a captured node: a
   *  panel activation re-reads the map, and a captured node would be the old tree's. */
  const menuNode = menu && map ? nodeAt(map.topics, menu.path) : null;

  const startRename = () => {
    if (!menu || !menuNode) return;
    renameResolved.current = false;
    setRenameDraft(menuNode.name);
    setRenaming({ key: menu.key, path: menu.path });
    setMenu(null);
  };

  const startMerge = () => {
    if (!menu || !menuNode) return;
    setMenu(null);
    setMerging({ path: menu.path, name: menuNode.name });
  };

  const startDelete = () => {
    if (!menu || !menuNode) return;
    setMenu(null);
    setDeleting({
      path: menu.path,
      name: menuNode.name,
      // Only the deleted node's own notes are re-homed; its sub-topics move up intact.
      notes: menuNode.notes.length,
      // A top-level topic has no parent to hand its notes to, so they go to 「未归类」.
      toRoot: menu.path.length === 1,
    });
  };

  const cancelRename = () => {
    renameResolved.current = true;
    setRenaming(null);
    setRenameDraft('');
  };

  /**
   * Commit the in-place edit. `node.name` is the `expect` the server checks: the path is
   * positional, so a tree that moved under this card would otherwise rename whatever now
   * sits at that path.
   *
   * The path comes from the rename state rather than from the row that rendered the field,
   * so there is one source for it — the menu that opened the field is the only thing that
   * could have known which topic was clicked.
   */
  const commitRename = (node: MapNode) => {
    if (renameResolved.current) return;
    renameResolved.current = true;
    const path = renaming?.path;
    const name = renameDraft.trim();
    setRenaming(null);
    setRenameDraft('');
    // A blur with no field open, nothing typed, or nothing changed: no call. The server folds
    // `Foo ` to `Foo` and would write back an identical tree — a write nobody asked for.
    if (!path || !name || name === node.name) return;
    void runTopicEdit(
      () => api.knowledge.renameTopic(lang, path, node.name, name),
      // Read the name back out of the returned map rather than echoing what was typed: the
      // stored name is the sanitised one, and it is what the tree now shows.
      (r) => t('kmap.topic.renamed', lang, { name: nodeAt(r.map.topics, path)?.name ?? name }),
    );
  };

  const confirmDelete = () => {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    void runTopicEdit(
      () => api.knowledge.deleteTopic(lang, target.path, target.name),
      () => t('kmap.topic.deleted', lang, { name: target.name }),
      // The removal re-indexes everything after it, so a stored render path now names a
      // different row — the same argument as `organize`, and the same answer. Renaming does
      // not move a row, which is why that path does not clear folds.
      () => setCollapsed({}),
    );
  };

  const pickMerge = (intoPath: number[], intoExpect: string) => {
    const source = merging;
    if (!source) return;
    setMerging(null);
    void runTopicEdit(
      () => api.knowledge.mergeTopics(lang, source.path, source.name, intoPath, intoExpect),
      (r) => t('kmap.topic.merged', lang, { a: source.name, b: nodeAt(r.map.topics, intoPath)?.name ?? intoExpect }),
      () => setCollapsed({}),
    );
  };

  const degradedText = () => {
    if (!map?.degraded) return null;
    if (map.degraded === 'no-llm') return t('kmap.degraded.no-llm', lang);
    if (map.degraded === 'categories') return t('kmap.degraded.categories', lang);
    return t('kmap.degraded.invalid', lang);
  };

  const detailText = () => {
    const d = map?.detail;
    if (!d || d === 'no-llm') return null;
    if (d === 'too-many-notes') return t('kmap.detail.tooManyNotes', lang);
    if (d === 'truncated') return t('kmap.detail.truncated', lang);
    if (d === 'llm-error') return t('kmap.detail.llmError', lang);
    return t('kmap.detail.malformed', lang);
  };

  const note = selected && map ? map.notes[selected] ?? null : null;
  const edges = selected && map ? map.links[selected] ?? null : null;
  const noteCount = map ? Object.keys(map.notes).length : 0;

  const linkChip = (edge: MapLink, dir: 'out' | 'back') => {
    if (dir === 'back') {
      // A back-link's source is a concrete row, so it is never ambiguous and never broken.
      // The label is that note's title, not the text it wrote.
      const src = map?.notes[edge.from];
      if (!src) return null;
      return (
        <button key={`b${edge.from}${edge.raw}`} type="button" className="kmap-link" onClick={() => setSelected(edge.from)}>
          {src.title || t('notes.untitled', lang)}
        </button>
      );
    }
    if (edge.to === null) {
      return (
        <span key={edge.raw} className="kmap-link kmap-link--broken" title={t('kmap.brokenLink', lang)}>
          {edge.raw}
        </span>
      );
    }
    if (edge.matches > 1) {
      // Several notes share this title. Resolving silently to the newest is how a link
      // ends up pointing at the wrong note with nothing on screen to say so.
      return (
        <button
          key={edge.raw}
          type="button"
          className="kmap-link kmap-link--amb"
          title={t('kmap.sameTitle', lang, { n: edge.matches })}
          onClick={() => setAmbOpen(ambOpen === edge.title ? null : edge.title)}
        >
          {edge.title} ({edge.matches})
        </button>
      );
    }
    return (
      <button key={edge.raw} type="button" className="kmap-link" onClick={() => setSelected(edge.to)}>
        {edge.title}
      </button>
    );
  };

  const semanticBody = () => {
    // `nb === null` with no failure means the query is still in flight — checked explicitly
    // because otherwise the first paint of a newly selected note would claim "no vector".
    if (!nbFailed && (nbLoading || !nb)) return <div className="kmap-empty">{t('misc.loading', lang)}</div>;
    if (nb?.ok) {
      // The backend refuses to answer unless at least one peer has a vector, so an empty
      // list here would be a contract change rather than a normal outcome — reported as
      // "no peers" rather than as the links message, which would describe the wrong thing.
      if (!nb.items.length) return <div className="kmap-empty">{t('kmap.embed.noPeers', lang)}</div>;
      return (
        <>
          <div className="kmap-chips">
            {nb.items.map((x) => (
              <button key={x.id} type="button" className="kmap-link" onClick={() => setSelected(x.id)}>
                {x.title || t('notes.untitled', lang)}
              </button>
            ))}
          </div>
          {/* Said out loud because the numbers are not shown: this is an ordering, not a
              measure of relatedness. No threshold survived testing — see docs §6.4.1. */}
          <div className="kmap-empty" style={{ marginTop: 4 }}>
            {t('kmap.semanticHint', lang)}
          </div>
        </>
      );
    }

    let why = t('kmap.embed.noVector', lang);
    if (nbFailed) why = t('kmap.embedFailed', lang);
    else if (nb?.ok === false && nb.reason === 'note-missing') why = t('links.missing', lang);
    else if (embed?.status === 'disabled') why = t('kmap.embed.disabled', lang);
    else if (embed?.status === 'downloading') why = t('kmap.embed.downloading', lang);
    else if (embed?.status === 'failed') why = t('kmap.embed.failed', lang);
    else if (embed?.status === 'absent') why = t('kmap.embed.absent', lang);
    else if (nb?.ok === false && nb.reason === 'no-peers') why = t('kmap.embed.noPeers', lang);
    else if (nb?.ok === false && nb.reason === 'no-vector' && (embed?.pending ?? 0) > 0)
      why = t('kmap.embed.pending', lang, { n: embed?.pending ?? 0 });

    return (
      <>
        <div className="kmap-empty">{why}</div>
        {/* The file-level reason, unedited. It is the only thing that says whether the
            download failed or the runtime did, and this is a tool for developers. */}
        {embed?.lastError && (embed.status === 'failed' || embed.status === 'absent') && (
          <div className="kmap-empty" style={{ marginTop: 2, wordBreak: 'break-all' }}>
            {embed.lastError}
          </div>
        )}
        <button
          type="button"
          className="btn-ghost btn-xs"
          style={{ marginTop: 4 }}
          disabled={reembedding}
          onClick={() => void retryEmbed()}
        >
          {t('kmap.embed.retry', lang)}
        </button>
      </>
    );
  };

  // `stale` has been in this response since the map was first written — `mapKey` folds in the
  // note-id set *and* the language — and the card never rendered it. That is the whole of the
  // "switched language, pressed refresh, nothing happened" report: the refresh icon re-read a
  // tree whose topic names were generated in the old language, and nothing on screen said so.
  // There is no refresh icon any more; this label and the banner below are what replaced it.
  const staleNew = !!map && map.stale && map.loose.length > 0;
  // `needsOrganize` is in the guard because with no stored tree the response carries no
  // `lang` at all — comparing that to the UI language would announce that a tree which
  // does not exist was generated in an empty-named language.
  const staleLang = !!map && !map.needsOrganize && map.lang !== lang;
  // Three situations, three names. A language change does not get its own label: the action
  // is the same one either way, and the banner is where the reason belongs.
  const organizeLabel = organizing
    ? t('kmap.organizing', lang)
    : !map || map.needsOrganize
      ? t('kmap.organize', lang)
      : staleNew
        ? t('kmap.organizeNew', lang)
        : t('kmap.reorganize', lang);

  const organizeButton = (
    <button type="button" className="btn-ghost btn-xs" disabled={organizing} onClick={() => void organize()}>
      {organizeLabel}
    </button>
  );

  const harvestButton = (cls: string) => (
    <button type="button" className={cls} onClick={() => setHarvestOpen(true)}>
      {t('distill.open', lang)}
    </button>
  );

  const body = () => {
    if (loading && !map) {
      return (
        <div className="kmap-center">
          <div className="kmap-empty">{t('misc.loading', lang)}</div>
        </div>
      );
    }
    if (loadFailed && !map) {
      return (
        <div className="kmap-center">
          <div className="kmap-empty">{t('kmap.loadFailed', lang)}</div>
          <button type="button" className="btn-ghost btn-xs" onClick={() => void load()}>
            {t('kmap.retry', lang)}
          </button>
        </div>
      );
    }
    if (!map || !noteCount) {
      // The harvest button belongs here and not only in the header. This is the screen a
      // user with an empty library actually lands on, and a map needs notes to draw — so
      // the empty state has to say where notes come from, and be the shortest path to
      // getting some. It is also the one gap the deletion of the project pulse would
      // otherwise have left: the strip under the tree used to be the only content on this
      // screen, and removing it without this would have left an empty card with a button
      // that cannot do anything yet.
      return (
        <div className="kmap-center">
          <div className="kmap-empty">{t('kmap.needNotes', lang)}</div>
          <div className="kmap-empty">{t('kmap.needNotesHint', lang)}</div>
          {harvestButton('btn-brand btn-xs')}
        </div>
      );
    }
    if (map.needsOrganize) {
      return (
        <div className="kmap-center">
          <div className="kmap-empty">{t('kmap.empty', lang)}</div>
          <div className="kmap-empty">{t('kmap.emptyHint', lang)}</div>
          <button type="button" className="btn-brand btn-xs" disabled={organizing} onClick={() => void organize()}>
            {organizeLabel}
          </button>
        </div>
      );
    }
    // `treeNodes` puts the synthesized 「新笔记」 row first, and the server has never heard of
    // it — so a render index is one past the stored topic at the same position. That row gets
    // `null` (not addressable); every real topic gets its index path into `map.topics`.
    const newRow = map.loose.length > 0;
    return (
      <>
        <div className="kmap-body">
          <div className="kmap-tree" ref={treeRef}>
            {treeNodes.map((n, i) => renderNode(n, `n${i}`, 0, newRow && i === 0 ? null : [newRow ? i - 1 : i]))}
          </div>
          <div className="kmap-card">
            {!note ? (
              <div className="kmap-empty" style={{ paddingTop: 12, textAlign: 'center' }}>
                {t('kmap.pickNote', lang)}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="kmap-note-title">{note.title || t('notes.untitled', lang)}</span>
                  <span className="kmap-chip">{categoryLabel(note.category)}</span>
                </div>
                {note.excerpt && <div className="kmap-excerpt">{note.excerpt}</div>}

                <div className="kmap-sec">
                  <div className="kmap-sec-hd">
                    {t('kmap.outLinks', lang)} {edges?.out.length ? `(${edges.out.length})` : ''}
                  </div>
                  {edges?.out.length ? (
                    <div className="kmap-chips">{edges.out.map((e) => linkChip(e, 'out'))}</div>
                  ) : (
                    <div className="kmap-empty">{t('kmap.noLinks', lang)}</div>
                  )}
                  {ambOpen && (
                    <div className="kmap-amb">
                      <div className="kmap-empty" style={{ marginBottom: 4 }}>
                        {t('kmap.sameTitle', lang, { n: candidatesFor(ambOpen).length })}
                      </div>
                      <div className="kmap-chips">
                        {candidatesFor(ambOpen).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="kmap-link"
                            onClick={() => {
                              setAmbOpen(null);
                              setSelected(c.id);
                            }}
                          >
                            {c.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="kmap-sec">
                  <div className="kmap-sec-hd">
                    {t('kmap.backLinks', lang)} {edges?.back.length ? `(${edges.back.length})` : ''}
                  </div>
                  {edges?.back.length ? (
                    <div className="kmap-chips">{edges.back.map((e) => linkChip(e, 'back'))}</div>
                  ) : (
                    <div className="kmap-empty">{t('kmap.noLinks', lang)}</div>
                  )}
                </div>

                <div className="kmap-sec">
                  <div className="kmap-sec-hd">{t('kmap.semantic', lang)}</div>
                  {semanticBody()}
                </div>

                <div className="kmap-actions">
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => void openInNotesPanel(note.id)}
                  >
                    {t('kmap.openNote', lang)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {map.stats && (
          <div className="kmap-empty" style={{ padding: '0 12px 8px' }}>
            {t('kmap.stats', lang, { placed: map.stats.placed ?? 0, total: map.stats.total ?? noteCount })}
            {(map.stats.duplicates ?? 0) + (map.stats.invalid ?? 0) > 0 &&
              ` · ${t('kmap.statsIssues', lang, { duplicates: map.stats.duplicates ?? 0, invalid: map.stats.invalid ?? 0 })}`}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="card" style={{ flexShrink: 0 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--edge)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{t('home.knowledgeMap', lang)}</span>
          {/* The refresh icon that used to sit here is gone. `knowledge.map` is a pure read
              and this card re-reads on every activation, so the icon had nothing left to do
              — the only action that changes the tree is organizing, and that is this button.
              Two controls for one outcome, one of which appeared to do nothing. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {harvestButton('btn-ghost btn-xs')}
            {organizeButton}
          </span>
        </div>
        {map?.generatedAt && (
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{formatDbDateTime(map.generatedAt)}</div>
        )}
      </div>
      <div style={{ padding: '0 14px 4px', fontSize: 9, color: 'var(--muted)' }}>{t('home.aiGenerated', lang)}</div>
      {degradedText() && (
        <div className="kmap-banner">
          <span>{degradedText()}</span>
          {detailText() && <span className="kmap-banner-detail">{detailText()}</span>}
        </div>
      )}
      {notice && (
        <div className="kmap-banner" style={{ background: 'var(--surface2)' }}>
          <span>{notice}</span>
        </div>
      )}
      {/* Same class and same place as the degraded banner: these are all "the tree you are
          looking at is not the tree you asked for", and a second visual language for that
          would be a second thing to learn. They are independent lines rather than one
          message, because a map can be old in both ways at once. */}
      {staleNew && (
        <div className="kmap-banner">
          <span>{t('kmap.staleNotes', lang, { n: map?.loose.length ?? 0 })}</span>
        </div>
      )}
      {staleLang && (
        <div className="kmap-banner">
          <span>{t('kmap.staleLang', lang, { lang: LANGS_FULL[map?.lang ?? ''] ?? map?.lang ?? '' })}</span>
        </div>
      )}
      {/* The cost of removing the refresh icon, paid here: `load` does not clear `map` when it
          fails, and the only error UI needs `!map` — so a failed re-read used to be silent.
          This is the retry entry point, not the duplicate button that was deleted. */}
      {loadFailed && map && (
        <div className="kmap-banner">
          <span>{t('kmap.reloadFailed', lang)}</span>
          <button type="button" className="btn-ghost btn-xs" onClick={() => void load()}>
            {t('kmap.retry', lang)}
          </button>
        </div>
      )}
      <div style={{ padding: '8px 12px 12px' }}>{body()}</div>
      {/* Portalled, because the tree is a scroller: an absolutely positioned popover inside it
          would be clipped at the tree's edges — which is exactly where the last few rows are. */}
      {menu &&
        createPortal(
          <div className="kmap-tree-menu" role="menu" style={{ top: menu.y, left: menu.x }}>
            <button role="menuitem" className="kmap-tree-menu-item" onClick={startRename}>
              {t('kmap.topic.rename', lang)}
            </button>
            <button role="menuitem" className="kmap-tree-menu-item" onClick={startMerge}>
              {t('kmap.topic.merge', lang)}
            </button>
            <button
              role="menuitem"
              className="kmap-tree-menu-item kmap-tree-menu-item--danger"
              onClick={startDelete}
            >
              {t('kmap.topic.delete', lang)}
            </button>
          </div>,
          document.body,
        )}
      {/* The prompt has to say where the notes go: "delete" on a row that owns notes reads as
          "delete the notes", and this operation does not do that. The count is the row's own
          notes — its sub-topics move up whole and are not mentioned. */}
      <ConfirmDialog
        open={!!deleting}
        title={t('kmap.topic.deleteTitle', lang)}
        message={
          !deleting
            ? ''
            : deleting.notes > 0
              ? t('kmap.topic.deleteBody', lang, {
                  name: deleting.name,
                  n: deleting.notes,
                  where: deleting.toRoot ? t('kmap.unfiled', lang) : t('kmap.topic.parent', lang),
                })
              : t('kmap.topic.deleteBodyEmpty', lang, { name: deleting.name })
        }
        lang={lang}
        confirmLabel={t('kmap.topic.delete', lang)}
        cancelLabel={t('kmap.topic.cancel', lang)}
        loading={topicBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <TopicMergeDialog
        open={!!merging}
        lang={lang}
        topics={map?.topics ?? []}
        sourcePath={merging?.path ?? []}
        sourceName={merging?.name ?? ''}
        labelOf={nodeLabel}
        busy={topicBusy}
        onPick={pickMerge}
        onClose={() => setMerging(null)}
      />
      <DistillDialog
        open={harvestOpen}
        lang={lang}
        excludeIds={[]}
        onClose={() => setHarvestOpen(false)}
        onApplied={() => {
          // The new notes are not in `map` yet, and re-reading is what puts them in the
          // 「新笔记」 node — without it the user writes a note and the card looks unchanged.
          void load();
        }}
      />
    </div>
  );
}
