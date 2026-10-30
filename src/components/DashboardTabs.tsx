import Link from 'next/link';

const tabs = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/history', label: 'Trade history' },
  { href: '/dashboard/watchlist', label: 'Watchlist' },
];

export function DashboardTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Dashboard pages" className="mb-8 flex gap-2 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const isActive = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm transition-colors ${
              isActive
                ? 'border-primary font-medium text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
