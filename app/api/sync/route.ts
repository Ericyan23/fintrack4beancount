import { NextResponse } from 'next/server'
import { SimpleFinStageError, stageConfiguredSimpleFin } from '@/lib/sync/simplefin-stage'

export async function POST(): Promise<NextResponse> {
  try {
    const result = await stageConfiguredSimpleFin()
    return NextResponse.json({
      success: true,
      newCount: result.staged,
      compatibilityMode: 'staged',
      promoted: false,
      ...result,
    })
  } catch (err) {
    if (err instanceof SimpleFinStageError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    return NextResponse.json({ success: false, error: 'SimpleFIN stage import failed' }, { status: 500 })
  }
}
