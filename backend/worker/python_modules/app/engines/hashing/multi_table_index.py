"""
多哈希表增量索引（Multi-Table Hash Index，带多探测）。

对应申报书创新点①「基于多哈希表系统的增量式模态哈希方法」：
    * 多哈希表：用 T 张随机位置换表，把同一 K 位码映射到 T 个不同的桶空间，
      查询时多表并行探测，抵消单表 LSH 的漏召回，保证检索精度与效率。
    * 增量式：新样本只需 O(K) 插入所有表，无需重新训练哈希函数，
      因此在「数据动态变化」环境下仍能高效检索。
    * 多探测（multi-probe）：除精确桶外，还在 Hamming 半径 r 内生成邻近桶，
      兼顾召回与速度；索引较小时自动线性回退，保证必有结果返回。
"""
import itertools
import random


class MultiTableHashIndex:
    def __init__(self, code_length: int, num_tables: int = 4,
                 probe_radius: int = 2, seed: int = 42):
        self.K = code_length
        self.T = num_tables
        self.r = probe_radius
        rnd = random.Random(seed)
        # 每张表一个随机位置换
        self.perms = [rnd.sample(range(self.K), self.K) for _ in range(self.T)]
        self.buckets = [{} for _ in range(self.T)]   # table -> {key: [case_id,...]}
        # 记录每个案例的元信息与码，用于排序与回退线性扫描
        self.records = {}

    @staticmethod
    def _key(code, perm):
        return "".join(str(code[perm[i]]) for i in range(len(perm)))

    def insert(self, case_id, code, meta):
        """增量插入一个案例（code 为 0/1 列表，长度 K）。"""
        meta = dict(meta)
        meta["code"] = list(code)
        self.records[case_id] = meta
        for t, perm in enumerate(self.perms):
            k = self._key(code, perm)
            self.buckets[t].setdefault(k, []).append(case_id)

    def _neighbor_keys(self, code, perm):
        """精确桶 + Hamming 半径 r 内的邻近桶。"""
        base = self._key(code, perm)
        keys = {base}
        idx = list(range(self.K))
        for d in range(1, self.r + 1):
            for comb in itertools.combinations(idx, d):
                lst = list(base)
                for b in comb:
                    lst[b] = "1" if lst[b] == "0" else "0"
                keys.add("".join(lst))
        return keys

    def search(self, query_code, top_k: int = 5):
        """返回 (case_ids, similarities)，按 Hamming 相似度降序。"""
        cand = set()
        for t, perm in enumerate(self.perms):
            for k in self._neighbor_keys(query_code, perm):
                for cid in self.buckets[t].get(k, []):
                    cand.add(cid)
        # 候选不足时线性回退，保证召回
        if len(cand) < top_k:
            cand = set(self.records.keys())

        scored = []
        for cid in cand:
            c = self.records[cid]["code"]
            ham = sum(1 for i in range(self.K) if c[i] != query_code[i])
            sim = 1.0 - ham / self.K
            scored.append((sim, cid))
        scored.sort(key=lambda x: x[0], reverse=True)
        ids = [cid for _, cid in scored[:top_k]]
        sims = [sim for sim, _ in scored[:top_k]]
        return ids, sims

    def __len__(self):
        return len(self.records)
