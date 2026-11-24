import { FolderPlus, HardDrive, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DriveInfo } from '@shared/types';
import { api } from '../api';
import { useT } from '../i18n';
import { Button, cx } from './ui';

export function LocationPicker({ value, onChange, single }: { value: string[]; onChange(v: string[]): void; single?: boolean }) {
  const { t, bytes } = useT();
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  useEffect(() => void api.system.drives().then(setDrives), []);
  const toggle = (p: string) => {
    if (single) return onChange([p]);
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  };
  const custom = value.filter((v) => !drives.some((d) => d.root === v));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {drives.map((d) => {
          const on = value.includes(d.root);
          return (
            <button key={d.root} onClick={() => toggle(d.root)} className={cx('flex min-w-[170px] items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition', on ? 'border-accent bg-accent/10' : 'border-line bg-panel2 hover:border-muted/50')}>
              <HardDrive className={cx('h-5 w-5', on ? 'text-accent2' : 'text-muted')} />
              <div className="min-w-0">
                <div className="path-ltr text-sm font-medium">{d.root}{d.label ? ` · ${d.label}` : ''}</div>
                <div className="tabular text-[11px] text-muted">{bytes(d.free)} / {bytes(d.total)}</div>
              </div>
            </button>
          );
        })}
        <Button
          variant="outline"
          className="h-auto min-h-[54px]"
          icon={<FolderPlus className="h-4 w-4" />}
          onClick={async () => {
            const r = await api.system.pickFolders();
            if (r?.length) onChange(single ? [r[0]] : Array.from(new Set([...value, ...r])));
          }}
        >
          {t('common.addFolder')}
        </Button>
      </div>
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {custom.map((c) => (
            <span key={c} className="path-ltr inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs">
              {c}
              <button onClick={() => onChange(value.filter((x) => x !== c))} className="text-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
