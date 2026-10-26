/** Loads the live data for a job (the same loaders the site uses) and builds the post content. */
import type { createRepo } from '../../src/lib/db/repo';
import type { Job } from '../../src/lib/social/gen/plan';
import { buildCreditGoneReel, buildUtilityPaybackCarousel, buildUtilityPaybackReel } from '../../src/lib/social/gen/templates';
import type { GeneratedPost } from '../../src/lib/social/gen/types';
import { loadUtilityPageData } from '../../src/lib/utility/load';
import { UTILITY_PAGES } from '../../src/lib/utility/pages';
import type { UtilityPageVm } from '../../src/lib/utility/view';

export type Repo = ReturnType<typeof createRepo>;

async function loadVm(repo: Repo, slug: string): Promise<UtilityPageVm> {
  const data = await loadUtilityPageData(slug, repo);
  if (data.kind !== 'ok') throw new Error(`${slug}: utility data unavailable (${data.error?.kind ?? 'missing utility row'}${data.error ? `: ${data.error.message}` : ''})`);
  return data.vm;
}

export async function buildPost(job: Job, repo: Repo): Promise<GeneratedPost> {
  switch (job.template) {
    case 'utility-payback-reel':
      return buildUtilityPaybackReel(await loadVm(repo, job.target));
    case 'utility-payback-carousel':
      return buildUtilityPaybackCarousel(await loadVm(repo, job.target));
    case 'credit-gone-reel': {
      const state = job.target.toUpperCase() as 'FL' | 'CA';
      const vms = await Promise.all(UTILITY_PAGES.filter((p) => p.state === state).map((p) => loadVm(repo, p.slug)));
      return buildCreditGoneReel(state, vms);
    }
    default:
      throw new Error(`unknown template: ${job.template}`);
  }
}
