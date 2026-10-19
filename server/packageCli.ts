import { writeRelease } from './hostProtocol';
const args = process.argv.slice(2), v: Record<string, string> = {};
for (let n = 0; n < args.length; n += 2) {
    if (!['--staging', '--out', '--id'].includes(args[n]) || !args[n + 1] || v[args[n]])
        throw Error('發布包參數不適用。');
    v[args[n]] = args[n + 1];
}
try {
    console.log(JSON.stringify(writeRelease(v['--staging'], v['--out'], v['--id'])));
}
catch (error) {
    console.error(error instanceof Error ? error.message : '發布包未完成。');
    process.exitCode = 1;
}
