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
    if _NP:
        return (np.asarray(A, dtype=np.float64) @ np.asarray(B, dtype=np.float64)).tolist()
    n = len(B[0])
    k = len(B)
    return [[sum(A[i][p] * B[p][j] for p in range(k)) for j in range(n)]
            for i in range(len(A))]


def matvec(A, x):
    """矩阵乘向量 A(m×d) · x(d) -> (m)。"""
    if _NP:
        return (np.asarray(A, dtype=np.float64) @ np.asarray(x, dtype=np.float64)).tolist()
    return [sum(A[i][j] * x[j] for j in range(len(x))) for i in range(len(A))]


def normalize_row(v):
    """L2 归一化（零向量返回零向量）。"""
    if _NP:
        a = np.asarray(v, dtype=np.float64)
        s = float(np.linalg.norm(a))
        return (a / s).tolist() if s > 0 else [0.0] * len(v)
    s = math.sqrt(sum(x * x for x in v))
    if s <= 0:
        return [0.0] * len(v)
    return [x / s for x in v]


def gram(A):
    """A(n×d) -> A A^T (n×n)，用于构造余弦相似度矩阵。

    n=300 配对记录时纯 Python 版需 ~2500 万次乘加（数十秒），
    numpy 存在时走 BLAS，训练耗时从数十秒降到毫秒级。
    """
    if _NP and A:
        X = np.asarray(A, dtype=np.float64)
        return (X @ X.T).tolist()
    n = len(A)
    d = len(A[0]) if n else 0
    return [[sum(A[i][p] * A[j][p] for p in range(d)) for j in range(n)]
            for i in range(n)]


def gram_masked(A):
    """带缺失行的 Gram：A 每行可能是 None（该样本没有这个模态的视图）。

    缺失行的 Gram 贡献记为 0 —— 它只是「这个模态上看不到这条样本」，
    而不是「这条样本在此模态上与所有东西都不相关」。

    这是统一引擎能同时容纳不同规模数据集的关键：AVDD 只有 282 条
    音-图记录，与 EATD 的 3393 条文-音记录、FER2013 的表情图
    共存于同一个 n×n 的监督矩阵里，各自只覆盖自己的那部分行。
    """
    n = len(A)
    out = [[0.0] * n for _ in range(n)]
    if _NP:
        rows = [i for i, r in enumerate(A) if r is not None]
        if not rows:
            return out
        X = np.asarray([A[i] for i in rows], dtype=np.float64)
        G = X @ X.T
        for a, i in enumerate(rows):
            for b, j in enumerate(rows):
                out[i][j] = float(G[a][b])
        return out
    for i, ri in enumerate(A):
        if ri is None:
            continue
        for j, rj in enumerate(A):
            if rj is None:
                continue
            out[i][j] = sum(ri[p] * rj[p] for p in range(len(ri)))
    return out


def ridge_fit(X, B, mask=None, ridge=0.1):
    """岭回归：W = (XᵀX + εI)^{-1} XᵀB，形状 K×d（matvec 得 K 维）。

    mask : 长度 n 的布尔列表，False 表示该样本在此模态上缺失（不参与拟合）。
           缺失样本仍会得到一个 W（用剩余样本拟合的矩阵编码），
           但语料构建阶段不会为它生成单元。
    """
    rows = [i for i, r in enumerate(X) if r is not None
            and (mask is None or mask[i])]
    if not rows:
        return None
    if _NP:
        Xm = np.asarray([X[i] for i in rows], dtype=np.float64)
        Bm = np.asarray([B[i] for i in rows], dtype=np.float64)
        XtX = Xm.T @ Xm
        XtX[np.diag_indices_from(XtX)] += ridge
        XtB = Xm.T @ Bm
        return (np.linalg.solve(XtX, XtB)).T.tolist()   # K×d
    d = len(X[rows[0]])
    XtX = [[sum(X[i][p] * X[i][q] for i in rows) for q in range(d)]
           for p in range(d)]
    for p in range(d):
        XtX[p][p] += ridge
    XtB = [[sum(X[i][p] * B[i][k] for i in rows) for k in range(len(B[0]))]
           for p in range(d)]
    inv = inverse(XtX)
    return transpose(matmul(inv, XtB))



def mean_abs(M):
    """矩阵绝对值均值（用于平衡多模态 Gram 与监督矩阵的尺度）。"""
    if not M or not M[0]:
        return 0.0
    if _NP:
        return float(np.abs(np.asarray(M, dtype=np.float64)).mean())
    tot = cnt = 0
    for row in M:
        for x in row:
            tot += abs(x)
            cnt += 1
    return tot / cnt if cnt else 0.0


# ------------------------- 求逆（Gauss-Jordan） -------------------------

def inverse(A):
    """K×K 矩阵求逆，部分主元 Gauss-Jordan（numpy 存在时走 LAPACK）。"""
    if _NP:
        try:
            return np.linalg.inv(np.asarray(A, dtype=np.float64)).tolist()
        except Exception:
            pass
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
