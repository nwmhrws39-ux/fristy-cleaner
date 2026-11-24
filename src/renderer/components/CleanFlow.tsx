import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Recycle, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CleanEstimate, CleanMode, CleanProgress, CleanResult } from '@shared/types';
import { PERMANENT_CONFIRM_PHRASE } from '@shared/defaults';
import { api } from '../api';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Checkbox, cx, Modal, ProgressBar, TextInput } from './ui';

type Step = 'confirm' | 'running' | 'done';

/**
 * Confirmation → cleaning → results. Never starts without an explicit click, and permanent
 * deletion additionally requires typing the confirmation phrase.
 */
export function CleanFlow({ open, scanId, ids, onClose, onDone }: { open: boolean; scanId: string; ids: number[]; onClose(): void; onDone(r: CleanResult): void }) {
  const { t, bytes, num } = useT();
  const toast = useApp((s) => s.toast);
  const [step, setStep] = useState<Step>('confirm');
  const [est, setEst] = useState<CleanEstimate | null>(null);
  const [mode, setMode] = useState<CleanMode>('trash');
  const [phrase, setPhrase] = useState('');
  const [ack, setAck] = useState(false);
  const [prog, setProg] = useState<CleanProgress | null>(null);
  const [result, setResult] = useState<CleanResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('confirm');
    setMode('trash');
    setPhrase('');
    setAck(false);
    setResult(null);
    setProg(null);
    setEst(null);
    void api.clean.estimate(scanId, ids).then(setEst);
  }, [open, scanId, ids]);
  useEffect(() => api.clean.onProgress(setProg), []);

  const canConfirm = !!est && est.count > 0 && (est.personalCount === 0 || ack) && (mode === 'trash' || phrase === PERMANENT_CONFIRM_PHRASE);

  const run = async () => {
    setStep('running');
    try {
      const r = await api.clean.execute({ scanId, itemIds: ids, mode, confirmed: true, permanentConfirmation: mode === 'permanent' ? phrase : undefined });
      setResult(r);
      setStep('done');
      onDone(r);
    } catch (e) {
      toast(String((e as Error).message || e), 'error');
      setStep('confirm');
    }
  };

  const errLabel = (e?: string) => (e && e.startsWith('clean.err.') ? t(e) : e || '');

  return (
    <Modal
      open={open}
      onClose={() => step !== 'running' && onClose()}
      wide
      title={step === 'done' ? t('clean.doneTitle') : step === 'running' ? t('clean.running') : t('clean.title')}
      footer={
        step === 'confirm' ? (
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant={mode === 'permanent' ? 'danger' : 'primary'} disabled={!canConfirm} onClick={run} icon={mode === 'trash' ? <Recycle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}>
              {mode === 'trash' ? t('clean.confirmTrash') : t('clean.confirmPermanent')}
            </Button>
          </>
        ) : step === 'done' ? (
          <>
            {result?.mode === 'trash' && <Button variant="ghost" onClick={() => api.system.openRecycleBin()}>{t('clean.openRecycle')}</Button>}
            <Button variant="primary" onClick={onClose}>{t('common.close')}</Button>
          </>
        ) : undefined
      }
    >
      {step === 'confirm' && !est && <div className="text-sm text-muted">{t('common.loading')}</div>}
      {step === 'confirm' && est && (
        <div className="space-y-5">
          <div className="flex items-baseline justify-between rounded-2xl bg-accent/10 p-5">
            <div className="text-sm text-muted">{t('results.recoverable')}</div>
            <div className="tabular text-3xl font-semibold">{bytes(est.bytes)}</div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{t('clean.byCategory')}</div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {est.categories.map((c) => (
                <div key={c.id} className="tabular flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{t(`cat.${c.id}.name`)}</span>
                  <span className="text-muted">{num(c.count)} · <span className="text-fg">{bytes(c.bytes)}</span></span>
                </div>
              ))}
            </div>
          </div>
          {est.personalCount > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
              <div className="flex gap-2 text-warn"><AlertTriangle className="h-5 w-5 shrink-0" />{t('clean.personalWarning', { n: num(est.personalCount) })}</div>
              <label className="mt-3 flex cursor-pointer items-center gap-2">
                <Checkbox checked={ack} onChange={setAck} />
                <span>{t('clean.personalAck')}</span>
              </label>
            </div>
          )}
          {est.folderCount > 0 && <p className="text-xs text-muted">{t('clean.foldersNote', { n: num(est.folderCount) })}</p>}
          {est.allCopiesGroups > 0 && <p className="text-xs text-warn">{t('clean.allCopies', { n: num(est.allCopiesGroups) })}</p>}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{t('clean.mode')}</div>
            <div className="grid grid-cols-2 gap-3">
              {(['trash', 'permanent'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={cx('rounded-xl border p-4 text-start transition', mode === m ? (m === 'trash' ? 'border-accent bg-accent/10' : 'border-danger bg-danger/10') : 'border-line hover:border-muted/50')}>
                  <div className="flex items-center gap-2 font-medium">
                    {m === 'trash' ? <Recycle className="h-4 w-4 text-accent2" /> : <Trash2 className="h-4 w-4 text-danger" />}
                    {t(`clean.mode.${m}`)}
                  </div>
                  <div className="mt-1 text-xs text-muted">{t(`clean.mode.${m}Desc`)}</div>
                </button>
              ))}
            </div>
            {mode === 'permanent' && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs text-danger">{t('clean.typeToConfirm', { phrase: PERMANENT_CONFIRM_PHRASE })}</div>
                <TextInput value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={PERMANENT_CONFIRM_PHRASE} className="w-48" dir="ltr" />
              </div>
            )}
          </div>
          <div className="flex gap-2 rounded-xl bg-panel2 p-3 text-xs text-muted">
            <ShieldCheck className="h-4 w-4 shrink-0 text-ok" />
            {t('clean.revalidate')}
          </div>
        </div>
      )}
      {step === 'running' && (
        <div className="py-6">
          <ProgressBar value={prog ? prog.done / Math.max(1, prog.total) : undefined} indeterminate={!prog} />
          <div className="tabular mt-3 flex justify-between text-sm">
            <span>{prog ? `${num(prog.done)} / ${num(prog.total)}` : ''}</span>
            <span>{prog ? bytes(prog.bytes) : ''}</span>
          </div>
          <div className="path-ltr mt-2 truncate text-xs text-muted">{prog?.current}</div>
        </div>
      )}
      {step === 'done' && result && (
        <div className="space-y-5">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center py-2 text-center">
            <CheckCircle2 className="h-14 w-14 text-ok" />
            <div className="mt-3 text-sm text-muted">{t('clean.recovered')}</div>
            <div className="tabular text-4xl font-semibold">{bytes(result.bytesRecovered)}</div>
            <div className="mt-1 text-xs text-muted">{t('clean.historySaved')}</div>
          </motion.div>
          <div className="tabular grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-ok/10 p-3"><div className="text-xl font-semibold text-ok">{num(result.removed)}</div><div className="text-xs text-muted">{t('clean.removed')}</div></div>
            <div className="rounded-xl bg-warn/10 p-3"><div className="text-xl font-semibold text-warn">{num(result.skipped)}</div><div className="text-xs text-muted">{t('clean.skipped')}</div></div>
            <div className="rounded-xl bg-danger/10 p-3"><div className="text-xl font-semibold text-danger">{num(result.failed)}</div><div className="text-xs text-muted">{t('clean.failed')}</div></div>
          </div>
          {result.issues.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{t('clean.issues')}</div>
              <div className="max-h-56 divide-y divide-line overflow-auto rounded-xl border border-line text-xs">
                {result.issues.map((i, k) => (
                  <div key={k} className="flex justify-between gap-3 px-3 py-2">
                    <span className="path-ltr truncate text-muted" title={i.path}>{i.path}</span>
                    <span className="shrink-0">{errLabel(i.error)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
