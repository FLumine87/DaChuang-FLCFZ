"""
最小线性代数工具（仅标准库；若环境装了 NumPy 则自动加速）。

哈希引擎只用到少量矩阵运算：矩阵乘法、转置、向量乘、行 L2 归一化、
Gram 矩阵、K×K 求逆，以及「对称矩阵前 K 大特征对」。
纯 Python 实现保证在零额外依赖的后端镜像里也能跑；当 numpy 存在时，
特征值分解走 np.linalg.eigh，大矩阵更快。
"""
import math

try:
    import numpy as np
    _NP = True
except Exception:  # pragma: no cover - 取决于运行环境
    _NP = False


# ------------------------- 基础运算 -------------------------

def transpose(A):
    """A(m×n) -> A^T(n×m)。"""
    return [[A[i][j] for i in range(len(A))] for j in range(len(A[0]))]


def matmul(A, B):
    """矩阵乘法 A(m×k) · B(k×n) -> (m×n)。"""
    n = len(B[0])
    k = len(B)
    return [[sum(A[i][p] * B[p][j] for p in range(k)) for j in range(n)]
            for i in range(len(A))]


def matvec(A, x):
    """矩阵乘向量 A(m×d) · x(d) -> (m)。"""
    return [sum(A[i][j] * x[j] for j in range(len(x))) for i in range(len(A))]


def normalize_row(v):
    """L2 归一化（零向量返回零向量）。"""
    s = math.sqrt(sum(x * x for x in v))
    if s <= 0:
        return [0.0] * len(v)
    return [x / s for x in v]


def gram(A):
    """A(n×d) -> A A^T (n×n)，用于构造余弦相似度矩阵。"""
    n = len(A)
    d = len(A[0]) if n else 0
    return [[sum(A[i][p] * A[j][p] for p in range(d)) for j in range(n)]
            for i in range(n)]


def mean_abs(M):
    """矩阵绝对值均值（用于平衡多模态 Gram 与监督矩阵的尺度）。"""
    if not M or not M[0]:
        return 0.0
    tot = cnt = 0
    for row in M:
        for x in row:
            tot += abs(x)
            cnt += 1
    return tot / cnt if cnt else 0.0


# ------------------------- 求逆（Gauss-Jordan） -------------------------

def inverse(A):
    """K×K 矩阵求逆，部分主元 Gauss-Jordan。"""
    n = len(A)
    M = [list(row) + [1.0 if i == j else 0.0 for j in range(n)]
         for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            continue
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        M[col] = [x / pv for x in M[col]]
        for r in range(n):
            if r != col and M[r][col] != 0:
                f = M[r][col]
                M[r] = [M[r][c] - f * M[col][c] for c in range(2 * n)]
    return [row[n:] for row in M]


# ------------------------- 对称矩阵前 K 大特征对 -------------------------

def symmetric_eig_largest(A, k):
    """
    返回对称矩阵 A 的前 k 个最大特征对 (eigenvalues_desc, eigenvectors)。

    eigenvalues_desc : 长度 k，降序
    eigenvectors     : 长度 k 的列表，每个是长度 n 的特征向量（列向量）
    """
    if _NP:
        w, v = np.linalg.eigh(A)  # 升序
        idx = sorted(range(len(w)), key=lambda i: w[i], reverse=True)[:k]
        evals = [float(w[i]) for i in idx]
        evecs = [[float(v[j][i]) for j in range(len(w))] for i in idx]
        return evals, evecs
    return _power_deflate(A, k)


def _power_deflate(A, k, niter=300):
    """
    纯 Python 实现：幂迭代 + 逐次收缩，提取前 k 个最大特征对。
    复杂度 O(n^2 · k · niter)，适合任意规模（numpy 缺失时的回退路径）。
    """
    import random
    n = len(A)
    eig = []
    vecs = []
    M = [row[:] for row in A]
    for _ in range(k):
        rnd = random.Random(1234 + len(eig))
        v = normalize_row([rnd.uniform(-1, 1) for _ in range(n)])
        lam = 0.0
        for _it in range(niter):
            w = normalize_row(matvec(M, v))
            v = w
        # Rayleigh 商精炼
        for _ in range(20):
            w = matvec(M, v)
            lam = sum(v[i] * w[i] for i in range(n))
            v = normalize_row(w)
        eig.append(lam)
        vecs.append(v[:])
        # 收缩：去掉已求得的特征方向，保证下次迭代找到下一个
        for i in range(n):
            for j in range(n):
                M[i][j] -= lam * v[i] * v[j]
    return eig, vecs
