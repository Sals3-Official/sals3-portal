import { describe, expect, it } from 'vitest';
import {
  ALLOW_REMOTE_ENV_VAR,
  classifyDatabaseTarget,
  decideRemoteWrite,
} from './remote-write-guard';

/**
 * The guard is only worth having if it fails closed. Most of these cases are
 * about what it refuses, and about never printing the password it is guarding.
 */

const LOCAL = 'postgresql://sals3_app:hunter2@localhost:5432/sals3';
const NEON =
  'postgresql://user:s3cr3t@ep-cool-name-123.ap-southeast-2.aws.neon.tech/sals3';

function decide(connectionString: string | undefined, allowRemote?: string) {
  return decideRemoteWrite({
    command: 'db:migrate',
    connectionString,
    allowRemote,
  });
}

describe('classifyDatabaseTarget', () => {
  it.each(['localhost', '127.0.0.1', '0.0.0.0'])(
    'treats %s as local',
    (host) => {
      const target = classifyDatabaseTarget(
        `postgresql://u:p@${host}:5432/sals3`,
      );

      expect(target.kind).toBe('LOCAL');
    },
  );

  it('treats a Neon host as remote', () => {
    const target = classifyDatabaseTarget(NEON);

    expect(target).toMatchObject({
      kind: 'REMOTE',
      host: 'ep-cool-name-123.ap-southeast-2.aws.neon.tech',
      database: 'sals3',
    });
  });

  it('treats any unrecognised host as remote rather than assuming local', () => {
    // The default must be "remote" so a host nobody anticipated fails closed.
    expect(classifyDatabaseTarget('postgresql://u:p@db.internal/x').kind).toBe(
      'REMOTE',
    );
  });

  it('reports a missing or blank connection string distinctly', () => {
    expect(classifyDatabaseTarget(undefined).kind).toBe('MISSING');
    expect(classifyDatabaseTarget('').kind).toBe('MISSING');
    expect(classifyDatabaseTarget('   ').kind).toBe('MISSING');
  });

  it('reports an unparseable string distinctly instead of calling it remote', () => {
    // Different problem, different fix - the operator should be told the URL is
    // malformed, not led to believe they are pointed at production.
    expect(classifyDatabaseTarget('not a url').kind).toBe('UNPARSEABLE');
  });
});

describe('decideRemoteWrite', () => {
  it('allows a local target', () => {
    expect(decide(LOCAL)).toMatchObject({ allowed: true, reason: 'LOCAL' });
  });

  it('BLOCKS a remote target by default', () => {
    expect(decide(NEON)).toMatchObject({ allowed: false, reason: 'REMOTE' });
  });

  it('allows a remote target only for the exact opt-in value', () => {
    expect(decide(NEON, '1')).toMatchObject({
      allowed: true,
      reason: 'REMOTE_EXPLICITLY_ALLOWED',
    });
  });

  it.each(['0', 'true', 'yes', 'TRUE', '', ' 1', '1 '])(
    'still blocks when the opt-in is %o rather than exactly "1"',
    (value) => {
      expect(decide(NEON, value)).toMatchObject({ allowed: false });
    },
  );

  it('blocks a missing connection string', () => {
    expect(decide(undefined)).toMatchObject({
      allowed: false,
      reason: 'MISSING',
    });
  });

  it('blocks an unparseable connection string rather than guessing', () => {
    expect(decide('postgres@@@')).toMatchObject({
      allowed: false,
      reason: 'UNPARSEABLE',
    });
  });

  it('never prints the password, in any outcome', () => {
    const messages = [
      decide(LOCAL).message,
      decide(NEON).message,
      decide(NEON, '1').message,
      decide('postgres@@@').message,
    ];

    messages.forEach((message) => {
      expect(message).not.toContain('hunter2');
      expect(message).not.toContain('s3cr3t');
      expect(message).not.toContain('postgresql://');
    });
  });

  it('names the blocked host, database, command, and the way out', () => {
    const { message } = decide(NEON);

    expect(message).toContain('db:migrate');
    expect(message).toContain('ep-cool-name-123.ap-southeast-2.aws.neon.tech');
    expect(message).toContain('sals3');
    expect(message).toContain(ALLOW_REMOTE_ENV_VAR);
  });
});
