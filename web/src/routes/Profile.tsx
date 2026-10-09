/** Public verifier profile. Reads only public endpoints — no balances owed, no session data. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { explorerAccountUrl, looksLikeStellarAddress, percent, shortId, type LeaderboardRow, type Reputation, type StakeBalance } from '@plumbline/core';
import { CopyButton, Empty, PageHead, Panel, Stat } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { config } from '../lib/config.ts';
import { useDocumentTitle } from '../lib/hooks.ts';
import { useI18n } from '../lib/i18n/index.tsx';

export default function Profile({ address }: { address: string }) {
  const { fmtUsdc } = useI18n();
  useDocumentTitle(`Verifier ${shortId(address)}`);
  const [rep, setRep] = useState<Reputation | null>(null);
  const [stake, setStake] = useState<StakeBalance | null>(null);
  const [rank, setRank] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!address) return;
    Promise.allSettled([api.workers.reputation(address), api.workers.stake(address), api.leaderboard()]).then(([r, s, b]) => {
      if (r.status === 'fulfilled') setRep(r.value);
      if (s.status === 'fulfilled') setStake(s.value);
      const board: LeaderboardRow[] = b.status === 'fulfilled' ? b.value : [];
      const idx = board.findIndex((x) => x.workerId === address);
      setRank(idx >= 0 ? idx + 1 : null);
      if (r.status === 'rejected' && s.status === 'rejected') setErr(errorMessage(r.reason));
    });
  }, [address]);

  if (!address) {
    return (
      <div className="wrap page">
        <Empty>No verifier address given.</Empty>
      </div>
    );
  }

  const total = rep?.totalAnswers ?? rep?.total ?? 0;
  const ratio = rep?.matchRatio ?? (total ? (rep?.matched ?? 0) / total : null);

  return (
    <div className="wrap page">
      <PageHead eyebrow="Verifier profile" title={shortId(address, 8, 8)} sub={<span className="mono break">{address}</span>}>
        <CopyButton text={`${location.origin}/v/${address}`} label="Copy profile link" size="md" />
        {looksLikeStellarAddress(address) && (
          <a className="btn ghost" href={explorerAccountUrl(address, config.network)} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
        )}
      </PageHead>
      {err ? (
        <Empty>Failed to load: {err}</Empty>
      ) : (
        <Panel>
          <div className="grid cols-4">
            <Stat signal label="Rank" value={rank === undefined ? '…' : rank === null ? '—' : `#${rank}`} note={rank === null ? 'Not ranked yet — only established verifiers appear.' : undefined} />
            <Stat label="Agreement" value={percent(ratio)} note={`${rep?.matched ?? 0} of ${total}`} />
            <Stat label="Answers" value={total} />
            <Stat label="Bond" value={fmtUsdc(stake?.stake ?? 0)} />
          </div>
        </Panel>
      )}
      <p style={{ marginTop: 24 }}>
        <Link to="/standings">← All standings</Link>
      </p>
    </div>
  );
}
