import { WEED_FILES } from '@gib/shared';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Push this PC's current data to the repo's `data` branch. The GitHub Pages build merges it in,
 * which matters for sources that block GitHub's servers (Dutchie). The branch only ever holds
 * one commit (force-pushed), so it doesn't bloat the repo.
 *
 * Runs after the PC's morning refresh when config.publishData is true, or by hand:
 *   npm run publish-data -w server
 */
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');

export function publishData(): { ok: boolean; message: string } {
  const out = mkdtempSync(join(tmpdir(), 'gib-data-'));
  const wt = mkdtempSync(join(tmpdir(), 'gib-wt-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: wt, stdio: 'pipe' }).toString();
  try {
    const exp = spawnSync(process.execPath, ['--import', 'tsx', resolve(here, 'export-static.ts'), out], {
      cwd: resolve(here, '..'), env: { ...process.env, SKIP_REFRESH: '1', PREV_URL: '', PC_DATA_URL: '' }, stdio: 'pipe',
    });
    if (exp.status !== 0) throw new Error(`export failed: ${exp.stderr?.toString().slice(-300)}`);
    rmSync(wt, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'add', '--detach', wt], { cwd: ROOT, stdio: 'pipe' });
    git('checkout', '--orphan', 'data-publish');
    git('rm', '-rf', '--quiet', '.');
    const files = ['beer.json', 'meta.json', ...Object.values(WEED_FILES) as string[]].filter((f) => existsSync(join(out, f)));
    for (const f of files) cpSync(join(out, f), join(wt, f));
    git('add', ...files);
    git('-c', 'user.name=Gibstaapp PC', '-c', 'user.email=gibstaapp-pc@users.noreply.github.com', 'commit', '--quiet', '-m', `PC data ${new Date().toISOString()}`);
    git('push', '--force', '--quiet', 'origin', 'HEAD:data');
    return { ok: true, message: 'PC data pushed to the data branch' };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, stdio: 'pipe' }); } catch { /* not created */ }
    try { execFileSync('git', ['branch', '-D', 'data-publish'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* none */ }
    rmSync(out, { recursive: true, force: true });
    rmSync(wt, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = publishData();
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
