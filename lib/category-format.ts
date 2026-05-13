export function categoryGroupName(category: string | null | undefined): string {
  if (!category) return 'Uncategorized'
  const parts = category.split(':')
  if ((parts[0] === 'Expenses' || parts[0] === 'Income' || parts[0] === 'Equity') && parts[1]) {
    return parts[1]
  }
  return parts[0] || 'Other'
}

export function categoryColorKey(category: string | null | undefined): string {
  const group = categoryGroupName(category)
  if (category?.startsWith('Transfer:')) return 'Transfer'
  if (category?.startsWith('Income:')) return 'Income'
  if (category?.startsWith('Equity:')) return 'Equity'
  return group
}
