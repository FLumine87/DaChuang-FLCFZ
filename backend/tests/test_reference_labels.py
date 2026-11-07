"""Emotion examples cannot become a querying person's clinical risk evidence."""
import json
import os
import random
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing.label_provenance import reference_labels
from scripts.datasets import eatd, csemotions, fer2013, base
from scripts import build_real_corpus


class ReferenceProvenanceTest(unittest.TestCase):
    def test_legacy_emotion_colours_are_unknown_for_both_valences(self):
        for theme, old_colour in (("情绪-悲伤", "orange"), ("情绪-高兴", "green")):
            result = reference_labels({"dataset": "CSEMOTIONS", "tags": [theme], "alert_level": old_colour})
            self.assertEqual(result["alert_level"], "unknown")
            self.assertEqual(result["screening_label"], "unknown")
            self.assertFalse(result["screening_usable"])

    def test_legacy_attached_image_cannot_inherit_sds(self):
        result = reference_labels({
            "dataset": "FER2013", "record_id": "EATD-0100", "modality": "image",
            "tags": ["SDS-抑郁", "情绪-积极"], "alert_level": "red",
            "media_path": "D:/FER2013/train/happy/a.jpg",
        })
        self.assertEqual(result["screening_label"], "unknown")
        self.assertEqual(result["pairing_type"], "weak_cross_dataset")
        self.assertEqual(result["emotion_label"], "happy")
        self.assertNotIn("SDS-抑郁", result["tags"])

    def test_sds_positive_is_screening_reference_not_crisis(self):
        result = reference_labels({"dataset": "EATD-Corpus", "tags": ["SDS-抑郁"], "alert_level": "red"})
        self.assertEqual(result["screening_label"], "positive")
        self.assertEqual(result["alert_level"], "orange")
        self.assertEqual(result["label_validity"], "self_report_screening")
        self.assertTrue(result["reference_only"])

    def test_missing_sds_is_not_normal(self):
        result = reference_labels({"dataset": "EATD-Corpus", "tags": ["情绪-积极"]})
        self.assertEqual(result["screening_label"], "unknown")
        self.assertEqual(result["alert_level"], "unknown")

    def test_actual_hit_exposes_safe_labels_without_rebuilding(self):
        from app.engines.hashing.engine import DynamicCrossModalHashingEngine
        engine = object.__new__(DynamicCrossModalHashingEngine)
        engine.units = {"CSEM-01-txt": {"record_id": "CSEM-01", "modality": "text", "dataset": "CSEMOTIONS", "tags": ["情绪-悲伤"], "alert_level": "orange", "code": [1, -1], "content": "很难过"}}
        engine.code_length = 2
        engine._source = "corpus-real"
        engine._corpus_meta = {}
        engine._media_url = lambda *args: None
        hit = engine._to_hit("CSEM-01-txt", 0.9, [1, -1], ["情绪-悲伤"], "text")
        self.assertEqual(hit["alert_level"], "unknown")
        self.assertEqual(hit["emotion_label"], "sad")
        self.assertEqual(hit["similarity"], 0.9)


class CorpusLabelTest(unittest.TestCase):
    def test_all_emotion_specs_have_no_screening_colour(self):
        for spec in (*csemotions.EMOTION_SPEC.values(), *fer2013.EMOTION_SPEC.values()):
            self.assertEqual(spec[3], "unknown")

    def test_eatd_missing_sds_remains_unknown_in_records_and_units(self):
        with tempfile.TemporaryDirectory() as folder:
            subject = os.path.join(folder, "t_1")
            os.mkdir(subject)
            with open(os.path.join(subject, "positive.txt"), "w", encoding="utf-8") as stream:
                stream.write("今天很开心")
            with open(os.path.join(subject, "positive.wav"), "wb") as stream:
                stream.write(b"test")
            with patch.object(base, "audio_feature", return_value=[0.1]):
                corpus = eatd.build(folder, random.Random(1), num_queries=1)
            self.assertEqual(corpus["records"][0]["screening_label"], "unknown")
            self.assertTrue(all(unit["alert_level"] == "unknown" for unit in corpus["units"]))
            self.assertTrue(all(unit["meta"]["screening_label"] == "unknown" for unit in corpus["units"]))

    def test_new_weak_image_keeps_only_its_expression(self):
        record = {"record_id": "EATD-1", "themes": ["SDS-筛查阳性"], "alert_level": "orange", "image_keys": ["sad"], "created_at": "2026-11-06", "window": 0}
        image_unit = {"record_id": "EATD-1", "modality": "image", "meta": {}}
        with patch.object(base, "make_image_unit", return_value=image_unit) as make:
            units = []
            build_real_corpus._attach_images([record], units, {"sad": ["face.jpg"]})
        self.assertEqual(make.call_args.args[2], ["情绪-悲伤"])
        self.assertEqual(make.call_args.args[3], "unknown")
        self.assertFalse(units[0]["meta"]["screening_usable"])

    def test_build_persists_distinct_label_sources(self):
        record = {"record_id": "CSEM-1", "themes": ["情绪-悲伤"], "severity": 0, "alert_level": "unknown", "created_at": "2026-11-06", "window": 0, "context": "emotion", "label": "emotion:sad", "emotion_label": "sad", "screening_label": "unknown", "label_source": "CSEMOTIONS/emotion", "label_validity": "emotion_only", "pairing_type": "same_source_text_audio", "screening_usable": False}
        unit = base.make_text_unit("CSEM-1", "难过", record["themes"], "unknown", record["created_at"], 0, "CSEMOTIONS", entry="难过")
        unit["meta"].update({key: record[key] for key in build_real_corpus.PROVENANCE_FIELDS})
        with tempfile.TemporaryDirectory() as folder, patch.object(build_real_corpus.F, "semantic_feature", return_value=[0.1]):
            db_path = os.path.join(folder, "corpus.db")
            build_real_corpus.write_db(db_path, folder, [record], [unit], [], {})
            with closing(sqlite3.connect(db_path)) as conn:
                self.assertEqual(conn.execute("SELECT emotion_label,screening_label,label_source FROM records").fetchone(), ("sad", "unknown", "CSEMOTIONS/emotion"))
                metadata = json.loads(conn.execute("SELECT meta FROM units").fetchone()[0])
                self.assertFalse(metadata["screening_usable"])


if __name__ == "__main__":
    unittest.main()
