"""
在线监督集体矩阵分解跨模态哈希（Online Supervised Collective Matrix
Factorization Hashing, CMFH）。

对应申报书创新点②「动态跨模态哈希检索技术的应用」：
    把图像 / 文本 / 语音三个模态映射进同一个 K 位二值哈希码空间，
    并借助「监督相似度矩阵 S」使语义相近的样本在哈希空间里也相近，
    从而实现跨模态检索（例如用文本查到图像 / 语音案例）。

模型
----
给定 M 个模态，每个模态 m 有特征矩阵 X_m (n×d_m)。学习：
  * 公共二值码矩阵 B (n×K)，各样本共享；
  * 每模态投影 W_m (d_m×K)，使 X_m ≈ B W_m^T。

目标（受 CMFH / 监督哈希启发）：
    max_{B,W_m}  Σ_m ||X_m - B W_m^T||^2  +  λ·<B, S B>    (s.t. B∈{0,1}^{n×K})
其中 S 是监督相似度（来自案例标签 / 共现）。实现上：
  1) 构造 G = Σ_m (X_m X_m^T)/g_scale  +  λ·S        （对称 n×n）
  2) 取 G 的前 K 大特征向量 -> 连续公共表示 -> 符号化得 B
  3) 闭式求 W_m = (B^T B + εI)^{-1} B^T X_m
样本外编码（新查询）：score = x_m · W_m  ->  二值码 = sign(score)
"""
from . import linalg


class OnlineSupervisedCMFH:
    def __init__(self, code_length: int = 32, lambda_s: float = 0.6):
        self.K = code_length
        self.lambda_s = lambda_s
        self.modalities = []
        self.W = {}          # modality -> (d_m × K) 投影矩阵
        self.B = None        # 训练样本二值码 (n×K)
        self.trained = False

    def fit(self, features, similarity):
        """
        features   : dict[modality] -> list[vector]   (n 个样本)
        similarity : n×n 监督相似度矩阵（对称，元素∈[0,1] 或含负）
        返回训练样本二值码 B (n×K)
        """
        mods = list(features.keys())
        self.modalities = mods
        n = len(similarity)

        # 行 L2 归一化
        X = {m: [linalg.normalize_row(r) for r in features[m]] for m in mods}

        # 构造 G = Σ_m Gram(X_m) + λ·S，并平衡两部分的尺度
        G = [[0.0] * n for _ in range(n)]
        for m in mods:
            Gm = linalg.gram(X[m])
            for i in range(n):
                for j in range(n):
                    G[i][j] += Gm[i][j]
        g_mean = linalg.mean_abs(G) or 1.0
        s_mean = linalg.mean_abs(similarity) or 1.0
        for i in range(n):
            for j in range(n):
                G[i][j] = G[i][j] / g_mean * s_mean + self.lambda_s * similarity[i][j]

        # 前 K 大特征向量 -> 连续公共表示 -> 二值化
        eig, vecs = linalg.symmetric_eig_largest(G, self.K)
        Uraw = [[vecs[k][i] for k in range(self.K)] for i in range(n)]   # n×K
        B = [[1 if Uraw[i][k] >= 0 else 0 for k in range(self.K)]
             for i in range(n)]

        # 闭式求各模态投影 W_m
        BtB = linalg.matmul(linalg.transpose(B), B)
        for k in range(self.K):
            BtB[k][k] += 1e-6
        BtB_inv = linalg.inverse(BtB)
        for m in mods:
            Xm = X[m]
            BtXm = linalg.matmul(linalg.transpose(B), Xm)   # K×d_m
            Wt = linalg.matmul(BtB_inv, BtXm)               # K×d_m
            self.W[m] = Wt                                  # K×d_m（编码时 x·Wm^T 即 matvec(Wm, x)）

        self.B = B
        self.trained = True
        return B

    def encode(self, feature_by_modality):
        """
        样本外编码。feature_by_modality: dict[modality] -> vector(已/未归一化均可)
        返回长度 K 的 0/1 二值码。
        """
        if not self.trained:
            return [0] * self.K
        acc = [0.0] * self.K
        cnt = 0
        for m, vec in feature_by_modality.items():
            Wm = self.W.get(m)
            if Wm is None or len(vec) != len(Wm[0]):
                continue
            s = linalg.matvec(Wm, linalg.normalize_row(vec))   # 长度 K
            for k in range(self.K):
                acc[k] += s[k]
            cnt += 1
        if cnt == 0:
            return [0] * self.K
        return [1 if acc[k] >= 0 else 0 for k in range(self.K)]
