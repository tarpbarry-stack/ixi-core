#!/usr/bin/env python3
"""Capacity gates and one verified local source rollback for complete releases."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess

MIB = 1024 * 1024
ROLLBACK_NAME = re.compile(r'source-before-([a-f0-9]{40})-[0-9]{8}T[0-9]{6}Z')
MARKER = 'completed-release.json'
EXCLUDED = {'node_modules', '.git', 'backups'}


def measured(root, excluded=()):
    size, entries = 0, 0
    device = Path(root).lstat().st_dev
    def visit(path):
        nonlocal size, entries
        value = path.lstat()
        if value.st_dev != device:
            raise ValueError('Measured tree crosses a filesystem: ' + str(path))
        entries += 1
        if stat.S_ISREG(value.st_mode) or stat.S_ISLNK(value.st_mode):
            size += value.st_size
        elif stat.S_ISDIR(value.st_mode):
            for child in path.iterdir():
                if child.name not in excluded:
                    visit(child)
        else:
            raise ValueError('Unexpected special file in capacity estimate: ' + str(path))
    visit(Path(root))
    return size, entries


def capacity(app, database, working, phase='recovery', disk_usage=shutil.disk_usage, statvfs=os.statvfs):
    app, database, working = map(Path, (app, database, working))
    if len({p.stat().st_dev for p in [app, database, working]}) != 1:
        raise ValueError('Recovery capacity must be measured on the shared runtime filesystem')
    runtime_bytes, runtime_entries = measured(app, EXCLUDED)
    database_bytes = database.stat().st_size
    wal = Path(str(database) + '-wal')
    if wal.exists():
        database_bytes += wal.stat().st_size
    # Snapshot + worst-case incompressible bundle; runtime archive, restored
    # verification and packaging overhead. Never rely on today's compression ratio.
    required = 2 * database_bytes + 4 * runtime_bytes + 512 * MIB
    required_inodes = 3 * runtime_entries + 10000
    if phase == 'dependencies':
        dependencies = app / 'node_modules'
        dependency_bytes, dependency_entries = measured(dependencies) if dependencies.exists() else (0, 0)
        required += max(3 * dependency_bytes, 512 * MIB) + 64 * MIB
        required_inodes += max(2 * dependency_entries, 50000)
    available = disk_usage(working).free
    available_inodes = statvfs(working).f_favail
    result = {'ok': available >= required and available_inodes >= required_inodes,
              'phase': phase, 'availableBytes': available, 'requiredBytes': required,
              'availableInodes': available_inodes, 'requiredInodes': required_inodes}
    if not result['ok']:
        raise ValueError('Insufficient capacity before recovery/service interruption: ' + json.dumps(result))
    return result


def checked(root, target):
    root, target = Path(root), Path(target)
    if root.resolve() != root or target.parent != root or not ROLLBACK_NAME.fullmatch(target.name):
        raise ValueError('Rollback is outside the complete-release namespace')
    if target.is_symlink() or not target.is_dir() or target.resolve() != target or target.stat().st_dev != root.stat().st_dev:
        raise ValueError('Rollback root is redirected or crosses a filesystem')
    return target


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(MIB), b''):
            h.update(chunk)
    return h.hexdigest()


def source_inventory(root, target):
    target = checked(root, target)
    rollback = json.loads((target / 'rollback.json').read_text())
    if not isinstance(rollback, dict) or not rollback:
        raise ValueError('Rollback inventory is missing')
    expected = {key for key, existed in rollback.items() if existed} | {'rollback.json', 'recovery-receipt.json'}
    for name in expected:
        parts = Path(name)
        if parts.is_absolute() or '..' in parts.parts or parts.parts[0] in {'data', 'backups', 'node_modules'} or name.startswith('.env') or name in {'passport/passports.json', 'ixi-machine-state.json'}:
            raise ValueError('Rollback inventory contains runtime data or an unsafe path')
    records = {}
    def visit(path):
        if path.parent == target and path.name in {'node_modules', MARKER}:
            if path.is_symlink():
                raise ValueError('Rollback metadata/dependency root is redirected')
            return
        st = path.lstat()
        if st.st_dev != target.stat().st_dev or stat.S_ISLNK(st.st_mode):
            raise ValueError('Source rollback contains redirected content')
        if stat.S_ISDIR(st.st_mode):
            for child in sorted(path.iterdir()):
                visit(child)
        elif stat.S_ISREG(st.st_mode):
            relative = str(path.relative_to(target))
            if relative not in expected:
                raise ValueError('Unexpected content in source rollback: ' + relative)
            records[relative] = {'sha256': digest(path), 'bytes': st.st_size, 'mode': stat.S_IMODE(st.st_mode)}
        else:
            raise ValueError('Special file in source rollback')
    visit(target)
    if set(records) != expected:
        raise ValueError('Rollback source inventory is incomplete')
    receipt = json.loads((target / 'recovery-receipt.json').read_text())
    if receipt.get('ok') is not True or not receipt.get('versionId') or not re.fullmatch('[a-f0-9]{64}', receipt.get('sha256', '')):
        raise ValueError('Rollback has no verified recovery receipt')
    return records


def seal(root, target, commit):
    target = checked(root, target)
    if ROLLBACK_NAME.fullmatch(target.name)[1] != commit:
        raise ValueError('Completion commit does not match rollback directory')
    records = source_inventory(root, target)
    marker = {'schema': 'ixi.completed-source-rollback.v1', 'installedCommit': commit, 'files': records}
    with open(target / MARKER, 'x') as stream:
        json.dump(marker, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    return marker


def require_inactive(targets, proc=Path('/proc')):
    names = [str(target) for target in targets]
    for process in proc.iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            for link in [process / 'cwd', process / 'exe', *list((process / 'fd').iterdir())]:
                try:
                    path = os.readlink(link)
                    if any(path == name or path.startswith(name + '/') for name in names):
                        raise ValueError('Rollback is used by process ' + process.name)
                except (FileNotFoundError, ProcessLookupError):
                    pass
            command = (process / 'cmdline').read_bytes()
            if any(name.encode() in command for name in names):
                raise ValueError('Rollback is referenced by process ' + process.name)
        except (FileNotFoundError, ProcessLookupError):
            pass


def prune(root, current, verify_receipt, inactive=require_inactive, previous_commit=None):
    root, current = Path(root), Path(current)
    checked(root, current)
    targets, proofs, adopted = [], {}, []
    legacy_current = list(root.glob("source-before-" + str(previous_commit) + "-*")) if previous_commit else []
    for target in sorted(root.glob('source-before-*')):
        checked(root, target)
        marker = target / MARKER
        if marker.is_symlink():
            raise ValueError('Rollback completion record is redirected')
        if not marker.is_file():
            # One-time transition from the old complete deployer: only the sole
            # set for the manifest-verified runtime that this release replaced.
            if target not in legacy_current or len(legacy_current) != 1 or not (target / 'node_modules').is_dir():
                raise ValueError('Uncompleted rollback requires review; retained: ' + str(target))
            proof = {'schema': 'ixi.completed-source-rollback.v1', 'installedCommit': previous_commit,
                     'files': source_inventory(root, target)}
            adopted.append(target)
        else:
            proof = json.loads(marker.read_text())
        if proof.get('schema') != 'ixi.completed-source-rollback.v1' or proof.get('installedCommit') != ROLLBACK_NAME.fullmatch(target.name)[1]:
            raise ValueError('Unknown rollback completion record')
        if proof.get('files') != source_inventory(root, target):
            raise ValueError('Completed rollback changed; retained: ' + str(target))
        proofs[target] = proof
        if target != current:
            targets.append(target)
    # Verify the fresh checkpoint for this successful release. Older sealed sets
    # contain source only; their historical data recovery expires under S3 policy.
    verify_receipt(current / 'recovery-receipt.json')
    for target in adopted:
        verify_receipt(target / 'recovery-receipt.json')
    inactive(targets)
    for target in targets:
        if source_inventory(root, target) != proofs[target]['files']:
            raise ValueError('Rollback changed after recovery verification')
    reclaimed = sum(measured(target)[0] for target in targets)
    for target in targets:
        checked(root, target)
        shutil.rmtree(target)
    return {'ok': True, 'keptRollback': str(current), 'removedRollbacks': [str(x) for x in targets],
            'removedLogicalBytes': reclaimed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['capacity', 'seal', 'prune'])
    parser.add_argument('--app', default='/var/www/ix-core')
    parser.add_argument('--database', default='/var/lib/ixi-core/mos/ixi-aos.sqlite')
    parser.add_argument('--root', default='/var/backups/ixi-core-releases')
    parser.add_argument('--phase', choices=['recovery', 'dependencies'], default='recovery')
    parser.add_argument('--rollback')
    parser.add_argument('--commit')
    parser.add_argument('--previous-commit')
    args = parser.parse_args()
    if args.action == 'capacity':
        result = capacity(args.app, args.database, args.root, args.phase)
    elif args.action == 'seal':
        result = seal(args.root, args.rollback, args.commit)
        result = {'ok': True, 'sealedRollback': args.rollback, 'sourceFiles': len(result['files'])}
    else:
        def verify(receipt):
            subprocess.run(['node', str(Path(args.app) / 'ops/backup-to-s3.js'), '--verify-receipt', str(receipt)],
                           check=True, timeout=300, capture_output=True)
        result = prune(args.root, args.rollback, verify, previous_commit=args.previous_commit)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        raise SystemExit(1)
