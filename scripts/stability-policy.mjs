// Gates are fixed before the run; a short smoke test can never earn long-run acceptance.
export const stabilityLimits = Object.freeze({
    minimum_ms: 60 * 60_000,
    rss_bytes: 2 * 1024 ** 3,
    quiet_growth_bytes: 256 * 1024 ** 2,
    quiet_slope_bytes_per_minute: 4 * 1024 ** 2,
    health_p95_ms: 750,
    health_max_ms: 5000,
    request_p95_ms: 8000,
});

export class Latencies {
    // Fixed memory, including failed requests. Percentiles are upper bounds in whole milliseconds.
    buckets = new Uint32Array(60_002);
    count = 0;
    failed = 0;
    max_ms = 0;
    bytes = 0;
    add(ms, bytes = 0, failed = false) {
        if (!Number.isFinite(ms) || ms < 0 || !Number.isSafeInteger(bytes) || bytes < 0) throw Error('Invalid latency sample');
        this.buckets[Math.min(60_001, Math.ceil(ms))]++;
        this.count++;
        this.failed += Number(failed);
        this.max_ms = Math.max(ms, this.max_ms);
        this.bytes += bytes;
    }
    percentile(p) {
        if (!this.count) return null;
        let n = 0;
        for (let i = 0; i < this.buckets.length; i++) {
            n += this.buckets[i];
            if (n >= Math.ceil(this.count * p)) return i === 60_001 ? Infinity : i;
        }
    }
    summary() { return { count: this.count, failed: this.failed, p50_ms: this.percentile(.5), p95_ms: this.percentile(.95), max_ms: this.max_ms, bytes: this.bytes }; }
}

export function median(values) {
    if (!values.length || values.some(v => !Number.isFinite(v))) throw Error('Missing or invalid samples');
    const a = [...values].sort((x, y) => x - y), n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function memoryTrend(windows) {
    if (windows.length < 2) return { sufficient: false };
    if (windows.some((v, i) => !Number.isFinite(v.rss_bytes) || v.rss_bytes <= 0 || !Number.isFinite(v.elapsed_ms) || i && v.elapsed_ms <= windows[i - 1].elapsed_ms || v.instance !== windows[0].instance)) throw Error('Memory windows must belong to one uninterrupted process');
    const x = windows.map(v => v.elapsed_ms / 60_000), y = windows.map(v => v.rss_bytes);
    const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length;
    const slope = x.reduce((n, v, i) => n + (v - mx) * (y[i] - my), 0) / x.reduce((n, v) => n + (v - mx) ** 2, 0);
    return { sufficient: true, windows: windows.length, elapsed_ms: windows.at(-1).elapsed_ms - windows[0].elapsed_ms, growth_bytes: y.at(-1) - y[0], slope_bytes_per_minute: slope };
}

export function evaluateStability(r) {
    const l = stabilityLimits, trend = memoryTrend(r.quiet_windows);
    const required = { daily: 400, weekly: 100, sector: 100, playback: 20, library_edit: 30, library_restore: 5, exports: 20, context: 10 };
    const checks = {
        real_hour: r.mode === 'long' && r.elapsed_ms >= l.minimum_ms,
        parallel_warmup_completed: r.warmup?.elapsed_ms>=300_000&&r.warmup?.client_cycles?.length===5&&r.warmup.client_cycles.every(n=>Number.isInteger(n)&&n>=20),
        same_serving_instance: r.instances.length === 1,
        no_unexpected_failures: r.failures.length === 0,
        five_clients_active: r.client_cycles.length === 5 && r.client_cycles.every(n => n >= 100),
        operation_coverage: Object.entries(required).every(([k, n]) => r.coverage[k] >= n),
        health_coverage: r.health.count >= 1500,
        health_latency: r.health.failed === 0 && r.health.p95_ms !== null && r.health.p95_ms < l.health_p95_ms && r.health.max_ms < l.health_max_ms,
        request_latency: ['analyses','playback','library/edit','library/restore','exports/authorize','analysis-context'].every(k => r.requests[k]?.count > 0) && Object.values(r.requests).every(v => v.failed === 0 && v.p95_ms !== null && v.p95_ms < l.request_p95_ms),
        rss_bounded: r.samples.length >= 100 && r.samples.every(v => v.rss_bytes > 0 && v.rss_bytes < l.rss_bytes),
        monitoring_healthy: r.samples.length >= 100 && r.samples.every(v => v.monitoring?.available === true && v.monitoring.stale === false && v.monitoring.fault === null && v.monitoring.active_incidents === 0),
        quiet_memory_bounded: trend.sufficient && trend.windows >= 7 && trend.elapsed_ms >= l.minimum_ms && trend.growth_bytes <= l.quiet_growth_bytes && trend.slope_bytes_per_minute <= l.quiet_slope_bytes_per_minute,
        no_unexpected_queue_errors: !!r.final_queue && ['failed', 'timed_out', 'rejected', 'cancelled', 'running', 'queued'].every(k => r.final_queue[k] === 0) && r.final_queue.completed >= r.coverage.daily + r.coverage.weekly + r.coverage.sector + r.coverage.playback,
        live_backup_and_restore: r.backups.length >= 4 && r.backups.every(v => v.status === 'success') && r.restore?.passed === true,
        recovery: ['restart', 'child_crash', 'manager_restart'].every(k => r.recovery?.[k]?.passed === true),
        sqlite_integrity_and_bounds: r.integrity?.passed === true,
        clean_shutdown: r.clean_shutdown === true,
    };
    return { status: Object.values(checks).every(Boolean) ? 'passed' : r.mode === 'smoke' && r.failures.length === 0 && r.restore?.passed && r.integrity?.passed && r.clean_shutdown && Object.values(r.recovery || {}).every(v => v.passed) ? 'smoke_passed' : 'failed', checks, memory_trend: trend };
}
