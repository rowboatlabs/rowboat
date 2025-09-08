import { NextResponse } from 'next/server';
import { templates } from '@/app/lib/project_templates';

export async function GET() {
  // The templates are now dynamically loaded from JSON files in the templates folder
  return NextResponse.json(templates);
}
