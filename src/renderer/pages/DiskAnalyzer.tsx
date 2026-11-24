import { ArrowUp, ChevronRight, FileIcon, Folder, FolderOpen, Layers } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Treemap } from 'recharts';
import type { AnalyzerOverview, TreeChildren, TreeEntry } from '@shared/types';
import { api } from '../api';
import { useApp, useScan } from '../store';
import { useT } from '../i18n';
import { Button, Card, cx, EmptyState, PageHeader } from '../components/ui';
import { LocationPicker } from '../components/LocationPicker';
import { ScanProgressPanel } from '../components/ScanProgressPanel';
import { usePalette } from '../charts';

const tooltipStyle = { background: 'rgb(var(--panel))', border: '1px solid rgb(var(--line))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--fg))' };

export function DiskAnalyzer() {
  const { t, bytes, num, date } = useT();
  const toast = useApp((s) => s.toast);
  const { progress, summary, live, running } = useScan('analyze');
  const [roots, setRoots] = useState<string[]>([]);
  const [overview, setOverview] = useState<AnalyzerOverview | null>(null);
  const [node, setNode] = useState<TreeChildren | null>(null);

  useEffect(() => {
    if (!summary || !live) {
      setOverview(null);
      setNode(null);
      return;
    }
    void api.analyzer.overview(summary.scanId).then((o) => {
      setOverview(o);
      if (o?.roots[0]) void api.analyzer.children(summary.scanId, o.roots[0].id).then(setNode);
    });
  }, [summary?.scanId, live]);

  const open = (id: number) => summary && void api.analyzer.children(summary.scanId, id).then((c) => c && setNode(c));

  const start = async () => {
    if (!roots.length) return toast(t('deep.noLocations'), 'error');
    try {
      await api.scan.start({ kind: 'analyze', roots });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div>
      <PageHeader icon={<Layers className="h-6 w-6" />} title={t('an.title')} subtitle={t('an.subtitle')} />
      <Card className="mb-6" title={t('an.pick')} subtitle={t('an.viewOnly')} action={<Button variant="primary" loading={running} disabled={!roots.length} onClick={start} icon={<Layers className="h-4 w-4" />}>{t('an.analyze')}</Button>}>
        <LocationPicker value={roots} onChange={setRoots} />
      </Card>
      {progress && running && <div className="mb-6"><ScanProgressPanel p={progress} /></div>}
      {!summary && !running && <Card><EmptyState icon={<Layers className="h-8 w-8" />} title={t('results.noScan')} hint={t('an.pick')} /></Card>}
      {summary && !live && <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">{t('results.summaryOnly')}</div>}
      {summary && live && overview && node && (
        <div className="space-y-4">
          <div className="path-ltr text-xs text-muted">{t('results.lastScan', { date: date(summary.finishedAt) })} · {num(summary.filesScanned)} {t('common.files')} · {bytes(summary.bytesScanned)}</div>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[320px_1fr]">
            <Card title={t('an.tree')} className="max-h-[640px] overflow-auto">
              {overview.roots.map((r) => <TreeNode key={r.id} scanId={summary.scanId} entry={r} depth={0} activeId={node.node.id} onOpen={open} defaultOpen parentSize={r.size} />)}
            </Card>
            <Card
              title={t('an.treemap')}
              action={
                <Button size="sm" variant="ghost" disabled={node.breadcrumb.length < 2} icon={<ArrowUp className="h-4 w-4" />} onClick={() => open(node.breadcrumb[node.breadcrumb.length - 2].id)}>
                  {t('an.up')}
                </Button>
              }
            >
              <div className="path-ltr mb-3 flex flex-wrap items-center gap-1 text-sm" dir="ltr">
                {node.breadcrumb.map((b, i) => (
                  <span key={b.id} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                    <button onClick={() => open(b.id)} className={cx('rounded px-1.5 py-0.5 hover:bg-panel2', i === node.breadcrumb.length - 1 ? 'font-semibold' : 'text-muted')}>{b.name}</button>
                  </span>
                ))}
                <span className="tabular ms-2 text-xs text-muted">{bytes(node.node.size)} · {num(node.node.fileCount)} {t('common.files')}</span>
              </div>
              <TreemapView data={node} onOpen={open} />
              <ContentsList data={node} onOpen={open} />
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <FileTypes overview={overview} />
            <Card title={t('an.largestFolders')} className="max-h-[440px] overflow-auto">
              <EntryList entries={overview.largestFolders.slice(0, 50)} onOpen={(e) => open(e.id)} />
            </Card>
            <Card title={t('an.largestFiles')} className="max-h-[440px] overflow-auto">
              <EntryList entries={overview.largestFiles.slice(0, 50)} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

interface TmDatum {
  name: string;
  size: number;
  id: number;
  isDir: boolean;
  fill: string;
  [k: string]: unknown;
}

function TreemapView({ data, onOpen }: { data: TreeChildren; onOpen(id: number): void }) {
  const { t, bytes } = useT();
  const pal = usePalette();
  const seriesColor = pal.color;
  const OTHER = pal.other;
  const items: TmDatum[] = data.children
    .filter((c) => c.size > 0)
    .slice(0, 60)
    .map((c, i) => ({ name: c.name, size: c.size, id: c.id, isDir: c.isDir, fill: seriesColor(i) }));
  if (data.otherFiles.bytes > 0) items.push({ name: t('an.otherFiles', { n: data.otherFiles.count }), size: data.otherFiles.bytes, id: -1, isDir: false, fill: OTHER });
  if (!items.length) return <div className="grid h-[380px] place-items-center text-sm text-muted">{t('results.empty')}</div>;
  return (
    <div className="h-[380px]" dir="ltr">
      <ResponsiveContainer>
        <Treemap
          data={items}
          dataKey="size"
          isAnimationActive={false}
          content={<TmCell onOpen={onOpen} fmt={bytes} surface={pal.surface} />}
        >
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => bytes(v)} itemStyle={{ color: 'rgb(var(--fg))' }} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

function TmCell(props: { x?: number; y?: number; width?: number; height?: number; name?: string; size?: number; fill?: string; id?: number; isDir?: boolean; onOpen(id: number): void; fmt(n: number): string; depth?: number; surface: string }) {
  const { x = 0, y = 0, width = 0, height = 0, name, size = 0, fill, id = -1, isDir, onOpen, fmt, depth, surface } = props;
  if (depth === 0) return null;
  const showLabel = width > 70 && height > 34;
  return (
    <g onClick={() => isDir && id >= 0 && onOpen(id)} style={{ cursor: isDir ? 'pointer' : 'default' }}>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={fill} stroke={surface} strokeWidth={2} opacity={isDir ? 0.95 : 0.7} />
      {showLabel && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600}>{(name ?? '').length > width / 7.5 ? `${(name ?? '').slice(0, Math.floor(width / 7.5) - 1)}…` : name}</text>
          <text x={x + 8} y={y + 32} fill="#fff" fillOpacity={0.85} fontSize={11}>{fmt(size)}</text>
        </>
      )}
    </g>
  );
}

function ContentsList({ data, onOpen }: { data: TreeChildren; onOpen(id: number): void }) {
  const { t } = useT();
  return (
    <div className="mt-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{t('an.contents')}</div>
      <div className="max-h-72 overflow-auto">
        <EntryList entries={data.children.slice(0, 200)} parentSize={data.node.size} onOpen={(e) => e.isDir && onOpen(e.id)} colorize />
      </div>
    </div>
  );
}

function EntryList({ entries, parentSize, onOpen, colorize }: { entries: TreeEntry[]; parentSize?: number; onOpen?(e: TreeEntry): void; colorize?: boolean }) {
  const { bytes, t } = useT();
  const seriesColor = usePalette().color;
  return (
    <div>
      {entries.map((e, i) => (
        <div key={`${e.path}-${i}`} onClick={() => e.isDir && onOpen?.(e)} className={cx('group flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-panel2', e.isDir && onOpen && 'cursor-pointer')}>
          {colorize && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(i) }} />}
          {e.isDir ? <Folder className="h-4 w-4 shrink-0 text-accent2" /> : <FileIcon className="h-4 w-4 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">
            <div className="path-ltr truncate" title={e.path}>{colorize ? e.name : e.path}</div>
            {parentSize ? (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/60"><div className="h-full rounded-full bg-accent/70" style={{ width: `${(e.size / Math.max(1, parentSize)) * 100}%` }} /></div>
            ) : null}
          </div>
          <span className="tabular shrink-0 text-xs font-medium">{bytes(e.size)}</span>
          <button title={t('common.openLocation')} onClick={(ev) => { ev.stopPropagation(); void api.system.showInFolder(e.path); }} className="opacity-0 transition group-hover:opacity-100">
            <FolderOpen className="h-4 w-4 text-muted hover:text-accent2" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TreeNode({ scanId, entry, depth, activeId, onOpen, defaultOpen, parentSize }: { scanId: string; entry: TreeEntry; depth: number; activeId: number; onOpen(id: number): void; defaultOpen?: boolean; parentSize: number }) {
  const { bytes } = useT();
  const [expanded, setExpanded] = useState(!!defaultOpen);
  const [kids, setKids] = useState<TreeEntry[] | null>(null);
  useEffect(() => {
    if (expanded && !kids) void api.analyzer.children(scanId, entry.id).then((c) => setKids(c?.children.filter((x) => x.isDir) ?? []));
  }, [expanded, kids, scanId, entry.id]);
  const pct = parentSize ? entry.size / parentSize : 0;
  return (
    <div>
      <div
        className={cx('flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pe-2 text-[13px] hover:bg-panel2', activeId === entry.id && 'bg-accent/15 text-fg')}
        style={{ paddingInlineStart: depth * 14 + 4 }}
        onClick={() => onOpen(entry.id)}
      >
        <button
          className="grid h-5 w-5 place-items-center text-muted"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {entry.dirCount > 0 && <ChevronRight className={cx('h-3.5 w-3.5 transition rtl:rotate-180', expanded && '!rotate-90')} />}
        </button>
        <Folder className="h-4 w-4 shrink-0 text-accent2" />
        <span className="path-ltr min-w-0 flex-1 truncate" title={entry.path}>{entry.name}</span>
        <span className="tabular shrink-0 text-[11px] text-muted">{depth > 0 ? `${Math.round(pct * 100)}%` : ''} {bytes(entry.size)}</span>
      </div>
      {expanded && kids?.slice(0, 100).map((k) => <TreeNode key={k.id} scanId={scanId} entry={k} depth={depth + 1} activeId={activeId} onOpen={onOpen} parentSize={entry.size} />)}
    </div>
  );
}

function FileTypes({ overview }: { overview: AnalyzerOverview }) {
  const { t, bytes, num } = useT();
  const pal = usePalette();
  const seriesColor = pal.color;
  const OTHER = pal.other;
  const top = overview.extStats.slice(0, 7);
  const rest = overview.extStats.slice(7);
  const data = [
    ...top.map((e, i) => ({ name: e.ext, value: e.bytes, count: e.count, fill: seriesColor(i) })),
    ...(rest.length ? [{ name: 'Other', value: rest.reduce((a, b) => a + b.bytes, 0), count: rest.reduce((a, b) => a + b.count, 0), fill: OTHER }] : []),
  ];
  return (
    <Card title={t('an.types')}>
      <div className="h-48" dir="ltr">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} stroke={pal.surface} strokeWidth={2} isAnimationActive>
              {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'rgb(var(--fg))' }} formatter={(v: number) => bytes(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 space-y-1">
        {data.map((d) => (
          <div key={d.name} className="tabular flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.fill }} />
            <span className="path-ltr flex-1 truncate">{d.name}</span>
            <span className="text-muted">{num(d.count)}</span>
            <span className="w-20 text-end font-medium">{bytes(d.value)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
