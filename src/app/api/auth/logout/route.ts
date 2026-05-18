import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({})
  res.cookies.delete('session')
  return res
}
