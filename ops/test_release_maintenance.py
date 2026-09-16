import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).with_name('release-maintenance.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.backups = self.root / 'backups'
        self.backups.mkdir()

    def rollback(self, n, seal=True):
        commit = str(n) * 40
        target = self.backups / ('source-before-' + commit + '-20260916T00000' + str(n) + 'Z')
        target.mkdir()
        (target / 'index.js').write_text('old source ' + str(n))
        (target / 'rollback.json').write_text(json.dumps({'index.js': True}))
        (target / 'recovery-receipt.json').write_text(json.dumps({'ok': True, 'versionId': 'immutable-version', 'sha256': 'a' * 64}))
        (target / 'node_modules').mkdir()
        (target / 'node_modules' / 'generated').write_bytes(b'x' * 1024)
        if seal:
            m.seal(self.backups, target, commit)
        return target

    def prune(self, current, verify=lambda receipt: None, inactive=lambda targets: None):
        return m.prune(self.backups, current, verify, inactive)

    def test_repeated_releases_keep_exactly_one_local_rollback(self):
        unrelated = self.backups / 'capacity-cleanup-evidence'
        unrelated.mkdir()
        for n in [1, 2, 3]:
            current = self.rollback(n)
            result = self.prune(current)
            self.assertEqual(list(self.backups.glob('source-before-*')), [current])
            self.assertEqual(result['keptRollback'], str(current))
            self.assertTrue(unrelated.exists())

    def test_failed_fresh_recovery_verification_preserves_every_set(self):
        old, current = self.rollback(1), self.rollback(2)
        def reject(receipt):
            raise ValueError('S3 checksum mismatch')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.prune(current, verify=reject)
        self.assertTrue(old.exists())
        self.assertTrue(current.exists())

    def test_unfinished_or_changed_rollback_blocks_all_deletion(self):
        old, unknown, current = self.rollback(1), self.rollback(2, seal=False), self.rollback(3)
        with self.assertRaisesRegex(ValueError, 'Uncompleted'):
            self.prune(current)
        self.assertTrue(old.exists())
        m.seal(self.backups, unknown, '2' * 40)
        (unknown / 'index.js').write_text('changed after success')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.prune(current)
        self.assertTrue(old.exists())

    def test_changes_during_recovery_readback_block_deletion(self):
        old, current = self.rollback(1), self.rollback(2)
        def mutate(receipt):
            (old / 'index.js').write_text('concurrent edit')
        with self.assertRaisesRegex(ValueError, 'changed after'):
            self.prune(current, verify=mutate)
        self.assertTrue(old.exists())

    def test_prior_installed_legacy_set_requires_exact_commit_and_both_receipts(self):
        old, current = self.rollback(1, seal=False), self.rollback(2)
        verified = []
        with self.assertRaisesRegex(ValueError, 'Uncompleted'):
            m.prune(self.backups, current, verified.append, lambda paths: None, previous_commit='3' * 40)
        self.assertTrue(old.exists())
        result = m.prune(self.backups, current, verified.append, lambda paths: None, previous_commit='1' * 40)
        self.assertEqual(set(verified), {old / 'recovery-receipt.json', current / 'recovery-receipt.json'})
        self.assertEqual(result['removedRollbacks'], [str(old)])
        self.assertTrue(current.exists())

    def test_in_use_rollback_is_preserved(self):
        old, current = self.rollback(1), self.rollback(2)
        proc = self.root / 'proc'
        process = proc / '4321'
        (process / 'fd').mkdir(parents=True)
        (process / 'cwd').symlink_to(old, target_is_directory=True)
        (process / 'cmdline').write_bytes(b'node\0server.js')
        with self.assertRaisesRegex(ValueError, 'used by process'):
            self.prune(current, inactive=lambda roots: m.require_inactive(roots, proc))
        self.assertTrue(old.exists())

    def test_symlink_roots_and_runtime_data_cannot_be_retired(self):
        old, current = self.rollback(1), self.rollback(2)
        redirected = self.root / 'redirected'
        redirected.symlink_to(self.backups, target_is_directory=True)
        with self.assertRaises(ValueError):
            m.checked(redirected, redirected / old.name)
        shutil.rmtree(old / 'node_modules')
        (old / 'node_modules').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'redirected'):
            self.prune(current)
        (old / 'node_modules').unlink()
        (old / 'passport').mkdir()
        (old / 'passport/passports.json').write_text('business data')
        with self.assertRaisesRegex(ValueError, 'Unexpected content'):
            self.prune(current)
        self.assertTrue((old / 'passport/passports.json').exists())

    def capacity_fixture(self):
        app = self.root / 'app'
        app.mkdir()
        (app / 'index.js').write_bytes(b'x' * 100)
        (app / '.env').write_bytes(b'y' * 100)
        (app / 'node_modules').mkdir()
        (app / 'node_modules' / 'package').write_bytes(b'z' * 1000)
        db = self.root / 'db.sqlite'
        db.write_bytes(b'z' * 10000)
        return app, db

    def test_capacity_rejects_low_bytes_and_inodes(self):
        app, db = self.capacity_fixture()
        with self.assertRaisesRegex(ValueError, 'Insufficient capacity'):
            m.capacity(app, db, self.backups, disk_usage=lambda p: types.SimpleNamespace(free=1))
        with self.assertRaisesRegex(ValueError, 'Insufficient capacity'):
            m.capacity(app, db, self.backups, statvfs=lambda p: types.SimpleNamespace(f_favail=0))

    def test_capacity_accounts_for_wal_staging_and_incompressible_backup(self):
        app, db = self.capacity_fixture()
        disk = lambda p: types.SimpleNamespace(free=100 * 1024 ** 3)
        inodes = lambda p: types.SimpleNamespace(f_favail=10000000)
        recovery = m.capacity(app, db, self.backups, disk_usage=disk, statvfs=inodes)
        Path(str(db) + '-wal').write_bytes(b'w' * 100)
        with_wal = m.capacity(app, db, self.backups, disk_usage=disk, statvfs=inodes)
        staging = m.capacity(app, db, self.backups, 'dependencies', disk_usage=disk, statvfs=inodes)
        self.assertEqual(with_wal['requiredBytes'] - recovery['requiredBytes'], 200)
        self.assertGreater(staging['requiredBytes'], with_wal['requiredBytes'])
        self.assertGreaterEqual(recovery['requiredBytes'], 2 * db.stat().st_size + 512 * m.MIB)

    def test_measured_tree_does_not_follow_symlinks(self):
        directory = self.root / 'generated'
        directory.mkdir()
        (directory / 'outside').symlink_to('/etc', target_is_directory=True)
        self.assertLess(m.measured(directory)[0], 100)


class ReleaseExitTests(unittest.TestCase):
    def scenario(self, state):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            app, backups, stages, commands = [root / x for x in ['app', 'backups', 'stages', 'bin']]
            for p in [app, backups, stages, commands]:
                p.mkdir()
            (app / 'passport').mkdir()
            for p in [app / 'index.js', app / 'passport/passports.json', app / '.ixi-release.json', root / 'db']:
                p.write_text('{}')
            for command in ['sudo', 'systemctl', 'curl', 'chown', 'node', 'python3']:
                code = '#!/bin/sh\nprintf "%s\\n" "' + command + ' $*" >> "$TEST_LOG"\n'
                if command == 'python3' and state == 'rollback-failed':
                    code += 'exit 1\n'
                else:
                    code += 'exit 0\n'
                (commands / command).write_text(code)
                (commands / command).chmod(0o755)
            source = Path(__file__).with_name('deploy-complete-runtime.sh').read_text().split('run_stage git init -q')[0]
            source = source.replace('APP=/var/www/ix-core', 'APP=' + str(app))
            source = source.replace('/var/lib/ixi-core/mos/ixi-aos.sqlite', str(root / 'db'))
            source = source.replace('/var/backups/ixi-core-releases', str(backups))
            source = source.replace('/var/lock/ixi-core-production.lock', str(root / 'production.lock'))
            source = source.replace('/var/tmp/ixi-complete-release-', str(stages / 'ixi-complete-release-'))
            source += '\nprintf generated > "$STAGE/build-output"\n'
            if state != 'early-failure':
                source += 'INSTALLED=1\nSTOPPED=1\nACTIVE=(IX-Core)\nmkdir -p "$ROLLBACK"\nprintf "{}" > "$ROLLBACK/rollback.json"\n'
            source += 'exit 17\n'
            env = dict(os.environ, PATH=str(commands) + ':' + os.environ['PATH'], TEST_LOG=str(root / 'commands.log'),
                       IXI_CORE_SHA='a' * 40, IXI_RECOVERY_BUCKET='private', IXI_RECOVERY_ACCOUNT_ID='123456789012')
            result = subprocess.run(['bash'], input=source, text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((backups / 'last-release-failure.log').exists())
            stage_count = len(list(stages.iterdir()))
            rollback_count = len(list(backups.glob('source-before-*')))
            log = (root / 'commands.log').read_text()
            return stage_count, rollback_count, log

    def test_early_failure_removes_generated_stage_without_service_stop(self):
        stages, backups, log = self.scenario('early-failure')
        self.assertEqual((stages, backups), (0, 0))
        self.assertNotIn('pm2 stop', log)

    def test_verified_source_rollback_cleans_its_generated_directories(self):
        stages, backups, log = self.scenario('rollback-ok')
        self.assertEqual((stages, backups), (0, 0))
        self.assertIn('pm2 restart IX-Core', log)

    def test_failed_rollback_retains_recovery_and_does_not_resume_writers(self):
        stages, backups, log = self.scenario('rollback-failed')
        self.assertEqual((stages, backups), (1, 1))
        self.assertNotIn('pm2 restart', log)


if __name__ == '__main__':
    unittest.main()
