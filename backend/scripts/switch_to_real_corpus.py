"""Replace the base retrieval corpus while keeping this installation's index data.

Run with the business backend stopped, using its normal configuration.
"""
import argparse
from contextlib import closing
import os
from pathlib import Path
import shutil
import sqlite3
import sys
from tempfile import mkdtemp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.engines.hashing.engine import DynamicCrossModalHashingEngine
from app.engines.hashing.store import HashingStore


def read_only(path):
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)


def corpus_units(path, *, real=False):
    with closing(read_only(path)) as conn:
        if real and conn.execute("SELECT value FROM meta WHERE key='kind'").fetchone() != ('real',):
            raise ValueError("目标语料库没有真实语料来源标记")
        units = dict(conn.execute("SELECT unit_id, record_id FROM units"))
    if not units:
        raise ValueError(f"语料库没有可用单元：{path.name}")
    return units


def file_signature(path):
    if not path.exists():
        return None
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def switch_corpus(corpus, data_dir, fallback):
    target_units = corpus_units(corpus, real=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    index_path = data_dir / "index.db"
    model_path = data_dir / "hashing_state.json"
    live_files = (index_path, model_path)
    sidecars = tuple(data_dir / (index_path.name + suffix) for suffix in ("-journal", "-wal", "-shm"))
    original = {path: file_signature(path) for path in (*live_files, *sidecars)}
    if any(original[path] is not None for path in sidecars):
        raise RuntimeError("索引仍有 SQLite 日志文件，请先正常停止业务后端")

    staging = Path(mkdtemp(prefix="switch-corpus-", dir=data_dir))
    backups = staging / "backup"
    backups.mkdir()
    for path in live_files:
        if original[path] is not None:
            shutil.copy2(path, backups / path.name)

    previous_dir = settings.HASHING_DATA_DIR
    settings.HASHING_DATA_DIR = str(staging)
    engine = DynamicCrossModalHashingEngine()
    try:
        staged_index = Path(engine.index_db_path)
        if original[index_path] is not None:
            shutil.copy2(backups / index_path.name, staged_index)
        store = engine._store
        store.init_schema()
        if not store.count_units() and original[model_path] is not None:
            store.migrate_state_file(str(backups / model_path.name))
        previous_source = store.meta_get("source")
        if previous_source == "corpus-real":
            print("当前索引已经使用真实语料")
            return
        if previous_source not in ("", "corpus", "demo", "db", "seedfile"):
            raise RuntimeError(f"无法识别原索引来源：{previous_source}")

        # Older builds tagged the bundled corpus as runtime. Match those units
        # by their original IDs and leave all account-owned units in place.
        old_base = corpus_units(fallback) if previous_source == "corpus" else {}
        old_units = store.load_units()
        old_records = store.load_records()
        retained = {uid: meta for uid, meta in old_units.items()
                    if meta.get("user_id") is not None or (
                        uid not in old_base and meta.get("source") not in ("corpus", "demo")
                        and previous_source != "demo")}
        retained_ids = {meta["record_id"] for meta in retained.values()}
        if retained.keys() & target_units.keys() or retained_ids & set(target_units.values()):
            raise RuntimeError("真实语料的编号与本地保留记录重叠，已停止切换")

        print(f"正在构建真实语料索引，共 {len(target_units)} 个单元", flush=True)
        engine._source = "corpus-real"
        engine._corpus_path = str(corpus)
        if not engine._seed_from_corpus(str(corpus)) or engine.units.keys() != target_units.keys():
            raise RuntimeError("真实语料索引构建不完整")
        engine.units.update(retained)
        engine.records.update({rid: old_records[rid] for rid in retained_ids if rid in old_records})
        engine._source_count = len(engine.units)
        engine._reencode_units(retained)
        store.close()

        # Work on the copy so visibility, queue state and training history are kept.
        with closing(sqlite3.connect(staged_index)) as conn, conn:
            conn.executemany("DELETE FROM units WHERE unit_id=?", ((uid,) for uid in old_units.keys() - retained.keys()))
            removed_records = old_records.keys() - retained_ids
            conn.executemany("DELETE FROM records WHERE record_id=?", ((rid,) for rid in removed_records))
            conn.executemany("DELETE FROM train_queue WHERE record_id=?", ((rid,) for rid in removed_records))
            conn.execute("DELETE FROM table_meta")
        engine._persist_all()
        store.meta_set("reencode_pending", "0")
        engine._save_state()
        if store.count_units() != len(engine.units) or store.meta_get("source") != "corpus-real":
            raise RuntimeError("新索引持久化未通过校验")
        store.close()
        if any(file_signature(path) != signature for path, signature in original.items()):
            raise RuntimeError("构建期间原索引发生变化，请停止业务后端后重试")

        replaced = []
        try:
            for path in live_files:
                os.replace(staging / path.name, path)
                replaced.append(path)
        except OSError:
            for path in reversed(replaced):
                if original[path] is None:
                    path.unlink()
                else:
                    shutil.copy2(backups / path.name, path)
            raise
        print(f"已切换至真实语料，保留 {len(retained)} 个本地索引单元。备份：{backups}")
    finally:
        engine._store.close()
        settings.HASHING_DATA_DIR = previous_dir


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=Path(settings.HASHING_CORPUS_DB))
    args = parser.parse_args()
    switch_corpus(args.corpus.resolve(), Path(settings.HASHING_DATA_DIR).resolve(),
                  Path(settings.HASHING_FALLBACK_CORPUS_DB).resolve())


if __name__ == "__main__":
    main()
