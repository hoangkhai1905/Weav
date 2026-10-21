import { BrowserRouter, Link, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminShell } from './components/layout/AdminShell';
import { RequireAdmin } from './components/RequireAdmin';
import { useT } from './lib/i18n';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Protected() {
  return (
    <RequireAdmin>
      <AdminShell>
        <Outlet />
      </AdminShell>
    </RequireAdmin>
  );
}

// Sections that later tasks add land here until their pages exist.
function NotFoundPage() {
  const t = useT();
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">{t('notfound.title')}</h1>
      <p className="text-[13px] text-muted-foreground">{t('notfound.body')}</p>
      <Link to="/" className="text-[13px] font-medium text-accent-ink hover:underline">{t('notfound.back')}</Link>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protected />}>
            <Route index element={<OverviewPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
