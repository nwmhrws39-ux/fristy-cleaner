import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { RiskLevel } from '@shared/types';
import { useT } from '../i18n';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'ghost' | 'subtle' | 'danger' | 'outline';
export function Button({
  variant = 'subtle', size = 'md', icon, loading, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-accent text-white hover:brightness-110 shadow-glow',
    ghost: 'text-muted hover:text-fg hover:bg-panel2',
    subtle: 'bg-panel2 text-fg border border-line hover:border-accent/50',
    outline: 'border border-accent/50 text-accent2 hover:bg-accent/10',
    danger: 'bg-danger/90 text-white hover:bg-danger',
  };
  const s = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-14 px-8 text-base gap-3' }[size];
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-40', v[variant], s, className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('card p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="flex items-center gap-4">
        {icon && <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent2">{icon}</div>}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const { t } = useT();
  const c = { safe: 'bg-ok/15 text-ok', review: 'bg-warn/15 text-warn', caution: 'bg-danger/15 text-danger' }[risk];
  return <span className={cx('rounded-md px-2 py-0.5 text-[11px] font-medium', c)}>{t(`risk.${risk}`)}</span>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('rounded-md bg-panel2 px-2 py-0.5 text-[11px] text-muted', className)}>{children}</span>;
}

export function Checkbox({ checked, indeterminate, onChange, disabled, label }: { checked: boolean; indeterminate?: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition disabled:opacity-30',
        checked || indeterminate ? 'border-accent bg-accent text-white' : 'border-muted/50 hover:border-accent',
      )}
    >
      {checked && !indeterminate && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 8.5l3 3 7-7" /></svg>
      )}
      {indeterminate && <span className="h-0.5 w-2 rounded bg-white" />}
    </button>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40', checked ? 'bg-accent' : 'bg-line')}
    >
      <motion.span layout className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', checked ? 'end-0.5' : 'start-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-panel2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-lg px-3 py-1.5 text-xs font-medium transition', value === o.value ? 'bg-accent text-white' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, indeterminate, className }: { value?: number; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cx('relative h-2 overflow-hidden rounded-full bg-line/70', className)}>
      {indeterminate ? (
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-accent to-accent2"
          animate={{ left: ['-35%', '100%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" animate={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%` }} />
      )}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'default' | 'accent' | 'ok' }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
        {icon && <span className={cx('grid h-9 w-9 place-items-center rounded-xl', tone === 'ok' ? 'bg-ok/15 text-ok' : 'bg-accent/15 text-accent2')}>{icon}</span>}
      </div>
      <div className="tabular mt-3 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </motion.div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-accent/10 text-accent2">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {hint && <p className="mt-1 max-w-md text-sm text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className={cx('card flex max-h-[85vh] w-full flex-col shadow-2xl', wide ? 'max-w-3xl' : 'max-w-xl')}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-panel2 hover:text-fg" aria-label="close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Field({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, className }: { value: number; onChange(v: number): void; min?: number; max?: number; className?: string }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (isFinite(n)) onChange(n);
      }}
      className={cx('tabular h-9 w-28 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none focus:border-accent', className)}
    />
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('h-9 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none placeholder:text-muted focus:border-accent', props.className)} />;
}

export function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className="h-9 rounded-lg border border-line bg-panel2 px-3 text-sm outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
