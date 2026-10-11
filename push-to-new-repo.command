#!/bin/bash
# 把本地所有成果推送到新的 GitHub 私库
#
# 用法：
#   ./push-to-new-repo.command https://github.com/<组织名>/<仓库名>.git
#
# 做的事：
#   1. 校验地址、旧远程（old-origin）是否保留
#   2. 把新地址设为 origin
#   3. 依次推 main、feature/frontend-redesign、codex/react-frontend-20261011、全部 tag
#   4. 远端若已有提交（建库时勾了 Add a README）会先尝试 rebase
#
# 说明：旧远程已改名为 old-origin，随时可用 git fetch old-origin 回看原仓库。

set -u
REPO="/Users/jiaxuan/Documents/DaChuang-FLCFZ"
BRANCHES=("main" "feature/frontend-redesign" "codex/react-frontend-20261011")

cd "$REPO" || { echo "找不到仓库：$REPO"; exit 1; }

NEW_URL="${1:-}"
if [ -z "$NEW_URL" ]; then
  echo "用法: $0 https://github.com/<组织名>/<仓库名>.git"
  echo
  echo "当前远程配置："
  git remote -v
  exit 1
fi

case "$NEW_URL" in
  https://github.com/*.git|git@github.com:*) ;;
  *) echo "地址格式看起来不对：$NEW_URL"
     echo "HTTPS 形式应形如 https://github.com/组织名/仓库名.git"
     exit 1 ;;
esac

echo "=== 推送前的本地状态 ==="
git remote -v
echo "当前分支: $(git rev-parse --abbrev-ref HEAD)"
echo "未提交改动:"
git status --short | head

echo
read -r -p "确认把上述分支推送到 $NEW_URL ？[y/N] " ok
[ "$ok" = "y" ] || [ "$ok" = "Y" ] || { echo "已取消。"; exit 0; }

echo
echo "=== 配置 origin ==="
if git remote | grep -qx origin; then
  echo "  origin 已存在，更新地址"
  git remote set-url origin "$NEW_URL"
else
  git remote add origin "$NEW_URL"
  echo "  已添加 origin"
fi
git remote -v

echo
echo "=== 推送分支 ==="
for b in "${BRANCHES[@]}"; do
  echo "--- $b"
  if git push -u origin "$b" 2>/tmp/push_err_$$; then
    echo "    OK"
  else
    if grep -qE "rejected|non-fast-forward|fetch first" /tmp/push_err_$$; then
      echo "    远端已有提交，尝试 rebase 后重推"
      git checkout "$b" || { echo "    切换分支失败，跳过"; continue; }
      if git pull --rebase origin "$b" && git push -u origin "$b"; then
        echo "    OK（rebase 后）"
      else
        echo "    !! 仍失败，请把上面的报错发给 DeepSeek 处理"
      fi
    else
      echo "    !! 推送失败："
      sed 's/^/       /' /tmp/push_err_$$
    fi
  fi
done
rm -f /tmp/push_err_$$

echo
echo "=== 推送 tag ==="
git push origin --tags && echo "  OK"

echo
echo "=== 完成，最终远程配置 ==="
git remote -v
git branch -vv
