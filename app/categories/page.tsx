import Link from 'next/link'
import CategoryManager from '@/components/CategoryManager'
import { loadCategoriesWithStats } from '@/lib/categories'

export const dynamic = 'force-dynamic'

export default function CategoriesPage() {
  const stats = loadCategoriesWithStats()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Ledger Account Taxonomy</h1>
          <p className="mt-1 text-sm text-slate-500">
            Classification reference for ledger prep and export cleanup.
          </p>
        </div>
        <Link
          href="/rules"
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm rounded-md"
        >
          Ledger account rules
        </Link>
      </div>

      <CategoryManager initialStats={stats} />
    </div>
  )
}
