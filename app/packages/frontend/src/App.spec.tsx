import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionResult } from '@/services/decisions';
import { recommendation } from '@/test/recommendation';

vi.mock('@/hooks/auth.context', () => ({
  useAuth: () => ({ session: { user: { email: 'reviewer@example.com' } } }),
}));
vi.mock('@/services/recommendations', () => ({
  listRecommendations: vi.fn(),
  getRecommendation: vi.fn(),
}));
vi.mock('@/services/decisions', () => ({
  approveRecommendation: vi.fn(),
  rejectRecommendation: vi.fn(),
}));

import App from './App';
import { getRecommendation, listRecommendations } from '@/services/recommendations';
import { approveRecommendation, rejectRecommendation } from '@/services/decisions';

async function openDetail() {
  fireEvent.click(await screen.findByRole('button', { name: 'Avoid collecting the full sales dataset' }));
  return screen.getByRole('dialog', { name: 'Avoid collecting the full sales dataset' });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listRecommendations).mockResolvedValue([recommendation()]);
  vi.mocked(getRecommendation).mockResolvedValue(recommendation());
  vi.mocked(approveRecommendation).mockRejectedValue(new Error('SRE thread notification returned HTTP 503'));
  vi.mocked(rejectRecommendation).mockRejectedValue(new Error('SRE thread notification returned HTTP 503'));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

afterEach(() => { vi.useRealTimers(); });

describe('recommendation review workflow', () => {
  it.each(['', 'teams/sales'])('shows the recorded Git target and distinguishes root from missing metadata (%s)', async (folder) => {
    vi.mocked(listRecommendations).mockResolvedValue([recommendation({
      git_repo_url: 'https://github.com/example/sales', git_base_branch: 'release/demo', git_folder: folder,
    })]);
    render(<App />);
    const panel = await openDetail();
    expect(within(panel).getByText('https://github.com/example/sales')).toBeVisible();
    expect(within(panel).getByText('release/demo')).toBeVisible();
    expect(within(panel).getByText(folder || '(repository root)')).toBeVisible();
    expect(within(panel).queryByText(/Approval requires Git metadata/)).toBeNull();
  });

  it('warns about legacy recommendations without guessing a Git target', async () => {
    render(<App />);
    const panel = await openDetail();
    expect(within(panel).getByText(/Approval requires Git metadata/)).toBeVisible();
    expect(within(panel).queryByText('(repository root)')).toBeNull();
  });

  it('defaults to Pending, searches title/item and filters completed records', async () => {
    vi.mocked(listRecommendations).mockResolvedValue([
      recommendation(), recommendation({ id: 'approved', status: 'Approved', title: 'Cache customers', item_name: 'Customer Segments' }),
      recommendation({ id: 'rejected', status: 'Rejected', title: 'Rejected change' }),
    ]);
    render(<App />);
    expect(await screen.findByText('reviewer@example.com')).toBeVisible();
    await screen.findByRole('button', { name: 'Avoid collecting the full sales dataset' });
    expect(screen.queryByRole('button', { name: 'Cache customers' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(screen.getByRole('button', { name: 'Cache customers' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search title or item name' }), { target: { value: 'customer' } });
    expect(screen.queryByRole('button', { name: 'Avoid collecting the full sales dataset' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cache customers' })).toBeVisible();
  });

  it.each(['Approve', 'Reject'] as const)('confirms %s, forwards the comment, and displays the stub error', async (action) => {
    render(<App />);
    const panel = await openDetail();
    const comment = within(panel).getByRole('textbox', { name: /Comment/ });
    expect(comment).toHaveAttribute('maxLength', '500');
    fireEvent.change(comment, { target: { value: '  Please validate row counts.  ' } });
    expect(screen.getByText('31/500 characters')).toBeVisible();
    expect(panel.querySelector('code.language-python .hljs-string')).not.toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: action }));
    const confirm = screen.getByRole('dialog', { name: `${action} recommendation?` });
    expect(confirm).toHaveTextContent('Sales ETL');
    expect(confirm).toHaveTextContent('Avoid collecting the full sales dataset');
    fireEvent.click(within(confirm).getByRole('button', { name: `Confirm ${action.toLowerCase()}` }));
    expect(await screen.findByText('SRE thread notification returned HTTP 503')).toBeVisible();
    expect(action === 'Approve' ? approveRecommendation : rejectRecommendation).toHaveBeenCalledWith(
      recommendation().id, 'Please validate row counts.',
    );
    await waitFor(() => expect(getRecommendation).toHaveBeenCalledWith(recommendation().id));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Approve' })).toBeEnabled());
  });

  it.each([
    ['Approve', 'Approved'],
    ['Reject', 'Rejected'],
  ] as const)('shows a spinner only in the affected row during %s, then renders %s without action buttons', async (action, status) => {
    let resolve!: (value: DecisionResult) => void;
    const invoke = action === 'Approve' ? approveRecommendation : rejectRecommendation;
    vi.mocked(invoke).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(listRecommendations).mockResolvedValue([
      recommendation(), recommendation({ id: 'other', item_name: 'Other Notebook', title: 'Other recommendation' }),
    ]);
    vi.mocked(getRecommendation).mockResolvedValue(recommendation({ status, branch_name: 'sre/sales' }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const panel = await openDetail();
    fireEvent.click(within(panel).getByRole('button', { name: action }));
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${action.toLowerCase()}` }));
    expect(within(panel).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(within(panel).getByRole('status', { name: 'Submitting decision' })).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close recommendation' }));
    const row = screen.getByRole('button', { name: 'Avoid collecting the full sales dataset' }).closest('tr')!;
    expect(row).toHaveAttribute('aria-busy', 'true');
    expect(within(row).getByRole('status', { name: 'Submitting decision for Sales ETL' })).toBeVisible();
    const otherRow = screen.getByRole('button', { name: 'Other recommendation' }).closest('tr')!;
    expect(otherRow).toHaveAttribute('aria-busy', 'false');
    expect(within(otherRow).queryByRole('status')).toBeNull();
    expect(within(otherRow).getByText('Pending')).toBeVisible();
    await act(async () => resolve({ status, branch_name: 'sre/sales' }));
    expect(await screen.findByText(`Recommendation ${status.toLowerCase()}.`)).toBeVisible();
    await waitFor(() => expect(within(row).queryByRole('status')).toBeNull());
    expect(row).toHaveAttribute('aria-busy', 'false');
    expect(within(row).getByText(status)).toBeVisible();
    const decidedPanel = await openDetail();
    expect(within(decidedPanel).getByText('sre/sales')).toBeVisible();
    expect(within(decidedPanel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(decidedPanel).queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('shows an error without inventing a failure status and returns the pending controls to idle', async () => {
    vi.mocked(rejectRecommendation).mockRejectedValue(new Error('Notification failed'));
    vi.mocked(getRecommendation).mockResolvedValue(recommendation({ error_message: 'Notification failed in worker' }));
    render(<App />);
    const panel = await openDetail();
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    expect(await screen.findByText('Notification failed')).toBeVisible();
    expect(await screen.findByText('Notification failed in worker')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your decision' })).toBeVisible();
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Approve' })).toBeEnabled());
    expect(within(panel).getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(within(panel).getByText('Pending')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Submitting decision for Sales ETL' })).toBeNull();
  });

  it('keeps the successful decision non-actionable if the record refresh fails', async () => {
    vi.mocked(approveRecommendation).mockResolvedValue({ status: 'Approved' });
    vi.mocked(getRecommendation).mockRejectedValue(new Error('Read unavailable'));
    render(<App />);
    const panel = await openDetail();
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));
    expect(await screen.findByText('Recommendation approved.')).toBeVisible();
    await waitFor(() => expect(screen.getByText(/Could not refresh the decision record/)).toBeInTheDocument());
    expect(within(panel).getByText('Approved')).toBeVisible();
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel).queryByRole('status', { name: 'Submitting decision' })).toBeNull();
  });

  it.each(['Approved', 'Rejected'] as const)('does not allow decisions for %s', async (status) => {
    vi.mocked(listRecommendations).mockResolvedValue([recommendation({
      status, decided_by_name: 'Reviewer', decided_at: new Date(), decision_comment: 'Reviewed',
      commit_sha: 'a'.repeat(40), pr_url: 'https://github.com/example/repo/pull/1',
    })]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const panel = await openDetail();
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel).getByText('Reviewer')).toBeVisible();
    expect(within(panel).getByRole('link', { name: 'Open pull request' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows load errors honestly and supports manual refresh', async () => {
    vi.mocked(listRecommendations).mockRejectedValueOnce(new Error('Read permission denied'));
    render(<App />);
    expect(await screen.findByText(/Read permission denied/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('button', { name: 'Avoid collecting the full sales dataset' })).toBeVisible();
  });

  it('dismisses only the top dialog on Escape and restores the inbox after closing the panel', async () => {
    render(<App />);
    const panel = await openDetail();
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('dialog', { name: 'Approve recommendation?' });
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Approve recommendation?' })).toBeNull();
    expect(panel).toBeVisible();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refreshes every 15 seconds and clears its interval on unmount', async () => {
    vi.useFakeTimers();
    const view = render(<App />);
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(listRecommendations).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(listRecommendations).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(listRecommendations).toHaveBeenCalledTimes(2);
  });
});
