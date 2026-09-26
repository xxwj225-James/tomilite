import { createPortal } from 'react-dom';
import type { MapNode } from '@/lib/api';
import { t } from '@/lib/i18n';

// ═══ Choosing where a topic should be merged ═══
//
// A flat list of every *other* topic in the map, indented by depth. Flat rather than a tree
// because the point of this dialog is a choice, not a browse: showing the whole tree again
// would be the panel's tree one layer down, and the one row the user must not pick is the
// row they just clicked.
//
// The source and its entire sub-tree are absent rather than offered and then refused. The
// server rejects both cases (`same-node` / `into-descendant`) but a choice that can only
// fail should not be on screen — and "merge a topic into its own child" reads as a
// reasonable idea right up until it is refused.
//
// A topic name is not unique (`cleanTopicName` only folds whitespace and markdown), so a
// candidate is addressed by its position path, exactly as the server addresses it. Two rows
// reading「产品」are two different destinations and only the path tells them apart.
//
// Nothing here is written: picking a row hands the path to the card, which is what owns the
// call and the notice.

interface Candidate {
  path: number[];
  node: MapNode;
  depth: number;
}

const countNotes = (n: MapNode): number =>
  n.notes.length + (n.children ?? []).reduce((sum, c) => sum + countNotes(c), 0);

export function TopicMergeDialog({
  open,
  lang,
  topics,
  sourcePath,
  sourceName,
  labelOf,
  busy,
  onPick,
  onClose,
}: {
  open: boolean;
  lang: string;
  /** `map.topics` — the stored tree, not the rendered one. */
  topics: MapNode[];
  sourcePath: number[];
  sourceName: string;
  /** The card's own `nodeLabel`, so a row reads the same in both places. */
  labelOf: (n: MapNode) => string;
  busy: boolean;
  onPick: (intoPath: number[], intoExpect: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const candidates: Candidate[] = [];
  const walk = (list: MapNode[], base: number[], depth: number) => {
    list.forEach((n, i) => {
      const path = [...base, i];
      // Longer-and-prefixed is a descendant; equal is the source itself. Shorter paths are
      // the source's ancestors, which are legitimate destinations.
      if (sourcePath.length <= path.length && sourcePath.every((x, j) => path[j] === x)) return;
      if (n.kind === 'topic') candidates.push({ path, node: n, depth });
      walk(n.children ?? [], path, depth + 1);
    });
  };
  walk(topics, [], 0);

  return createPortal(
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 440, minWidth: 340, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">{t('kmap.topic.mergeTitle', lang, { name: sourceName })}</div>
        <div className="modal-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>{t('kmap.topic.mergeLead', lang)}</div>
          {candidates.length === 0 ? (
            <div>{t('kmap.topic.mergeEmpty', lang)}</div>
          ) : (
            <div className="kmap-merge-list">
              {candidates.map((c) => (
                <button
                  key={c.path.join('/')}
                  type="button"
                  className="kmap-merge-item"
                  // Depth is turned into padding rather than a nested list so that every
                  // candidate is one click deep, whatever its place in the tree.
                  style={{ paddingLeft: 8 + c.depth * 12 }}
                  disabled={busy}
                  title={labelOf(c.node)}
                  onClick={() => onPick(c.path, c.node.name)}
                >
                  <span className="kmap-tree-label">{labelOf(c.node)}</span>
                  <span className="kmap-tree-count">{countNotes(c.node)}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={onClose}>
              {t('kmap.topic.cancel', lang)}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
