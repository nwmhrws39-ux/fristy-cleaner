import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { Logo } from './Logo';

export function TitleBar() {
  const { t } = useT();
  const [, setMax] = useState(false);
  useEffect(() => api.window.onMaximizedChange(setMax), []);
  const btn = 'no-drag grid h-full w-12 place-items-center text-muted transition hover:bg-panel2 hover:text-fg';
  return (
    <div className="drag flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel/80 ps-4" dir="ltr">
      <div className="flex items-center gap-2.5">
        <Logo size={20} />
        <span className="text-[13px] font-semibold tracking-wide">
          FRISTY <span className="font-normal text-muted">Cleaner</span>
        </span>
        <span className="ms-2 text-[11px] text-muted">{t('app.tagline')}</span>
      </div>
      <div className="flex h-full">
        <button className={btn} onClick={() => api.window.minimize()} aria-label="minimize"><Minus className="h-4 w-4" /></button>
        <button className={btn} onClick={() => api.window.toggleMaximize()} aria-label="maximize"><Square className="h-3.5 w-3.5" /></button>
        <button className={`${btn} hover:!bg-red-600 hover:!text-white`} onClick={() => api.window.close()} aria-label="close"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
