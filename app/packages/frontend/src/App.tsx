import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clipboard, GitBranch, Layers, Notebook, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import type { RecommendationRecord, RecommendationStatus } from '@rayfin-app/shared';
import { useAuth } from '@/hooks/auth.context';
import { Badge, Card, EmptyState, Spinner } from '@/components/paper/Card';
import { Modal } from '@/components/Modal';
import { Markdown } from '@/components/Markdown';
import { approveRecommendation, rejectRecommendation } from '@/services/decisions';
import { getRecommendation, listRecommendations } from '@/services/recommendations';

const filters = ['Pending', 'Approved', 'Rejected', 'All'] as const;
type Filter = typeof filters[number];
type Notice = { message: string; error: boolean };
type Decision = 'Approve' | 'Reject';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString();
}

function matchesFilter(status: RecommendationStatus, filter: Filter) {
  return filter === 'All' || status === filter;
}

function StatusBadge({ status }: { status: RecommendationStatus }) {
  const tone = status === 'Approved' ? 'success' : status === 'Pending' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

function DecisionProgress({ label }: { label: string }) {
  return <span role="status" aria-label={label} className="decision-progress">
    <span className="decision-spinner spin" aria-hidden="true" />
    Working...
  </span>;
}

function ItemIcon({ type }: { type: string }) {
  const Icon = type === 'Notebook' ? Notebook : Layers;
  return <Icon aria-hidden="true" size={20} strokeWidth={1.5} />;
}

function PrLink({ url }: { url: string }) {
  let safeUrl: string | undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      safeUrl = parsed.href;
    }
  } catch {
    // External SQL writers can supply malformed links; never make them navigable.
  }
  if (safeUrl) return <a href={safeUrl} target="_blank" rel="noopener noreferrer">Open pull request</a>;
  return <span role="alert">Invalid pull request URL: {url}</span>;
}

export default function App() {
  const { session } = useAuth();
  const [records, setRecords] = useState<RecommendationRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('Pending');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = busyId !== null;
  const mounted = useRef(false);
  const refreshing = useRef(false);
  const submitting = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (refreshing.current || submitting.current) return;
    refreshing.current = true;
    const current = generation.current;
    setLoading(true);
    try {
      const rows = await listRecommendations();
      if (mounted.current && current === generation.current) {
        setRecords(rows);
        setLoadError(null);
        setUpdatedAt(new Date());
      }
    } catch (error) {
      if (mounted.current && current === generation.current) setLoadError(errorMessage(error));
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    generation.current++;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function decide(id: string, action: Decision, comment: string) {
    // Demo only: local button disabling is sufficient; distributed duplicate-request handling is out of scope.
    if (submitting.current) return;
    submitting.current = true;
    generation.current++;
    setBusyId(id);
    setNotice(null);
    try {
      const invoke = action === 'Approve' ? approveRecommendation : rejectRecommendation;
      const result = await invoke(id, comment.trim() || undefined);
      if (result.error) throw new Error(result.error);
      if (mounted.current) {
        setRecords((rows) => rows.map((row) => row.id === id ? {
          ...row,
          status: result.status,
          ...(result.branch_name !== undefined ? { branch_name: result.branch_name } : {}),
        } : row));
        setNotice({ error: false, message: `Recommendation ${result.status.toLowerCase()}.` });
      }
    } catch (error) {
      if (mounted.current) setNotice({ error: true, message: errorMessage(error) });
    } finally {
      // A rejected call may still have changed server state. Never synthesize a status locally.
      try {
        const record = await getRecommendation(id);
        if (mounted.current) {
          setRecords((rows) => rows.map((row) => row.id === id ? record : row));
          setLoadError(null);
        }
      } catch (error) {
        if (mounted.current) setLoadError(`Could not refresh the decision record: ${errorMessage(error)}`);
      } finally {
        submitting.current = false;
        if (mounted.current) setBusyId(null);
      }
    }
  }

  const selected = records.find((row) => row.id === selectedId);
  const term = search.trim().toLocaleLowerCase();
  const visible = records.filter((row) => matchesFilter(row.status, filter)
    && `${row.title} ${row.item_name}`.toLocaleLowerCase().includes(term));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark"><ShieldCheck size={24} strokeWidth={1.5} aria-hidden="true" /></div>
        <div className="brand-copy"><p className="eyebrow">Fabric / SRE operations</p><h1>SRE Recommendation Approvals</h1></div>
        <div className="signed-in"><span className="presence" />{session?.user?.email || 'Signed-in Fabric user'}</div>
      </header>
      <main>
        <div className="page-intro">
          <div><p className="eyebrow">Human review. Better workloads.</p><h2>Recommendation inbox</h2>
            <p>Review the SRE Agent's findings before any changes are made.</p></div>
          <span className="refresh-meta">Auto-refresh every 15 seconds</span>
        </div>
        <div className="workflow-note"><ShieldCheck size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>You stay in control. Approve the proposed change, or reject it with context.</span>
          <Badge tone="info">Review queue</Badge>
        </div>
        <Card>
          <div className="toolbar">
            <div className="filter-chips" role="group" aria-label="Filter recommendations">
              {filters.map((value) => <button key={value} type="button" aria-pressed={filter === value}
                className={`filter-chip ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value}</button>)}
            </div>
            <div className="search-actions">
              <label className="search-box"><Search size={18} strokeWidth={1.5} aria-hidden="true" />
                <input aria-label="Search title or item name" placeholder="Search recommendations" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <button type="button" className="pd-button-secondary" onClick={() => void refresh()} disabled={loading || busy}>
                <RefreshCw size={16} strokeWidth={1.5} className={loading ? 'spin' : ''} aria-hidden="true" />Refresh</button>
            </div>
          </div>
          {loadError && <div role="alert" className="error-banner">{loadError} {records.length > 0 && 'Showing the last fetched data.'}</div>}
          {loading && !updatedAt ? <Spinner label="Loading recommendations..." />
            : visible.length === 0 ? <EmptyState message={loadError ? 'Recommendations could not be loaded. Use Refresh to retry.' : 'No recommendations match this view.'} tone={loadError ? 'danger' : 'neutral'} />
            : <div className="table-scroll"><table className="pd-table" aria-label="Recommendations" aria-busy={loading}>
              <thead><tr><th scope="col">Created</th><th scope="col">Item</th><th scope="col">Recommendation</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead>
              <tbody>{visible.map((row) => <tr key={row.id} aria-busy={busyId === row.id} onClick={() => setSelectedId(row.id)}>
                <td className="date-cell">{dateLabel(row.created_at)}</td>
                <td><div className="item-cell"><ItemIcon type={row.item_type} /><div>{row.item_name}<small>{row.item_type}</small></div></div></td>
                <td><button type="button" className="row-title" onClick={() => setSelectedId(row.id)}>{row.title}</button><small>{row.estimated_impact}</small></td>
                <td><Badge tone={row.severity === 'High' ? 'danger' : row.severity === 'Medium' ? 'warning' : 'info'}>{row.severity}</Badge></td>
                <td>{busyId === row.id
                  ? <DecisionProgress label={`Submitting decision for ${row.item_name}`} />
                  : <StatusBadge status={row.status} />}</td>
              </tr>)}</tbody>
            </table></div>}
          <footer className="table-footer"><span>{visible.length} recommendation{visible.length !== 1 ? 's' : ''}</span>
            <span>{updatedAt ? `Last refreshed ${updatedAt.toLocaleTimeString()}` : 'Awaiting first refresh'}</span></footer>
        </Card>
        <p className="scope-note">Fabric SSO protected &middot; Recommendations are created by the external SRE workflow.</p>
      </main>
      {selected && <Detail key={selected.id} record={selected} busy={busy} processing={busyId === selected.id} onClose={() => setSelectedId(null)}
        onDecide={decide} onNotice={setNotice} notice={notice} onDismissNotice={() => setNotice(null)} />}
      {!selected && notice && <Toast notice={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>
    {notice.error ? <X size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
    <span>{notice.message}</span><button type="button" aria-label="Dismiss notification" onClick={onDismiss}><X size={16} aria-hidden="true" /></button>
  </div>;
}

function Detail({ record, busy, processing, onClose, onDecide, onNotice, notice, onDismissNotice }: {
  record: RecommendationRecord;
  busy: boolean;
  processing: boolean;
  onClose: () => void;
  onDecide: (id: string, action: Decision, comment: string) => Promise<void>;
  onNotice: (notice: Notice) => void;
  notice: Notice | null;
  onDismissNotice: () => void;
}) {
  const [comment, setComment] = useState('');
  const [confirmation, setConfirmation] = useState<Decision | null>(null);
  const [previousStatus, setPreviousStatus] = useState(record.status);
  const canDecide = record.status === 'Pending';
  if (previousStatus !== record.status) {
    setPreviousStatus(record.status);
    setConfirmation(null);
  }

  async function copyThread() {
    try {
      await navigator.clipboard.writeText(record.thread_id);
      onNotice({ error: false, message: 'Thread ID copied.' });
    } catch (error) {
      onNotice({ error: true, message: `Could not copy thread ID: ${errorMessage(error)}` });
    }
  }

  return <Modal labelId="detail-title" className="detail-panel" onClose={onClose}>
    <header className="detail-header"><div><p className="eyebrow">Recommendation details</p><h2 id="detail-title">{record.title}</h2></div>
      <button type="button" className="icon-button" aria-label="Close recommendation" onClick={onClose}><X aria-hidden="true" size={20} /></button></header>
    <div className="detail-body">
      <div className="detail-badges"><Badge tone={record.severity === 'High' ? 'danger' : record.severity === 'Medium' ? 'warning' : 'info'}>{record.severity} severity</Badge><StatusBadge status={record.status} /></div>
      <div className="item-detail"><ItemIcon type={record.item_type} /><strong>{record.item_name}</strong><span>{record.item_type}</span></div>
      <dl className="metadata"><dt>Created</dt><dd>{dateLabel(record.created_at)}</dd><dt>Item path</dt><dd><code>{record.item_path}</code></dd>
        <dt>Workspace</dt><dd>{record.workspace_id}</dd><dt>Thread ID</dt><dd className="thread-value"><code>{record.thread_id}</code>
          <button type="button" className="icon-button" aria-label="Copy thread ID" onClick={() => void copyThread()}><Clipboard size={16} aria-hidden="true" /></button></dd>
        <dt>Estimated impact</dt><dd>{record.estimated_impact}</dd></dl>
      <section><h3>Git target</h3>
        <dl className="metadata">
          <dt>Repository</dt><dd>{record.git_repo_url || 'Not recorded'}</dd>
          <dt>Base branch</dt><dd><code>{record.git_base_branch || 'Not recorded'}</code></dd>
          <dt>Git folder</dt><dd><code>{record.git_folder === '' ? '(repository root)' : record.git_folder ?? 'Not recorded'}</code></dd>
        </dl>
        {(!record.git_repo_url || !record.git_base_branch || record.git_folder == null) &&
          <p className="section-hint">Approval requires Git metadata. Log a new recommendation after discovering the workspace Git connection.</p>}
      </section>
      <section><h3>Summary</h3><p className="summary-text">{record.summary}</p></section>
      <section><h3>Details</h3><Markdown>{record.details}</Markdown></section>
      <section className="proposed-section"><h3>Proposed changes</h3><p className="section-hint">This is the scope you are approving.</p><Markdown>{record.proposed_changes}</Markdown></section>
      {(record.decided_at || record.decided_by_id || record.decided_by_name || record.decided_by_email || record.decision_comment) && <section><h3>Decision history</h3>
        <dl className="metadata"><dt>Decided by</dt><dd>{record.decided_by_name || record.decided_by_email || record.decided_by_id || 'Not recorded'}</dd>
          {record.decided_by_email && <><dt>Email</dt><dd>{record.decided_by_email}</dd></>}
          <dt>When</dt><dd>{dateLabel(record.decided_at)}</dd><dt>Comment</dt><dd className="summary-text">{record.decision_comment || 'No comment'}</dd></dl></section>}
      {(record.branch_name || record.commit_sha || record.pr_url || record.notified_at) && <section><h3><GitBranch size={17} aria-hidden="true" />Delivery</h3>
        <dl className="metadata">{record.branch_name && <><dt>Branch</dt><dd><code>{record.branch_name}</code></dd></>}
          {record.commit_sha && <><dt>Commit SHA</dt><dd><code>{record.commit_sha}</code></dd></>}
          {record.pr_url && <><dt>Pull request</dt><dd><PrLink url={record.pr_url} /></dd></>}
          {record.notified_at && <><dt>Thread notified</dt><dd>{dateLabel(record.notified_at)}</dd></>}</dl></section>}
      {record.error_message && <section role="alert" className="error-banner"><h3>Decision error</h3><p>{record.error_message}</p></section>}
      {canDecide ? <section className="decision-controls"><h3>Your decision</h3>
        <label htmlFor="decision-comment">Comment <span className="muted">(optional)</span></label>
        <textarea id="decision-comment" className="pd-input" maxLength={500} rows={3} value={comment} disabled={busy} aria-describedby="comment-counter"
          onChange={(event) => setComment(event.target.value)} placeholder="Add context for the SRE Agent..." />
        <p id="comment-counter" className="comment-counter">{comment.length}/500 characters</p>
        <div className="decision-buttons"><button type="button" className="pd-button" disabled={busy} onClick={() => setConfirmation('Approve')}>
          <Check size={16} aria-hidden="true" />Approve</button>
          <button type="button" className="pd-button-secondary reject-button" disabled={busy} onClick={() => setConfirmation('Reject')}><X size={16} aria-hidden="true" />Reject</button>
          {processing && <DecisionProgress label="Submitting decision" />}</div>
        <p className="section-hint">Approve creates a GitHub branch and notifies the SRE Agent. Reject notifies the agent without changing code.</p>
      </section> : <p className="workflow-note">This recommendation has already been decided.</p>}
    </div>
    {notice && <Toast notice={notice} onDismiss={onDismissNotice} />}
    {confirmation && canDecide && <Modal labelId="confirm-title" className="confirm-dialog" onClose={() => setConfirmation(null)} preventClose={busy}>
      <h2 id="confirm-title">{confirmation} recommendation?</h2><p>You are about to {confirmation.toLowerCase()} this recommendation for <strong>{record.item_name}</strong>.</p>
      <blockquote>{record.title}</blockquote><p>{comment.trim() ? `Comment: ${comment.trim()}` : 'No comment will be attached.'}</p>
      <div className="decision-buttons"><button type="button" className={confirmation === 'Approve' ? 'pd-button' : 'pd-button-secondary reject-button'} disabled={busy}
        onClick={() => { const action = confirmation; setConfirmation(null); void onDecide(record.id, action, comment); }}>Confirm {confirmation.toLowerCase()}</button>
        <button type="button" className="pd-button-secondary" onClick={() => setConfirmation(null)} disabled={busy}>Cancel</button></div>
    </Modal>}
  </Modal>;
}
