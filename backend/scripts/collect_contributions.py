"""生成 README「项目贡献者与开发历程」章节的贡献统计表。

为什么需要这个脚本
----------------
README 里那张贡献表如果靠手工维护，数字很快就过期了；而且「谁贡献了多少」
这种事一旦写死，评审很容易追问「这个数字怎么来的」。把统计逻辑固化成脚本，
好处有三：

  1. **可复现** —— 任何人 clone 下来跑一遍就能得到同样的数字；
  2. **可刷新** —— 比赛前若还有提交，重跑一次即可刷新 README；
  3. **可追溯** —— 统计口径写在脚本里，不必在 README 里写一大段解释。

统计口径
--------
* 数据来源：``git log --all --no-merges --numstat``（含所有本地分支的
  非合并提交），新增行数取 ``numstat`` 的第一列，删除行数取第二列。
* **不含二进制文件**（``numstat`` 对二进制记 ``-``，此处跳过）。
* **身份归并**：同一人可能用多个 Git 身份提交（换机器、换平台、GitHub/Gitee
  各注册一个），``IDENTITY_MAP`` 把这些身份归到同一个真实姓名，
  每条映射都注明了依据，避免"猜"出来的归属。
* **行数反映代码体量，不等于投入工时** —— 一次性生成的大文件、文档写作、
  调试排错都不会体现为行数；提交次数反映的是协作粒度。两者一起看才完整。

用法
----
    python scripts/collect_contributions.py                 # 打印 Markdown 表格
    python scripts/collect_contributions.py --json          # 机器可读
    python scripts/collect_contributions.py --check README.md
        # 校验 README 里的表格是否与当前仓库一致（不一致则退出码 1）
"""
import argparse
import collections
import json
import os
import subprocess
import sys

# ── 身份归并：Git 身份 -> 真实姓名 ────────────────────────────────────────
# 依据写在这里，不做无依据的推断；「姓名」为 None 表示该身份未做归属说明。
IDENTITY_MAP = {
    # 参赛成员（传智杯 腾龙队）
    "drinkbeerbest <2635727649@qq.com>": ("范永鑫",
        "同一作者的 QQ 邮箱身份"),
    "drinkbeerbest <201467324+drinkbeerbest@users.noreply.github.com>": ("范永鑫",
        "同一作者的 GitHub noreply 身份"),
    "zwz <273255002+zhangwenzhen06@users.noreply.github.com>": ("张文震",
        "GitHub noreply 身份（GitHub 用户 ID + 用户名）"),
    "zwz <zwz@localhost>": ("张文震",
        "同作者的本地占位邮箱身份；该邮箱 GitHub 无法关联，故其提交"
        "在贡献图上不显示"),
    "epohopes <284002463+epohopes@users.noreply.github.com>": ("黄婉琳",
        "GitHub noreply 身份"),
    "HWL <16623595+epohope@user.noreply.gitee.com>": ("黄婉琳",
        "Gitee noreply 身份（用户名 epohope 与其 GitHub 身份 epohopes 对应）；"
        "两次提交均属个人端方向且改动同一批文件，判为同一人"),
}

# ── 目录 -> 模块归属（用于「主要模块」列的自动归类）──────────────────────
MODULE_RULES = [
    ("personal-backend/", "个人端 Agent"),
    ("frontend/src/pages/me/", "个人端"),
    ("frontend/src/components/", "前端组件"),
    ("frontend/", "前端"),
    ("mobile/", "移动端"),
    ("backend/app/engines/hashing/", "跨模态哈希检索"),
    ("backend/app/engines/", "引擎"),
    ("backend/app/", "后端"),
    ("backend/scripts/", "脚本"),
    ("docs/", "文档"),
]

# 已知模块归属的补充说明（自动归类之外的人工标注，用于「主要模块」列）
MODULE_NOTE = {
    "黄婉琳": "个人端 Agent（personal-backend 后端 + AI 陪伴 + 3D 星空知识图谱）",
    "张文震": "跨模态哈希检索（特征通道化、AVDD-TCMI 接入）",
    "范永鑫": "后端与业务接口",
}


def _git(args, cwd):
    r = subprocess.run(["git"] + args, cwd=cwd, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise SystemExit(f"git {' '.join(args)} 失败：{(r.stderr or '')[:200]}")
    return r.stdout


def collect(repo):
    """返回 [{identity, name, commits, added, deleted, modules}]。"""
    raw = _git(
        ["log", "--all", "--no-merges", "--numstat",
         "--format=@@%aN <%aE>"], repo)

    commits = collections.Counter()
    added = collections.Counter()
    deleted = collections.Counter()
    modules = collections.defaultdict(collections.Counter)
    cur = None

    for line in raw.splitlines():
        if line.startswith("@@"):
            cur = line[2:].strip()
            commits[cur] += 1
            continue
        if not line.strip() or cur is None:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        a, d, path = parts
        if not a.isdigit() or not d.isdigit():
            continue          # 二进制文件
        added[cur] += int(a)
        deleted[cur] += int(d)
        for prefix, name in MODULE_RULES:
            if path.startswith(prefix):
                modules[cur][name] += int(a) + int(d)
                break
        else:
            modules[cur]["其他"] += int(a) + int(d)

    # 身份归并
    merged = {}
    for ident, cnt in commits.items():
        name, _why = IDENTITY_MAP.get(ident, (None, ""))
        key = name or ident
        slot = merged.setdefault(key, {
            "name": name, "identities": [], "commits": 0,
            "added": 0, "deleted": 0, "modules": collections.Counter()})
        slot["identities"].append(ident)
        slot["commits"] += cnt
        slot["added"] += added[ident]
        slot["deleted"] += deleted[ident]
        slot["modules"].update(modules[ident])

    out = []
    for key, v in merged.items():
        note = MODULE_NOTE.get(v["name"]) if v["name"] else None
        if not note:
            top = [m for m, _ in v["modules"].most_common(2)]
            note = "、".join(top) if top else "—"
        out.append({
            "key": key, "name": v["name"], "identities": v["identities"],
            "commits": v["commits"], "added": v["added"],
            "deleted": v["deleted"], "modules": dict(v["modules"]),
            "note": note,
        })
    out.sort(key=lambda r: -(r["added"] + r["deleted"]))
    return out


def to_markdown(rows):
    """生成 README 用的 Markdown 表格。

    全体按代码变更量降序排列；同一人有多个 Git 身份时合并为一行，
    「Git 作者」列用 `` + `` 连接各身份名（同名只出现一次）。
    """
    lines = [
        "| Git 作者 | 姓名 | 提交数 | 代码变更量 | 主要模块 |",
        "|---|---|---:|---:|---|",
    ]
    for r in rows:
        names = []
        for ident in r["identities"]:
            gname = ident.split(" <")[0]
            if gname not in names:
                names.append(gname)
        ident_cell = " + ".join(f"`{n}`" for n in names)
        name_cell = f"**{r['name']}**" if r["name"] else "—"
        lines.append(f"| {ident_cell} | {name_cell} | {r['commits']} | "
                     f"+{r['added']:,} | {r['note']} |")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="统计仓库贡献分布")
    ap.add_argument("--repo", default=os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    ap.add_argument("--check", metavar="README", default=None,
                    help="校验 README 中的表格是否与当前仓库一致")
    args = ap.parse_args()

    rows = collect(args.repo)

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    md = to_markdown(rows)
    if args.check:
        path = args.check if os.path.isabs(args.check) else \
            os.path.join(args.repo, args.check)
        if not os.path.exists(path):
            print(f"找不到 {path}")
            return 2
        with open(path, encoding="utf-8") as f:
            content = f.read()
        if md in content:
            print("✓ README 中的贡献表与当前仓库一致")
            return 0
        print("✗ README 中的贡献表已过期，请重跑本脚本并更新")
        print("--- 当前仓库实际数据 ---")
        print(md)
        return 1

    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
