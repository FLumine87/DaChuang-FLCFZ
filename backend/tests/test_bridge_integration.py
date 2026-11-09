import tempfile
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.handlers import retrieval as api
from app.services.retrieval_screening import build_retrieval_screening
from app.engines.hashing.image_bridge import ImageTextBridge
from app.engines.hashing.bridge_store import BridgeStore
from app.engines.hashing.engine import DynamicCrossModalHashingEngine, STATE_VERSION
from app.config import settings


class BridgeContractTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = Mock()
        self.engine.initialize = AsyncMock()
        self.engine.units = {f'record-{suffix}': {'record_id':'record','modality':mod,
            'content':'本次检索样本', 'tags':['情绪-积极'], 'emotion_label':'happy',
            'dataset':'CSEMOTIONS', 'media_path':'/sample', 'media_kind':'speech_pcm16' if mod == 'audio' else 'image'}
            for mod,suffix in [('text','txt'),('audio','aud'),('image','img')]}
        self.engine._allowed_ids.return_value = set(self.engine.units)
        self.engine._media_url.return_value = 'data:image/png;base64,test'
        self.bridge = Mock()
        self.bridge.units = {f'record-{mod}':meta for meta in self.engine.units.values() for mod in [meta['modality']]}
        self.bridge.search.side_effect = lambda feature,modality,top_k,result_modality,allowed_ids: [
            {'unit_id':uid,'record_id':'record','modality':meta['modality'],'sim':.9}
            for uid,meta in self.bridge.units.items() if uid in allowed_ids and meta['modality'] == result_modality]
        self.manager = Mock()
        self.manager.route.return_value = ('bridge',(('text','image'),self.bridge))
        async def main_search(**kwargs):
            return [api._bridge_hit(self.engine,{'sim':.8},uid,'image','main')
                    for uid,meta in self.engine.units.items() if not kwargs.get('modality_filter') or meta['modality'] == kwargs['modality_filter']], {}
        self.engine.search_with_info = AsyncMock(side_effect=main_search)
        self.patches = [patch.object(api,'get_hashing_engine',return_value=self.engine),
            patch('app.engines.hashing.bridge_manager.get_bridge_manager',return_value=self.manager),
            patch.object(api,'_bridge_query_feature',return_value=[1.,0.,1.,0.])]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in self.patches])
        self.viewer = {'user_id':1,'role':'user'}

    async def test_single_route_initializes_and_preserves_screening_media_contract(self):
        hits,info,_,_ = await api.perform_search({'modality':'image','modality_filter':'text'},viewer=self.viewer)
        self.engine.initialize.assert_awaited_once()
        self.assertEqual(hits[0]['id'],'record-txt')
        self.assertEqual(hits[0]['summary'],'本次检索样本')
        self.assertEqual(hits[0]['media'],'data:image/png;base64,test')
        assessment = build_retrieval_screening('',[api.to_frontend_hit(hit) for hit in hits],modality='image')
        self.assertEqual(assessment['references'][0]['usage'],'screening')
        self.assertEqual(assessment['level'],'green')

    async def test_all_modalities_keep_three_views_of_one_source(self):
        hits,_,_,_ = await api.perform_search({'modality':'image','top_k':3},viewer=self.viewer)
        self.assertEqual({hit['modality'] for hit in hits},{'text','audio','image'})
        self.assertEqual(len({hit['id'] for hit in hits}),3)

    async def test_initialized_index_is_not_reloaded_for_each_request(self):
        self.engine._initialized = True
        await api.perform_search({'modality':'image','modality_filter':'text'},viewer=self.viewer)
        self.engine.initialize.assert_not_awaited()

    async def test_merged_channel_obeys_current_visibility(self):
        self.engine._allowed_ids.return_value = {'record-img'}
        hits,_,_,_ = await api.perform_search({'modality':'text','modality_filter':'image'},viewer=self.viewer)
        self.assertEqual([hit['id'] for hit in hits],['record-img'])
        self.assertEqual(self.bridge.search.call_args.kwargs['allowed_ids'],{'record-image'})

    async def test_bridge_cannot_return_a_no_longer_visible_unit(self):
        self.engine._allowed_ids.return_value = set()
        self.assertIsNone(api._bridge_search({},'image','text',5,None,self.viewer))

    async def test_missing_bridge_and_audio_to_image_keep_main_fallback(self):
        self.manager.route.return_value = ('main',None)
        await api.perform_search({'modality':'image','modality_filter':'text'},viewer=self.viewer)
        self.engine.search_with_info.assert_awaited()
        self.engine.search_with_info.reset_mock()
        await api.perform_search({'modality':'audio','modality_filter':'image'},viewer=self.viewer)
        self.engine.search_with_info.assert_awaited_once()


class BridgeModelTests(unittest.TestCase):
    def test_retraining_reextracts_cached_image_from_previous_encoder(self):
        engine = DynamicCrossModalHashingEngine.__new__(DynamicCrossModalHashingEngine)
        engine.units = {'img':{'record_id':'r','modality':'image','feature':[.1] * 4,'media_path':'sample.png'}}
        engine._train_cap = 10
        engine._scope_epoch = 0
        engine._train = Mock(return_value=True)
        encoder = SimpleNamespace(W={'image':[[.1] * 6] * 3}, encode=Mock(return_value=[1,0,1]))
        engine._encoder_for = Mock(return_value=encoder)
        engine._feature_of = Mock(return_value={'image':[.2] * 6})
        engine._new_index = Mock(return_value=Mock())
        engine._save_state = Mock()
        engine._persist_all = Mock()
        self.assertTrue(engine._retrain_in_place())
        self.assertEqual(len(encoder.encode.call_args.args[0]['image']),6)
        self.assertEqual(len(engine.units['img']['feature']),6)

    def test_cnn_query_uses_training_encoder_and_handles_unavailable_model(self):
        engine = DynamicCrossModalHashingEngine.__new__(DynamicCrossModalHashingEngine)
        engine.model = SimpleNamespace(W={'image': [[1.]]})
        engine._cnn_image_feature = Mock(return_value=[.1] * 1280)
        with patch.object(settings, 'HASHING_IMAGE_FEATURE', 'cnn'), patch('app.engines.hashing.engine.RF.image_feature', return_value=[.2] * 192):
            self.assertEqual(len(engine._extract_query_features('', 'image', 'sample.png')['image']), 1280)
            engine._cnn_image_feature.return_value = None
            self.assertEqual(len(engine._extract_query_features('', 'image', 'sample.png')['image']), 192)

    def test_changed_feature_backend_or_training_modalities_rejects_stale_state(self):
        engine = DynamicCrossModalHashingEngine.__new__(DynamicCrossModalHashingEngine)
        engine._feature_dim = Mock(return_value=3)
        with tempfile.TemporaryDirectory() as folder:
            engine.state_path = str(Path(folder) / 'state.json')
            state = {'version':STATE_VERSION, 'feature_dim':3, 'image_backend':'hand', 'train_modalities':['text','image','audio']}
            Path(engine.state_path).write_text(json.dumps(state), encoding='utf-8')
            with patch.object(settings, 'HASHING_IMAGE_FEATURE', 'cnn'):
                self.assertFalse(engine._load_model())
            with patch.object(settings, 'HASHING_IMAGE_FEATURE', 'hand'), patch.object(settings, 'HASHING_TRAIN_MODALITIES', ('text','audio')):
                self.assertFalse(engine._load_model())

    def test_binary_probe_metadata_dimensions_and_reload(self):
        rows = [{'record_id':f'r{i}','text_feature':[float(i%2),1.,float(i//2),.2],
                 'image_feature':[float(i%2),.5,float(i//2),.3], 'tags':[str(i%2)],
                 'unit_ids':{'text':f'r{i}-txt','image':f'r{i}-img'},
                 'unit_meta':{'image':{'dataset':'FER2013','emotion_label':'happy','tags':['情绪-积极']}}} for i in range(8)]
        bridge = ImageTextBridge(code_length=3,lambda_s=2,band_bits=2)
        self.assertTrue(bridge.fit(rows))
        with patch.object(bridge.index,'search',wraps=bridge.index.search) as search:
            self.assertTrue(bridge.search(rows[0]['image_feature'],'image',result_modality='text'))
            self.assertTrue(all(value in (0,1) for value in search.call_args.args[0]))
        self.assertFalse(bridge.add_unit('bad',{},[1.],'image'))
        self.assertEqual(bridge.search([1.],'image'),[])
        with tempfile.TemporaryDirectory() as folder:
            store = BridgeStore(folder,('text','image'))
            store.save_model(bridge); store.save_units(bridge.units)
            restored = store.load()
            self.assertEqual(restored.units['r0-img']['emotion_label'],'happy')
            self.assertTrue(restored.search(rows[0]['image_feature'],'image',result_modality='text'))
