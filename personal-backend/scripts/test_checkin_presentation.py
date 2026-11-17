"""每日问询提醒预算及推荐回复测试；使用临时数据库，不接触用户数据。"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base
from app.db.models import DailyCheckin, CheckinPresentation
from app.services import checkin_service as service, daily_checkin_agent as agent


class PresentationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.temp.name) / 'test.db'))
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.patch = patch.object(service, 'SessionLocal', self.sessions)
        self.patch.start()
        with self.sessions.begin() as session:
            session.add(DailyCheckin(user_id='alice', message='今天学到了什么？', checkin_date=service._today()))
        self.clock = patch.object(service.time, 'time', return_value=2000000000)
        self.now = self.clock.start()
        self.llm = patch.object(agent.llm_client, 'chat', return_value='["学到了新知识", "还在慢慢理解", "今天先休息"]')
        self.generate = self.llm.start()

    def tearDown(self):
        self.llm.stop()
        self.clock.stop()
        self.patch.stop()
        self.engine.dispose()
        self.temp.cleanup()

    def test_budget_cooldown_and_cache(self):
        first = service.present_daily_checkin('alice')
        self.assertEqual(first.presentation_count, 1)
        self.assertEqual(first.suggestions_source, 'ai')
        self.assertIsNone(service.present_daily_checkin('alice'))
        for count in (2, 3):
            self.now.return_value += 1801
            self.assertEqual(service.present_daily_checkin('alice').presentation_count, count)
        self.now.return_value += 1801
        self.assertIsNone(service.present_daily_checkin('alice'))
        self.generate.assert_called_once()

    def test_reply_or_decline_stops_reminders(self):
        first = service.present_daily_checkin('alice')
        service.mark_replied(first.id, first.suggested_replies[0])
        self.now.return_value += 1801
        self.assertIsNone(service.present_daily_checkin('alice'))
        with self.sessions.begin() as session:
            session.get(DailyCheckin, first.id).status = 'declined'
        self.assertIsNone(service.present_daily_checkin('alice'))

    def test_new_day_and_account_have_separate_budget(self):
        service.present_daily_checkin('alice')
        with self.sessions.begin() as session:
            session.add(DailyCheckin(user_id='bob', message='今天好吗？', checkin_date=service._today()))
        self.assertEqual(service.present_daily_checkin('bob').presentation_count, 1)
        with patch.object(service, '_today', return_value='2099-01-02'), patch.object(agent, 'get_user_interests', return_value=[]), patch.object(agent, 'generate_checkin_message', return_value='今天好吗？'):
            self.assertEqual(service.present_daily_checkin('alice').presentation_count, 1)

    def test_invalid_or_unavailable_ai_is_labeled_fallback(self):
        for raw in ('', '{"bad":1}', '["仅一个"]', '["重复", "重复", "重复"]'):
            self.generate.return_value = raw
            options, source = agent.generate_reply_options('今天学到了什么？')
            self.assertEqual(source, 'fallback')
            self.assertGreaterEqual(len(options), 3)
        self.assertEqual(agent.generate_reply_options('今天学到了什么？')[1], 'fallback')

    def test_concurrent_tabs_share_budget(self):
        from concurrent.futures import ThreadPoolExecutor
        # 缓存已生成的选项，模拟两个页面同时领取第二次展示。
        service.present_daily_checkin('alice')
        self.now.return_value += 1801
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: service.present_daily_checkin('alice'), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        with self.sessions() as session:
            self.assertEqual(session.get(CheckinPresentation, ('alice', service._today())).count, 2)


if __name__ == '__main__':
    unittest.main()
