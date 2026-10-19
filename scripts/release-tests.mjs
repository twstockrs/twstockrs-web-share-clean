import {spawnSync} from 'node:child_process';
// TAP is the Node test runner's stable text report. Require its final counters,
// rather than treating an empty command or skipped suite as a successful check.
export function releaseTests(files, cwd = process.cwd()) {
    if (!files.length) throw Error('沒有找到測試，禁止空白通過。');
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000});
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error || result.status !== 0) throw Error('完整測試未通過。');
    const counters = {};
    for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
        const match = [...result.stdout.matchAll(new RegExp('^# ' + name + ' (\\d+)\\s*$', 'gm'))].at(-1);
        if (!match) throw Error('測試缺少完整計數，禁止視為通過。'); counters[name] = Number(match[1]);
    }
    if (!counters.tests || counters.pass !== counters.tests || ['fail', 'cancelled', 'skipped', 'todo'].some(name => counters[name])) throw Error('測試有略過、待辦、取消或失敗項目，禁止交付。');
    return counters;
}
