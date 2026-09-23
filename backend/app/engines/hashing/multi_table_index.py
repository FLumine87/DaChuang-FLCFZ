"""多哈希表索引：时间窗 × 位带（Multi-Index Hashing）+ 表质量评估。

对应申报书「基于多哈希表系统的增量式模态哈希方法」的工程实现，落到两个维度：

1. **位带分表（检索结构）**
   把 K 位哈希码切成 m 个等宽位带（K=64、band=8 → m=8），每个位带一张表，
   桶键为该位带的二进制串。查询时对每个位带做精确桶查找并取并集。

   这样做有**可证明的召回保证**：若两条码的汉明距离 ≤ m-1，则由鸽巢原理，
   至少有一个位带完全相同 → 必然被命中。K=64/m=8 时保证半径 7
   （相似度 ≥ 0.89）内不漏召回，比随机置换 LSH 的"概率召回"更强。

2. **时间窗分片（动态维度）**
   表按时间窗（默认 122 天一段）分片：新数据落入当前窗口，时间推进后自动
   出现新窗口分片，无需重建整个索引。每个窗口表独立评估质量：

       σ（编码信息量）= 各位取值方差的均值，全 0/1 的退化位会拉低该值
       ρ（语义一致性）= 窗口内样本与其 top-3 汉明近邻的主题 Jaccard 均值
       active = ρ ≥ rho_min 且 σ ≥ sigma_min

   质量不达标的窗口表不参与探测（等价于申报书里的"淘汰表征最弱的表"），
   若候选不足再线性回退，保证必有结果。
"""
import itertools
import math

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None


class MultiTableHashIndex:
    def __init__(self, code_length=64, band_bits=8, rho_min=0.10,
                 sigma_min=0.02, epoch="2025-08-01", window_days=122,
                 probe_bits=2):
        self.K = int(code_length)
        self.band_bits = max(1, int(band_bits))
        self.num_bands = max(1, math.ceil(self.K / self.band_bits))
        # 位带内允许翻转的比特数：探测半径保证 = num_bands × probe_bits
        # （K=64、8 位带、probe_bits=2 → 汉明半径 16 内不漏召回，即相似度 ≥ 0.75）
        self.probe_bits = max(0, int(probe_bits))
        self.guaranteed_radius = self.num_bands * self.probe_bits
        self.rho_min = rho_min
        self.sigma_min = sigma_min
        self.epoch = epoch
        self.window_days = int(window_days)

        self.tables = {}        # window -> [band_dict, ...]
        self.records = {}       # unit_id -> meta（含 code / window）
        self.table_stats = {}   # window -> {size, sigma, rho, active}
        self.probe_count = 0    # 累计桶探测次数（用于效率统计）
        # 非对称距离所需的 ±1 码表（惰性构建，插入后失效重建）
        self._sign_dirty = True
        self._sign_rows = []
        self._row_of = {}
        self._sign_matrix = None
        self._sign_cache = {}

    # ------------------------- 时间窗 -------------------------

    def window_of(self, date_str):
        """按 epoch 起算的固定天数分段得到窗口号；数据随时间自然进入新窗口。"""
        import datetime
        if not date_str:
            return 0
        try:
            d = datetime.date.fromisoformat(str(date_str)[:10])
        except Exception:
            return 0
        try:
            e = datetime.date.fromisoformat(self.epoch)
        except Exception:
            return 0
        return max(0, (d - e).days // self.window_days)

    def _ensure_window(self, window):
        if window not in self.tables:
            self.tables[window] = [{} for _ in range(self.num_bands)]

    # ------------------------- 写 -------------------------

    def insert(self, unit_id, code, meta, window=None):
        """增量插入一个单元（单元 = 某条记录在某个模态下的视图）。"""
        if window is None:
            window = meta.get("window")
        if window is None:
            window = self.window_of(meta.get("date"))
        window = int(window)
        self._ensure_window(window)
        rec = dict(meta)
        bits = [1 if b else 0 for b in code]
        rec["code"] = bits
        rec["_packed"] = self._pack(bits)   # 打包成整数，汉明距离用异或+bit_count（快）
        rec["window"] = window
        self.records[unit_id] = rec
        for b in range(self.num_bands):
            self.tables[window][b].setdefault(self._band_key(bits, b), []).append(unit_id)
        # 新数据插入后该窗口统计失效，待下次 evaluate_tables 重算
        self.table_stats.pop(window, None)
        self._sign_dirty = True
        return True

    def remove(self, unit_id):
        """删除一个单元（用于重建索引时清理）。"""
        rec = self.records.pop(unit_id, None)
        if not rec:
            return False
        window = rec.get("window", 0)
        if window in self.tables:
            for b in range(self.num_bands):
                key = self._band_key(rec["code"], b)
                bucket = self.tables[window][b].get(key)
                if bucket and unit_id in bucket:
                    bucket.remove(unit_id)
                    if not bucket:
                        del self.tables[window][b][key]
        self.table_stats.pop(window, None)
        self._sign_dirty = True
        return True

    def clear(self):
        self.tables = {}
        self.records = {}
        self.table_stats = {}
        self._sign_dirty = True

    # ------------------------- 表质量评估 -------------------------

    def _band_key(self, code, band):
        start = band * self.band_bits
        end = min(self.K, start + self.band_bits)
        return "".join("1" if code[i] else "0" for i in range(start, end))

    def _probe_keys(self, code, band):
        """位带内探测键：精确键 + 翻转 ≤ probe_bits 位的所有变体（MIH 标准做法）。

        鸽巢原理：若两条码的汉明距离 ≤ num_bands × probe_bits，则至少有一个
        位带的差异比特数 ≤ probe_bits，因而必然被探测到 → 该半径内不漏召回。
        """
        base = self._band_key(code, band)
        if self.probe_bits <= 0:
            return (base,)
        keys = [base]
        idx = list(range(len(base)))
        for d in range(1, self.probe_bits + 1):
            for comb in itertools.combinations(idx, d):
                lst = list(base)
                for i in comb:
                    lst[i] = "1" if lst[i] == "0" else "0"
                keys.append("".join(lst))
        return keys

    @staticmethod
    def _pack(bits):
        """二值码 -> 整数（汉明距离 = (a ^ b).bit_count()，比逐位比较快一个量级）。"""
        v = 0
        for b in bits:
            v = (v << 1) | (1 if b else 0)
        return v

    @staticmethod
    def _ham_packed(a, b):
        return (a ^ b).bit_count()

    @staticmethod
    def _ham(a, b):
        return sum(1 for i in range(len(a)) if a[i] != b[i])

    @staticmethod
    def _jaccard(x, y):
        sx, sy = set(x or []), set(y or [])
        u = sx | sy
        return (len(sx & sy) / len(u)) if u else 0.0

    def evaluate_tables(self, max_sample=80):
        """重算各时间窗表的 σ（编码信息量）与 ρ（语义一致性），并标记是否活跃。

        返回每个窗口的统计列表，供接口/前端展示"哈希表健康度"。
        """
        stats = []
        for window in sorted(self.tables.keys()):
            ids = [uid for uid, r in self.records.items() if r.get("window") == window]
            size = len(ids)
            if size == 0:
                self.table_stats[window] = {
                    "window": window, "size": 0, "sigma": 0.0, "rho": 0.0,
                    "active": False, "trust": 0.0,
                }
                stats.append(self.table_stats[window])
                continue

            sample = ids if size <= max_sample else ids[:: max(1, size // max_sample)][:max_sample]
            codes = [self.records[uid]["code"] for uid in sample]
            packed = [self.records[uid]["_packed"] for uid in sample]

            # σ：各位的取值方差均值（位越"活"，信息量越大）
            n = len(codes)
            sigmas = []
            for i in range(self.K):
                p = sum(1 for c in codes if c[i]) / n
                sigmas.append(p * (1.0 - p))
            sigma = sum(sigmas) / len(sigmas) * 4.0  # 归一到 0~1（p=0.5 时取 1）

            # ρ：样本与其 top-3 汉明近邻的主题一致度
            rhos = []
            for i, uid in enumerate(sample):
                dists = []
                for j, other in enumerate(sample):
                    if i == j:
                        continue
                    dists.append((self._ham_packed(packed[i], packed[j]), other))
                dists.sort(key=lambda x: x[0])
                neighbors = [o for _, o in dists[:3]]
                if not neighbors:
                    continue
                ti = self.records[uid].get("tags")
                rhos.append(sum(self._jaccard(ti, self.records[o].get("tags"))
                                for o in neighbors) / len(neighbors))
            rho = sum(rhos) / len(rhos) if rhos else 0.0

            active = (rho >= self.rho_min) and (sigma >= self.sigma_min)
            rec = {"window": window, "size": size, "sigma": round(sigma, 4),
                   "rho": round(rho, 4), "active": active,
                   "trust": round(rho, 4)}
            self.table_stats[window] = rec
            stats.append(rec)
        return stats

    def table_stats_list(self):
        """返回已评估的窗口表统计（未评估则先评估）。"""
        if not self.table_stats:
            self.evaluate_tables()
        return [self.table_stats[w] for w in sorted(self.table_stats.keys())]

    # ------------------------- 读 -------------------------

    def _active_windows(self):
        if not self.table_stats:
            self.evaluate_tables()
        active = [w for w, s in self.table_stats.items() if s.get("active")]
        return active or list(self.tables.keys())  # 全部不活跃时退回全表

    def _ensure_signs(self):
        """构建 ±1 码表（s = 2b-1，bit=1 ↔ +1），用于非对称距离 u · s。插入后失效重建。"""
        if not self._sign_dirty:
            return
        self._sign_rows = list(self.records.keys())
        self._row_of = {uid: i for i, uid in enumerate(self._sign_rows)}
        if np is not None and self._sign_rows:
            self._sign_matrix = np.array(
                [[2 * int(b) - 1 for b in self.records[uid]["code"]]
                 for uid in self._sign_rows], dtype=np.float32)
            self._sign_cache = {}
        else:
            self._sign_matrix = None
            self._sign_cache = {uid: tuple(2 * int(b) - 1 for b in self.records[uid]["code"])
                                for uid in self._sign_rows}
        self._sign_dirty = False

    def asym_score(self, query_vec, code):
        """单条查询与某个码的非对称得分（归一到 [-1,1]），用于结果解释与诊断。

        符号约定：连续向量 u = W x 与符号码 s 同向，bit=1 ↔ s=+1。
        """
        norm = math.sqrt(sum(x * x for x in query_vec))
        scale = (norm * math.sqrt(max(1, self.K))) or 1.0
        s = [2 * int(b) - 1 for b in (code or [])]
        if not s:
            return 0.0
        return sum(a * b for a, b in zip(query_vec, s)) / scale

    def _asym_scores(self, cand_ids, query_vec):
        """非对称得分：查询端连续向量 u 与库端 ±1 码 s 的内积，归一到 [-1,1]。

        相比"查询也二值化后比汉明"，这里保留了投影幅值信息，
        在噪声位较多（低位长有效秩）时能明显提升排序质量。
        """
        self._ensure_signs()
        norm = math.sqrt(sum(x * x for x in query_vec))
        scale = (norm * math.sqrt(max(1, self.K))) or 1.0
        if self._sign_matrix is not None:
            rows, uids = [], []
            for uid in cand_ids:
                r = self._row_of.get(uid)
                if r is not None:
                    rows.append(r)
                    uids.append(uid)
            u = np.asarray(query_vec, dtype=np.float32)
            vals = self._sign_matrix[rows] @ u / scale
            return {uid: float(v) for uid, v in zip(uids, vals)}
        out = {}
        for uid in cand_ids:
            s = self._sign_cache.get(uid)
            out[uid] = (sum(a * b for a, b in zip(query_vec, s)) / scale) if s else 0.0
        return out

    def search(self, query_code, top_k=5, modality_filter=None,
               exclude_ids=None, windows=None, query_vec=None):
        """检索，返回 (ids, similarities, info)。

        modality_filter : 只保留该模态的结果（text/image/audio），None 表示不限
        exclude_ids     : 需要排除的单元 id（例如查询自身的单元，避免自匹配）
        windows         : 只探测指定时间窗，None 表示探测所有活跃窗口
        query_vec       : 查询的连续向量；给了就走**非对称距离**排序，
                          否则退化为"两边都二值化"的对称汉明排序
        """
        exclude = set(exclude_ids or [])
        probe_windows = list(windows) if windows is not None else self._active_windows()

        cand = set()
        keys_probed = 0
        for w in probe_windows:
            bands = self.tables.get(w)
            if not bands:
                continue
            for b in range(self.num_bands):
                for key in self._probe_keys(query_code, b):
                    keys_probed += 1
                    self.probe_count += 1
                    for uid in bands[b].get(key, ()):
                        cand.add(uid)
        cand -= exclude

        # 候选不足时线性回退（保证一定能填满结果列表）：
        # 位带探测保证 radius = num_bands × probe_bits 内不漏召回，
        # 超出该半径、或探测键命中率过低时，用全量回退兜底。
        min_need = max(int(top_k), 20)
        scanned_all = False
        if len(cand) < min_need:
            scanned_all = True
            cand = {uid for uid in self.records if uid not in exclude}

        if modality_filter:
            cand = {uid for uid in cand
                    if self.records[uid].get("modality") == modality_filter}

        scored = []
        q_packed = self._pack([1 if b else 0 for b in query_code])
        if query_vec is not None and any(query_vec):
            # 非对称距离排序：相似度归一到 [0,1]，0.5 相当于随机水平
            cand_list = sorted(cand)
            asym = self._asym_scores(cand_list, query_vec)
            for uid in cand_list:
                sim = max(0.0, min(1.0, (asym.get(uid, 0.0) + 1.0) / 2.0))
                ham = self._ham_packed(q_packed, self.records[uid]["_packed"])
                scored.append((sim, ham, uid))
            scoring = "asymmetric"
        else:
            for uid in cand:
                ham = self._ham_packed(q_packed, self.records[uid]["_packed"])
                sim = 1.0 - ham / self.K
                scored.append((sim, ham, uid))
            scoring = "hamming"
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[: int(top_k)]

        info = {
            "candidates": len(cand),
            "scanned_all": scanned_all,
            "keys_probed": keys_probed,
            "probed_windows": sorted(probe_windows),
            "index_size": len(self.records),
            "scoring": scoring,
        }
        return [uid for _, _, uid in top], [sim for sim, _, _ in top], info

    def get(self, unit_id):
        return self.records.get(unit_id)

    def window_distribution(self):
        dist = {}
        for r in self.records.values():
            w = r.get("window", 0)
            dist[w] = dist.get(w, 0) + 1
        return dict(sorted(dist.items()))

    def modality_distribution(self):
        dist = {}
        for r in self.records.values():
            m = r.get("modality", "text")
            dist[m] = dist.get(m, 0) + 1
        return dict(sorted(dist.items()))

    def __len__(self):
        return len(self.records)