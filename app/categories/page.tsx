import Link from 'next/link'
import CategoryManager from '@/components/CategoryManager'
import { loadCategoriesWithStats } from '@/lib/categories'

export const dynamic = 'force-dynamic'

export default function CategoriesPage() {
  const stats = loadCategoriesWithStats()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">分类</h1>
        <Link
          href="/rules"
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm rounded-md"
        >
          分类规则
        </Link>
      </div>

      <CategoryManager initialStats={stats} />
    </div>
  )
}
