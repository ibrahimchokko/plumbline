import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import { Shell } from './components/Shell.tsx';
import { Button, Empty } from './components/ui.tsx';
import { I18nProvider } from './lib/i18n/index.tsx';
import { SessionProvider } from './lib/session.tsx';

// Each screen is its own chunk: a visitor reading the landing page never
// downloads the control room, and nobody downloads the Stellar SDK until a
// screen actually needs to build a transaction.
const Home = lazy(() => import('./routes/Home.tsx'));
const Verify = lazy(() => import('./routes/Verify.tsx'));
const Ask = lazy(() => import('./routes/Ask.tsx'));
const Standings = lazy(() => import('./routes/Standings.tsx'));
const Profile = lazy(() => import('./routes/Profile.tsx'));
const Health = lazy(() => import('./routes/Health.tsx'));
const Account = lazy(() => import('./routes/Account.tsx'));
const Control = lazy(() => import('./routes/control/Control.tsx'));
const LiveWire = lazy(() => import('./routes/LiveWire.tsx'));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="wrap page">
        <Empty>
          <h2>Something broke on this screen</h2>
          <p className="muted">{this.state.error.message}</p>
          <Button onClick={() => location.reload()}>Reload</Button>
        </Empty>
      </div>
    );
  }
}

function NotFound() {
  return (
    <div className="wrap page">
      <Empty>
        <h2>Nothing hangs here.</h2>
        <p>
          <a href="/">Back to the overview</a>
        </p>
      </Empty>
    </div>
  );
}

/** Old Arbiter links (?address=… on worker.html) keep working. */
function ProfileRoute() {
  const { address } = useParams();
  const fromQuery = new URLSearchParams(location.search).get('address');
  return <Profile address={address ?? fromQuery ?? ''} />;
}

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <Shell>
            <Boundary>
              <Suspense fallback={<div className="wrap page faint">Loading…</div>}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/verify" element={<Verify />} />
                  <Route path="/ask" element={<Ask />} />
                  <Route path="/standings" element={<Standings />} />
                  <Route path="/v/:address" element={<ProfileRoute />} />
                  <Route path="/health" element={<Health />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/control/*" element={<Control />} />
                  <Route path="/live" element={<LiveWire />} />
                  {/* legacy multi-page URLs from the original app */}
                  <Route path="/index.html" element={<Verify />} />
                  <Route path="/dashboard.html" element={<Ask />} />
                  <Route path="/leaderboard.html" element={<Standings />} />
                  <Route path="/worker.html" element={<ProfileRoute />} />
                  <Route path="/status.html" element={<Health />} />
                  <Route path="/customer.html" element={<Account />} />
                  <Route path="/admin.html" element={<Control />} />
                  <Route path="/demo.html" element={<LiveWire />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </Boundary>
          </Shell>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}
