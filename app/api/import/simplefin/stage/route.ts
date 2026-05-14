import { NextResponse } from 'next/server'
import { SimpleFinStageError, stageConfiguredSimpleFin } from '@/lib/sync/simplefin-stage'

export async function POST(): Promise<NextResponse> {
  try {
    const result = await stageConfiguredSimpleFin()

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    if (error instanceof SimpleFinStageError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ success: false, error: 'SimpleFIN stage import failed' }, { status: 500 })
  }
}
