"""Latest dashboard input: temporary SQLite data; no real accounts or model calls."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
from datetime import datetime, timezone
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.db import database as db
from app.handlers.personal import _latest_dashboard_input, get_personal_dashboard, get_personal_records
from app.services.risk_summary import CHINA


class LatestInputTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = settings.DATABASE_URL
        settings.DATABASE_URL = 'sqlite:///' + str(Path(self.tmp.name) / 'dashboard.db')
        db._local_conn = None
        db.init_db_sync()
        self.uid = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('latest_test','x','合成用户','user')")
        self.other = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('latest_other','x','另一用户','user')")
        self.qid = db.execute("INSERT INTO questionnaires(code,name,max_score) VALUES ('LATEST-TEST','测试量表',27)")
        self.number = 0

    async def asyncTearDown(self):
        db._local_conn.close()
        db._local_conn = None
        settings.DATABASE_URL = self.previous
        self.tmp.cleanup()

    def scale(self, at, *, uid=None, status='completed', created='2026-11-17 01:00:00'):
        self.number += 1
        sid = f'LATEST-{self.number}'
        db.execute(
            "INSERT INTO screenings(screening_id,user_id,name,questionnaire_id,score,max_score,answers,status,screening_date,created_at) "
            "VALUES (?,?,'合成记录',?,3,27,'{}',?,?,?)",
            (sid, uid or self.uid, self.qid, status, at, created))
        return sid

    def media(self, at, *, kind='text', text='合成原文', uid=None, record=None):
        return db.execute(
            'INSERT INTO screening_supplements(user_id,screening_id,kind,text,filename,analysis,created_at) VALUES (?,?,?,?,?,?,?)',
            (uid or self.uid, record, kind, text, f'合成文件.{"png" if kind == "image" else "wav"}',
             json.dumps({'conclusion': f'{text}的分析'}), at))

    async def test_latest_standalone_media_beats_old_scale_attachment(self):
        record = self.scale('2026-11-17 09:00:00')
        self.media('2026-11-17 01:10:00', record=record, text='旧附件')
        mid = self.media('2026-11-17 02:00:00', text='真实最新输入')
        result = await _latest_dashboard_input(self.uid)
        self.assertEqual(result['id'], f'media:{mid}')
        self.assertEqual(result['text'], '真实最新输入')
        self.assertEqual(result['at'], '2026-11-17T10:00:00+08:00')
        self.assertEqual(result['supplement']['analysis']['conclusion'], '真实最新输入的分析')
        self.assertIsNone(result['recordId'])

    async def test_latest_scale_replaces_older_media_without_reusing_analysis(self):
        self.media('2026-11-17 01:00:00', text='旧输入')
        record = self.scale('2026-11-17T10:00:00+08:00')
        result = await _latest_dashboard_input(self.uid)
        self.assertEqual(result['kind'], 'scale')
        self.assertEqual(result['recordId'], record)
        self.assertEqual(result['text'], '测试量表：3/27分')
        self.assertNotIn('supplement', result)
        self.assertEqual(result['scale']['answers'], {})

    async def test_each_media_kind_uses_actual_file_or_original_text(self):
        for hour, kind in enumerate(('image', 'audio', 'text'), start=1):
            mid = self.media(f'2026-11-17 {hour:02d}:00:00', kind=kind, text='' if kind != 'text' else '最新文字')
            result = await _latest_dashboard_input(self.uid)
            self.assertEqual(result['id'], f'media:{mid}')
            self.assertEqual(result['kind'], kind)
            self.assertEqual(result['supplement']['id'], mid)
            if kind == 'text':
                self.assertEqual(result['text'], '最新文字')
            else:
                self.assertIn('合成文件.', result['text'])
                self.assertNotIn('的分析', result['text'])

    async def test_comparison_preserves_seconds_offsets_and_not_id_order(self):
        self.scale('2026-11-17 10:00:30.700000')
        mid = self.media('2026-11-17T02:00:30.800000Z')
        self.media('2026-11-17 01:59:59')  # Higher ID is older.
        result = await _latest_dashboard_input(self.uid)
        self.assertEqual(result['id'], f'media:{mid}')
        self.assertEqual(result['at'], '2026-11-17T10:00:30.800000+08:00')

    async def test_completed_only_current_user_and_empty_state(self):
        self.scale('2026-11-20 10:00:00', status='pending')
        self.scale('2026-11-20 11:00:00', uid=self.other)
        self.media('2026-11-20 12:00:00', uid=self.other)
        self.assertIsNone(await _latest_dashboard_input(self.uid))
        record = self.scale(None, created='2026-11-17 02:00:00')
        result = await _latest_dashboard_input(self.uid)
        self.assertEqual(result['recordId'], record)
        self.assertEqual(result['at'], '2026-11-17T10:00:00+08:00')

    async def test_dashboard_latest_input_is_not_truncated_to_list_limits(self):
        mid = self.media('2026-11-17 03:00:00', text='低ID但时间最新')
        for _ in range(25):
            self.media('2026-11-17 01:00:00')
        self.scale('2026-11-17 09:00:00')
        for _ in range(12):
            self.scale('2026-11-20 10:00:00', status='pending')
        response = await get_personal_dashboard(SimpleNamespace(user={'sub': str(self.uid)}))
        data = response['data']
        self.assertEqual(data['latestInput']['id'], f'media:{mid}')
        self.assertEqual(data['latestInput']['text'], '低ID但时间最新')
        self.assertNotIn(mid, [row['id'] for row in data['supplements']])

    async def test_unified_history_preserves_both_sources_notes_and_order(self):
        record = self.scale('2026-11-17T10:00:00+08:00')
        mid = self.media('2026-11-17T02:30:00Z', record=record, text='关联的文字筛查')
        self.media('2026-11-17T01:30:00Z', kind='audio', text='')
        self.scale('2026-11-20 10:00:00', status='pending')
        self.scale('2026-11-21 10:00:00', uid=self.other)
        self.media('2026-11-21 10:00:00', uid=self.other)
        db.execute('INSERT INTO supplement_notes(supplement_id,user_id,content) VALUES (?,?,?)',
                   (mid, self.uid, '保留原有便签'))
        response = await get_personal_records(SimpleNamespace(user={'sub': str(self.uid)}))
        rows = response['data']
        self.assertEqual([r['kind'] for r in rows], ['text', 'scale', 'audio'])
        self.assertEqual(len({r['id'] for r in rows}), 3)
        self.assertEqual(rows[0]['recordId'], record)
        self.assertEqual(rows[0]['supplement']['note'], '保留原有便签')
        self.assertEqual(rows[0]['at'], '2026-11-17T10:30:00+08:00')
        self.assertEqual(rows[1]['scale']['answers'], {})

    async def test_full_ledger_and_activity_exceed_preview_limits(self):
        now = datetime.now(CHINA)
        record = self.scale(now.isoformat())
        for _ in range(105):
            self.media(now.astimezone(timezone.utc).isoformat(), record=record)
        self.media(now.astimezone(timezone.utc).isoformat(), kind='image')
        self.scale('2026-01-01 10:00:00')  # Kept in history, outside recent activity.
        self.scale(now.isoformat(), status='pending')
        ctx = SimpleNamespace(user={'sub': str(self.uid)})
        rows = (await get_personal_records(ctx))['data']
        self.assertEqual(len(rows), 108)
        data = (await get_personal_dashboard(ctx))['data']
        self.assertEqual(data['screeningActivity'], {'total': 107,
            'byKind': {'scale': 1, 'text': 105, 'audio': 0, 'image': 1}})


if __name__ == '__main__':
    unittest.main()
