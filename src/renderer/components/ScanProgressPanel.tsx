import { motion } from 'framer-motion';
import { Pause, Play, Square } from 'lucide-react';
import type { ScanProgress } from '@shared/types';
import { formatDuration } from '@shared/format';
import { api } from '../api';
import { useT } from '../i18n';
import { Button, ProgressBar } from './ui';

export function ScanProgressPanel({ p }: { p: ScanProgress }) {
  const { t, bytes, num } = useT();
  const hashing = p.phase === 'hashing' && p.hashTotalBytes > 0;
  const ratio = hashing ? p.hashedBytes / p.hashTotalBytes : undefined;
  const active = !['done', 'cancelled', 'error'].includes(p.phase);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card glow-bg overflow-hidden p-6">
      <div className="flex items-center gap-6">
        <div className="relative grid h-24 w-24 shrink-0 place-items-center">
          <motion.div className="absolute inset-0 rounded-full border-2 border-accent/20" />
          {active && !p.paused && (
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent2"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
            />
          )}
          {active && !p.paused && (
            <motion.div className="absolute inset-3 rounded-full bg-accent/20" animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.2, 0.6] }} transition={{ duration: 1.8, repeat: Infinity }} />
          )}
          <span className="tabular relative text-sm font-semibold">{ratio != null ? `${Math.floor(ratio * 100)}%` : formatDuration(p.elapsedMs)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">{p.paused ? t('progress.paused') : t(`progress.phase.${p.phase}`)}</div>
              <div className="path-ltr mt-1 truncate text-xs text-muted" title={p.currentPath}>{p.currentPath || '…'}</div>
            </div>
            {active && (
              <div className="flex gap-2">
                {p.paused ? (
                  <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => api.scan.resume(p.scanId)}>{t('common.resume')}</Button>
                ) : (
                  <Button size="sm" icon={<Pause className="h-4 w-4" />} onClick={() => api.scan.pause(p.scanId)}>{t('common.pause')}</Button>
                )}
                <Button size="sm" variant="ghost" icon={<Square className="h-4 w-4" />} onClick={() => api.scan.cancel(p.scanId)}>{t('common.cancel')}</Button>
              </div>
            )}
          </div>
          <ProgressBar className="mt-4" value={ratio} indeterminate={ratio == null && active && !p.paused} />
          {hashing && <div className="tabular mt-1.5 text-[11px] text-muted">{t('progress.hashed', { done: bytes(p.hashedBytes), total: bytes(p.hashTotalBytes) })}</div>}
          <div className="tabular mt-4 grid grid-cols-3 gap-4 text-sm lg:grid-cols-6">
            <Metric label={t('progress.files')} value={num(p.filesScanned)} />
            <Metric label={t('progress.folders')} value={num(p.dirsScanned)} />
            <Metric label={t('progress.data')} value={bytes(p.bytesScanned)} />
            <Metric label={t('progress.found')} value={`${num(p.itemsFound)} · ${bytes(p.bytesFound)}`} />
            <Metric label={t('progress.elapsed')} value={formatDuration(p.elapsedMs)} />
            <Metric label={t('progress.eta')} value={p.etaMs != null ? `~${formatDuration(p.etaMs)}` : active ? t('progress.etaUnknown') : '—'} />
          </div>
          {p.errors > 0 && <div className="mt-2 text-[11px] text-muted">{t('progress.errors')}: {num(p.errors)}</div>}
        </div>
      </div>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}
