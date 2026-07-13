import { AppShell } from "@/components/app-shell";
import { getBusinesses } from "@/lib/businesses-query";

export default async function HomePage() {
  const businesses = await getBusinesses();

  if (businesses.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-vezzt-50 px-6">
        <div className="max-w-lg rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-vezzt-950">
            No businesses loaded from Supabase
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Run the demo seed, then refresh this page.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-neutral-100 p-3 text-left text-xs text-neutral-700">
            npm run db:seed-sql{"\n"}npm run verify:supabase
          </pre>
        </div>
      </div>
    );
  }

  return <AppShell businesses={businesses} />;
}
