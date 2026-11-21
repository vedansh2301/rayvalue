import type { APIRoute } from 'astro';
import { renderRobots } from '../lib/seo/robots';

// Prerendered at build from src/lib/seo/robots.ts (replaces public/robots.txt).
export const GET: APIRoute = () => new Response(renderRobots(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
