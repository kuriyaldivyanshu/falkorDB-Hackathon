import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConfigurationError } from '@threadline/shared';

import { CONFIG_ENV_KEYS, DEFAULT_LIMITS, describeConfig, parseBackendConfig } from '../src/config.js';

test('parses defaults when no environment overrides are present', () => {
  const config = parseBackendConfig({ env: {}, cwd: '/tmp/example' });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 47821);
  assert.equal(config.dataDirectory, '/tmp/example/.threadline');
  assert.deepEqual(config.limits, DEFAULT_LIMITS);
});

test('applies declared overrides including an absolute data directory', () => {
  const config = parseBackendConfig({
    env: {
      [CONFIG_ENV_KEYS.host]: 'localhost',
      [CONFIG_ENV_KEYS.port]: '51234',
      [CONFIG_ENV_KEYS.dataDirectory]: '/var/tmp/threadline',
      [CONFIG_ENV_KEYS.maxEventListeners]: '4',
      [CONFIG_ENV_KEYS.maxRequestBodyBytes]: '2048',
      [CONFIG_ENV_KEYS.maxCommandTextLength]: '64',
      [CONFIG_ENV_KEYS.maxEventBacklogBytes]: '4096',
    },
  });

  assert.equal(config.host, 'localhost');
  assert.equal(config.port, 51234);
  assert.equal(config.dataDirectory, '/var/tmp/threadline');
  assert.deepEqual(config.limits, {
    maxEventListeners: 4,
    maxRequestBodyBytes: 2048,
    maxCommandTextLength: 64,
    maxEventBacklogBytes: 4096,
  });
});

test('ignores unrelated environment variables', () => {
  const config = parseBackendConfig({
    env: {
      AWS_SECRET_ACCESS_KEY: 'must-not-be-read',
      OPENAI_API_KEY: 'must-not-be-read',
      PATH: '/usr/bin',
    },
  });

  assert.deepEqual(config, parseBackendConfig({ env: {} }));
});

test('rejects a non-loopback bind address with an actionable hint', () => {
  const error = catchConfigurationError({ [CONFIG_ENV_KEYS.host]: '0.0.0.0' });

  assert.equal(error.issues.length, 1);
  assert.equal(error.issues[0]?.field, CONFIG_ENV_KEYS.host);
  assert.match(error.issues[0]?.problem ?? '', /loopback/);
  assert.match(error.issues[0]?.hint ?? '', /127\.0\.0\.1/);
});

test('reports every problem at once rather than failing on the first field', () => {
  const error = catchConfigurationError({
    [CONFIG_ENV_KEYS.host]: '10.0.0.5',
    [CONFIG_ENV_KEYS.port]: 'not-a-number',
    [CONFIG_ENV_KEYS.maxEventListeners]: '9999',
  });

  const fields = error.issues.map((issue) => issue.field);
  assert.deepEqual(fields, [
    CONFIG_ENV_KEYS.host,
    CONFIG_ENV_KEYS.port,
    CONFIG_ENV_KEYS.maxEventListeners,
  ]);
  for (const issue of error.issues) {
    assert.ok(issue.hint.length > 0, `${issue.field} must carry a fix hint`);
    assert.ok(issue.problem.length > 0);
  }
});

test('rejects a port outside the valid range', () => {
  const tooHigh = catchConfigurationError({ [CONFIG_ENV_KEYS.port]: '70000' });
  assert.match(tooHigh.issues[0]?.problem ?? '', /between 0 and 65535/);

  const negative = catchConfigurationError({ [CONFIG_ENV_KEYS.port]: '-1' });
  assert.match(negative.issues[0]?.problem ?? '', /between 0 and 65535/);
});

test('allows port 0 so a test can bind an ephemeral port', () => {
  assert.equal(parseBackendConfig({ env: { [CONFIG_ENV_KEYS.port]: '0' } }).port, 0);
});

test('rejects a limit outside its declared bounds', () => {
  const error = catchConfigurationError({ [CONFIG_ENV_KEYS.maxCommandTextLength]: '70000' });
  assert.match(error.issues[0]?.problem ?? '', /between 1 and 65536/);
});

test('accepts a data directory that does not exist yet', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threadline-absent-'));
  try {
    const config = parseBackendConfig({
      env: { [CONFIG_ENV_KEYS.dataDirectory]: join(directory, 'not-created-yet') },
    });
    assert.equal(config.dataDirectory, join(directory, 'not-created-yet'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects a data directory that points at a file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'threadline-file-'));
  const file = join(directory, 'not-a-directory');
  writeFileSync(file, 'contents');
  try {
    const error = catchConfigurationError({ [CONFIG_ENV_KEYS.dataDirectory]: file });
    assert.equal(error.issues[0]?.field, CONFIG_ENV_KEYS.dataDirectory);
    assert.match(error.issues[0]?.problem ?? '', /not a directory/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('configuration errors never repeat the submitted value', () => {
  const secretLookingValue = 'sk-super-secret-value';
  const error = catchConfigurationError({
    [CONFIG_ENV_KEYS.host]: secretLookingValue,
    [CONFIG_ENV_KEYS.port]: secretLookingValue,
  });

  const rendered = `${error.message}\n${error.format()}`;
  assert.ok(!rendered.includes(secretLookingValue));
});

test('describeConfig exposes an allowlist that cannot grow into a credential leak', () => {
  const summary = describeConfig(
    parseBackendConfig({ env: { [CONFIG_ENV_KEYS.host]: '127.0.0.1', [CONFIG_ENV_KEYS.port]: '0' } }),
  );

  assert.deepEqual(Object.keys(summary).sort(), [
    'dataDirectory',
    'host',
    'limits',
    'port',
  ]);
  assert.deepEqual(Object.keys(summary.limits).sort(), [
    'maxCommandTextLength',
    'maxEventBacklogBytes',
    'maxEventListeners',
    'maxRequestBodyBytes',
  ]);
  for (const key of [...Object.keys(summary), ...Object.keys(summary.limits)]) {
    assert.doesNotMatch(key, /(secret|token|password|authorization|credential|key)/i);
  }
});

function catchConfigurationError(env: Record<string, string>): ConfigurationError {
  try {
    parseBackendConfig({ env });
  } catch (error) {
    assert.ok(error instanceof ConfigurationError, `expected ConfigurationError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected parseBackendConfig to reject this configuration');
}