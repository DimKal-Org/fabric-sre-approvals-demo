import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`pd-card ${className}`}>{children}</div>;
}

export function StatCard({
  icon,
  iconColor,
  label,
  value,
  footerIcon,
  footerText,
  className = '',
}: {
  icon: ReactNode;
  iconColor: string;
  label: string;
  value: string | number;
  footerIcon?: ReactNode;
  footerText?: string;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col ${className}`}>
      <div className="flex flex-1 items-center gap-4 px-4 pt-4 pb-3">
        <div className="shrink-0" style={{ color: iconColor }}>{icon}</div>
        <div className="ml-auto min-w-0 text-right">
          <p className="truncate text-[13px] font-light text-pd-muted">{label}</p>
          <p className="truncate text-[26px] leading-tight font-light text-pd-neutral">
            {value}
          </p>
        </div>
      </div>
      {footerText !== undefined && (
        <>
          <hr className="border-t border-pd-line/70" />
          <div className="flex items-center gap-2 px-4 py-3 text-[13px] font-light text-pd-muted">
            {footerIcon}
            <span>{footerText}</span>
          </div>
        </>
      )}
    </Card>
  );
}

export function ChartCard({
  title,
  subtitle,
  footer,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={`flex flex-col ${className}`}>
      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="text-[17px] font-light text-pd-neutral">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[13px] font-light text-pd-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div className={`min-h-0 flex-1 px-3 pt-3 pb-1 ${bodyClassName}`}>
        {children}
      </div>
      {footer && (
        <>
          <hr className="mx-5 border-t border-pd-line/70" />
          <div className="flex items-center gap-2 px-5 py-3 text-[13px] font-light text-pd-muted">
            {footer}
          </div>
        </>
      )}
    </Card>
  );
}

export function Legend({ items }: {
  items: readonly { label: string; color: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[13px]">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-pd-line/50 text-pd-neutral',
  success: 'bg-pd-success/15 text-[#3fa06a]',
  warning: 'bg-pd-warning/20 text-[#b3872b]',
  danger: 'bg-pd-danger/15 text-[#c85e3c]',
  info: 'bg-pd-info/15 text-[#3897b5]',
};

export function Badge({ children, tone = 'neutral' }: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div role="status" className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-pd-muted">
      <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-pd-line border-t-pd-primary" />
      <span className="text-sm font-light">{label}</span>
    </div>
  );
}

export function EmptyState({ message, tone = 'neutral' }: {
  message: string;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const colors = {
    neutral: 'text-pd-muted',
    success: 'text-pd-success',
    danger: 'text-pd-danger',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex h-full min-h-40 items-center justify-center px-6 text-center text-sm font-light ${colors[tone]}`}
    >
      {message}
    </div>
  );
}