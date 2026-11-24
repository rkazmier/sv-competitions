// #184: ponowienie actions/deploy-pages przy chwilowym błędzie „No artifacts named github-pages”.
// Zachowania runnera nie da się uruchomić lokalnie, więc test pilnuje struktury kroków w obu workflowach.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Step = Record<string, string>;

/** Kroki joba jako płaskie mapy kluczy najwyższego poziomu (wartości skalarne w jednej linii). */
function jobSteps(workflow: string, job: string): Step[] {
  const path = fileURLToPath(new URL(`../../../.github/workflows/${workflow}`, import.meta.url));
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.indexOf(`  ${job}:`);
  expect(start, `job ${job} w ${workflow}`).toBeGreaterThan(-1);
  const stepsAt = lines.indexOf('    steps:', start);
  const steps: Step[] = [];
  for (const line of lines.slice(stepsAt + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith('      ')) break; // koniec listy kroków (następny klucz joba lub następny job)
    const item = line.match(/^ {6}- ([\w-]+):\s*(.*)$/);
    const field = line.match(/^ {8}([\w-]+):\s*(.*)$/);
    if (item) steps.push({ [item[1]]: item[2] });
    else if (field && steps.length) steps[steps.length - 1][field[1]] = field[2];
  }
  return steps;
}

const cases = [
  { workflow: 'rebuild-site.yml', job: 'production', guard: "steps.release.outputs.sha != '' && " },
  { workflow: 'deploy-production.yml', job: 'frontend', guard: '' },
];

describe.each(cases)('#184 deploy-pages z ponowieniem — $workflow / $job', ({ workflow, job, guard }) => {
  const steps = jobSteps(workflow, job);
  const index = (id: string) => steps.findIndex((s) => s.id === id);
  const first = steps[index('deployment')];
  const retry = steps[index('deployment-retry')];
  const sleep = steps.find((s) => s.run === 'sleep 30');
  const warning = steps.find((s) => s.run?.includes('::warning::'));

  it('AC-1: pierwsza próba nie przerywa joba, po 30 s następuje druga próba', () => {
    expect(first.uses).toBe('actions/deploy-pages@v4');
    expect(first['continue-on-error']).toBe('true');
    expect(sleep?.if).toBe(`${guard}steps.deployment.outcome == 'failure'`);
    expect(retry.uses).toBe('actions/deploy-pages@v4');
    expect(retry.if).toBe(`${guard}steps.deployment.outcome == 'failure'`);
    expect(index('deployment')).toBeLessThan(steps.indexOf(sleep!));
    expect(steps.indexOf(sleep!)).toBeLessThan(index('deployment-retry'));
  });

  it('AC-1: ostrzeżenie, gdy wdrożenie przeszło dopiero przy ponowieniu', () => {
    expect(warning?.if).toBe(
      `${guard}steps.deployment.outcome == 'failure' && steps.deployment-retry.outcome == 'success'`,
    );
  });

  it('AC-2: porażka ponowienia kończy job błędem (brak continue-on-error)', () => {
    expect(retry['continue-on-error']).toBeUndefined();
    // Pierwsza próba to jedyny krok z continue-on-error w jobie.
    expect(steps.filter((s) => 'continue-on-error' in s)).toEqual([first]);
  });

  it('AC-3: po udanej pierwszej próbie ponowienie i oczekiwanie są pomijane', () => {
    for (const step of [sleep, retry, warning]) expect(step?.if).toContain("steps.deployment.outcome == 'failure'");
    expect(first.if ?? '').toBe(guard.replace(/ && $/, ''));
  });

  it('AC-4: nic nie odwołuje się do page_url tylko pierwszej próby', () => {
    const path = fileURLToPath(new URL(`../../../.github/workflows/${workflow}`, import.meta.url));
    expect(readFileSync(path, 'utf8')).not.toMatch(/steps\.deployment\.outputs/);
  });
});
