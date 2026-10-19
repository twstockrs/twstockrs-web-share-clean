import { deploymentPreflight } from './deliveryProtocol';
const args = process.argv.slice(2), values: Record<string, string> = {};
try {
    for (let i = 0; i < args.length; i += 2) {
        if (!['--release', '--report', '--root'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw Error('只接受--release、--report及選用的--root。');
        values[args[i]] = args[i + 1];
    }
    if (!values['--release']) throw Error('請提供--release發布包。');
    console.log(JSON.stringify(deploymentPreflight(values['--release'], values['--report'], values['--root']), null, 2));
} catch (error) {
    console.error(JSON.stringify({status: 'failed', message: error instanceof Error ? error.message : '部署前檢查失敗。'}));
    process.exitCode = 1;
}
